import Database from "better-sqlite3";
import path from "node:path";
import { NextResponse } from "next/server";
import { fetchCdipLatest } from "@/lib/cdip";

const DB_PATH = path.join(process.cwd(), "data", "surfspots.sqlite");

// ---------- helpers ----------
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function inDegWindow(deg: number, minDeg: number, maxDeg: number) {
  // Handles wrap-around windows like [330, 60]
  const d = ((deg % 360) + 360) % 360;
  const a = ((minDeg % 360) + 360) % 360;
  const b = ((maxDeg % 360) + 360) % 360;
  if (a <= b) return d >= a && d <= b;
  return d >= a || d <= b;
}

function msToKnots(ms: number) {
  return ms * 1.943844;
}

// 16-point cardinal label for a bearing
const CARDINAL_16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function toCardinal(deg: number): string {
  const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return CARDINAL_16[i];
}

// Midpoint of an angular window (handles wrap-around)
function circularCenter(minDeg: number, maxDeg: number): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const sinMean = (Math.sin(toR(minDeg)) + Math.sin(toR(maxDeg))) / 2;
  const cosMean = (Math.cos(toR(minDeg)) + Math.cos(toR(maxDeg))) / 2;
  return ((Math.atan2(sinMean, cosMean) * 180) / Math.PI + 360) % 360;
}

// Shortest angular distance between two bearings (0–180°)
function angularDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

type ScoredSpot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region?: string | null;
  break_type?: string | null;
  difficulty?: string | null;

  coast_orientation_deg?: number | null;
  swell_min_deg?: number | null;
  swell_max_deg?: number | null;
  wind_offshore_min_deg?: number | null;
  wind_offshore_max_deg?: number | null;
  tide_preference?: string | null;
  cdip_transect_id?: string | null;

  distanceKm: number;

  // added by scoring
  conditions?: {
    windSpeedKts?: number;
    windDirDeg?: number;
    waveHeightM?: number;
    wavePeriodS?: number;
    waveDirDeg?: number;
    swellHeightM?: number;
    swellPeriodS?: number;
    swellDirDeg?: number;
    swellSource?: string;
  };

  score?: number; // 0..100
  quality?: "poor" | "fair" | "good" | "excellent";
  reasons?: string[];
};

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // cache for 10 minutes to reduce API calls while you click around
      next: { revalidate: 600 },
      headers: { "User-Agent": "outdoor-activity-app/1.0 (surf-score)" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

// Open-Meteo supports multiple coordinates: comma-separated latitude/longitude,
// and returns an array of responses. :contentReference[oaicite:2]{index=2}
async function fetchWindForSpots(spots: ScoredSpot[]) {
  const lats = spots.map((s) => s.lat).join(",");
  const lons = spots.map((s) => s.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lats)}` +
    `&longitude=${encodeURIComponent(lons)}` +
    `&current=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms` +
    `&timezone=UTC`;

  const json = await fetchJson(url, 9000);
  // When multiple coords are used, response becomes a list of structures. :contentReference[oaicite:3]{index=3}
  return Array.isArray(json) ? json : [json];
}

async function fetchMarineForSpots(spots: ScoredSpot[]) {
  const lats = spots.map((s) => s.lat).join(",");
  const lons = spots.map((s) => s.lon).join(",");
  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${encodeURIComponent(lats)}` +
    `&longitude=${encodeURIComponent(lons)}` +
    `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period` +
    `&cell_selection=sea` +
    `&timezone=UTC`;

  const json = await fetchJson(url, 9000);
  return Array.isArray(json) ? json : [json];
}

function scoreSpot(spot: ScoredSpot): { score: number; quality: ScoredSpot["quality"]; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;

  const c = spot.conditions ?? {};
  const windDir = c.windDirDeg;
  const windKts = c.windSpeedKts;

  // Prefer dedicated swell vars; fall back to combined wave vars
  const swellDir = c.swellDirDeg ?? c.waveDirDeg;
  const swellH   = c.swellHeightM ?? c.waveHeightM;
  const swellP   = c.swellPeriodS ?? c.wavePeriodS;

  // ── Wind direction — continuous score relative to offshore window center ──
  if (typeof windDir === "number" && spot.wind_offshore_min_deg != null && spot.wind_offshore_max_deg != null) {
    const offCenter = circularCenter(spot.wind_offshore_min_deg, spot.wind_offshore_max_deg);
    const dist = angularDist(windDir, offCenter);
    // cos mapping: 0° (dead offshore) → +20, 90° (sideshore) → 0, 180° (onshore) → -20
    const pts = Math.round(Math.cos((dist * Math.PI) / 180) * 20);
    score += pts;

    const label =
      dist <= 30  ? "offshore" :
      dist <= 70  ? "side-offshore" :
      dist <= 110 ? "sideshore" :
      dist <= 150 ? "side-onshore" :
                    "onshore";
    const icon = pts >= 12 ? "✅" : pts >= 0 ? "" : pts >= -10 ? "⚠️" : "❌";
    reasons.push(`Wind ${toCardinal(windDir)} — ${label} (${Math.round(dist)}° from offshore) ${icon}`);
  } else if (typeof windDir === "number") {
    reasons.push(`Wind ${toCardinal(windDir)} (${Math.round(windDir)}°, no offshore window)`);
  }

  // ── Wind speed ────────────────────────────────────────────────────────────
  if (typeof windKts === "number") {
    if (windKts <= 5)       { score += 12; reasons.push(`${windKts.toFixed(0)} kts — light ✅`); }
    else if (windKts <= 10) { score += 6;  reasons.push(`${windKts.toFixed(0)} kts — moderate`); }
    else if (windKts <= 15) { score += 1;  reasons.push(`${windKts.toFixed(0)} kts — breezy`); }
    else if (windKts <= 20) { score -= 8;  reasons.push(`${windKts.toFixed(0)} kts — windy ⚠️`); }
    else                    { score -= 16; reasons.push(`${windKts.toFixed(0)} kts — very windy ❌`); }
  }

  // ── Swell: height + period + direction — one combined reason ─────────────
  if (typeof swellH === "number" || typeof swellP === "number" || typeof swellDir === "number") {
    const parts: string[] = [];

    // Height
    if (typeof swellH === "number") {
      if (swellH < 0.5)       { score -= 10; parts.push(`${swellH.toFixed(1)}m (flat)`); }
      else if (swellH < 1.2)  { score += 6;  parts.push(`${swellH.toFixed(1)}m`); }
      else if (swellH < 2.2)  { score += 10; parts.push(`${swellH.toFixed(1)}m`); }
      else                    { score -= 4;  parts.push(`${swellH.toFixed(1)}m (large)`); }
    }

    // Period
    if (typeof swellP === "number") {
      if (swellP >= 14)      { score += 12; parts.push(`${swellP.toFixed(0)}s`); }
      else if (swellP >= 11) { score += 8;  parts.push(`${swellP.toFixed(0)}s`); }
      else if (swellP >= 8)  { score += 3;  parts.push(`${swellP.toFixed(0)}s`); }
      else                   { score -= 6;  parts.push(`${swellP.toFixed(0)}s (short)`); }
    }

    // Direction
    if (typeof swellDir === "number") {
      const dir = `${toCardinal(swellDir)} (${Math.round(swellDir)}°)`;
      if (spot.swell_min_deg != null && spot.swell_max_deg != null) {
        if (inDegWindow(swellDir, spot.swell_min_deg, spot.swell_max_deg)) {
          score += 16;
          parts.push(`from ${dir} ✅`);
        } else {
          score -= 8;
          parts.push(`from ${dir} ⚠️`);
        }
      } else {
        parts.push(`from ${dir}`);
      }
    }

    reasons.push(`Swell: ${parts.join(", ")}`);
  }

  score = clamp(Math.round(score), 0, 100);

  let quality: ScoredSpot["quality"] = "poor";
  if (score >= 78)      quality = "excellent";
  else if (score >= 60) quality = "good";
  else if (score >= 42) quality = "fair";

  return { score, quality, reasons };
}

// ---------- handler ----------
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusKm = Number(searchParams.get("radiusKm") ?? "80");
  const limit = clamp(Number(searchParams.get("limit") ?? "30"), 1, 60);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  // SQLite bounding box
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `
      SELECT *
      FROM surf_spots
      WHERE lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
      `
    )
    .all(lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta);
  db.close();

  const spots0: ScoredSpot[] = rows
    .map((s: any) => ({
      ...s,
      distanceKm: haversineKm(lat, lon, s.lat, s.lon),
    }))
    .filter((s: any) => s.distanceKm <= radiusKm)
    .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  // If no spots, return early
  if (spots0.length === 0) {
    return NextResponse.json({ lat, lon, count: 0, spots: [] });
  }

  const transects = Array.from(
    new Set(
      spots0
        .map((s: any) => (s.cdip_transect_id as string | null) ?? null)
        .filter((x): x is string => !!x)
    )
  );

  // Fetch once per transect (parallel)
  const cdipByTransect = new Map<string, Awaited<ReturnType<typeof fetchCdipLatest>>>();
  await Promise.all(
    transects.map(async (t) => {
      const v = await fetchCdipLatest(t);
      cdipByTransect.set(t, v);
    })
  );

  // Fetch conditions in 2 batched calls (wind + marine)
  let windResp: any[] = [];
  let marineResp: any[] = [];
  const debug: any = {};

  try {
    windResp = await fetchWindForSpots(spots0);
    debug.wind = { ok: true };
  } catch (e: any) {
    debug.wind = { ok: false, error: e?.message ?? String(e) };
  }

  try {
    marineResp = await fetchMarineForSpots(spots0);
    debug.marine = { ok: true };
  } catch (e: any) {
    debug.marine = { ok: false, error: e?.message ?? String(e) };
  }

  // Attach conditions by index (Open-Meteo returns in the same order as coordinates)
  const spots: ScoredSpot[] = spots0.map((s, i) => {
    const w = windResp[i]?.current;
    const m = marineResp[i]?.current;

    const windSpeedKts =
      typeof w?.wind_speed_10m === "number" ? msToKnots(w.wind_speed_10m) : undefined;
    const windDirDeg = typeof w?.wind_direction_10m === "number" ? w.wind_direction_10m : undefined;

    const waveHeightM = typeof m?.wave_height === "number" ? m.wave_height : undefined;
    const waveDirDeg = typeof m?.wave_direction === "number" ? m.wave_direction : undefined;
    const wavePeriodS = typeof m?.wave_period === "number" ? m.wave_period : undefined;

    const cdip = s.cdip_transect_id ? cdipByTransect.get(s.cdip_transect_id) : undefined;

    // CDIP swell: use waveDm (bulk direction) + waveTp + waveHs
    const cdipSwellHeightM =
      cdip?.ok && typeof cdip.waveHs === "number" ? cdip.waveHs : undefined;
    const cdipSwellPeriodS =
      cdip?.ok && typeof cdip.waveTp === "number" ? cdip.waveTp : undefined;
    const cdipSwellDirDeg =
      cdip?.ok && typeof cdip.waveDm === "number" ? cdip.waveDm : undefined;

    // Fall back to your existing marine/Open-Meteo values if CDIP missing
    const swellHeightM =
      cdipSwellHeightM ?? (typeof m?.swell_wave_height === "number" ? m.swell_wave_height : undefined);
    const swellPeriodS =
      cdipSwellPeriodS ?? (typeof m?.swell_wave_period === "number" ? m.swell_wave_period : undefined);
    const swellDirDeg =
      cdipSwellDirDeg ?? (typeof m?.swell_wave_direction === "number" ? m.swell_wave_direction : undefined);

    const swellSource =
      cdip?.ok ? `CDIP:${cdip.transect}` : "open-meteo";

    const spot2: ScoredSpot = {
      ...s,
      conditions: {
        windSpeedKts,
        windDirDeg,
        waveHeightM,
        waveDirDeg,
        wavePeriodS,
        swellHeightM,
        swellDirDeg,
        swellPeriodS,
	swellSource,
      },
    };

    const { score, quality, reasons } = scoreSpot(spot2);
    spot2.score = score;
    spot2.quality = quality;
    spot2.reasons = reasons;
    return spot2;
  });

  // Sort by score first, then distance (so the best pops to the top)
  spots.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distanceKm - b.distanceKm);

  return NextResponse.json({
    lat,
    lon,
    count: spots.length,
    spots,
    debug,
  });
}

