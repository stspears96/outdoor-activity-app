import Database from "better-sqlite3";
import path from "node:path";
import { NextResponse } from "next/server";
import { fetchCdipLatest } from "@/lib/cdip";
import { scoreSurfSpot, SurfConditions, SurfSpotParams } from "@/lib/surfScoring";

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

function msToKnots(ms: number) {
  return ms * 1.943844;
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
  conditions?: SurfConditions & { swellSource?: string };

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

async function fetchWindForSpots(spots: ScoredSpot[]) {
  const lats = spots.map((s) => s.lat).join(",");
  const lons = spots.map((s) => s.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}` +
    `&longitude=${lons}` +
    `&current=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms` +
    `&timezone=UTC`;

  const json = await fetchJson(url, 9000);
  return Array.isArray(json) ? json : [json];
}

async function fetchMarineForSpots(spots: ScoredSpot[]) {
  const lats = spots.map((s) => s.lat).join(",");
  const lons = spots.map((s) => s.lon).join(",");
  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${lats}` +
    `&longitude=${lons}` +
    `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period` +
    `&cell_selection=sea` +
    `&timezone=UTC`;

  const json = await fetchJson(url, 9000);
  return Array.isArray(json) ? json : [json];
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

  const cdipByTransect = new Map<string, Awaited<ReturnType<typeof fetchCdipLatest>>>();
  await Promise.all(
    transects.map(async (t) => {
      const v = await fetchCdipLatest(t);
      cdipByTransect.set(t, v);
    })
  );

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

    const cdipTp = cdip?.ok && typeof cdip.waveTp === "number" ? cdip.waveTp : undefined;
    const cdipTa = cdip?.ok && typeof cdip.waveTa === "number" ? cdip.waveTa : undefined;
    const cdipHs = cdip?.ok && typeof cdip.waveHs === "number" ? cdip.waveHs : undefined;
    const cdipDm = cdip?.ok && typeof cdip.waveDm === "number" ? cdip.waveDm : undefined;

    const swellHeightM = cdipHs ?? (typeof m?.swell_wave_height === "number" ? m.swell_wave_height : undefined);
    const swellPeakPeriodS = cdipTp ?? (typeof m?.swell_wave_period === "number" ? m.swell_wave_period : wavePeriodS);
    const swellAvgPeriodS = cdipTa ?? undefined;
    const swellDirDeg = cdipDm ?? (typeof m?.swell_wave_direction === "number" ? m.swell_wave_direction : undefined);

    let swellPeriodDiffS = undefined;
    if (swellPeakPeriodS != null && swellAvgPeriodS != null) {
        swellPeriodDiffS = swellPeakPeriodS - swellAvgPeriodS;
    }

    const swellSource =
      cdip?.ok ? `CDIP:${cdip.transect}` : "open-meteo";

    const cond: SurfConditions = {
        windSpeedKts,
        windDirDeg,
        waveHeightM,
        waveDirDeg,
        wavePeriodS,
        swellHeightM,
        swellDirDeg,
        swellPeakPeriodS,
        swellAvgPeriodS,
        swellPeriodDiffS,
    };

    const { score, quality, reasons } = scoreSurfSpot(s as SurfSpotParams, cond);
    
    return {
      ...s,
      conditions: { ...cond, swellSource },
      score,
      quality,
      reasons,
    };
  });

  spots.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.distanceKm - b.distanceKm);

  return NextResponse.json({
    lat,
    lon,
    count: spots.length,
    spots,
    debug,
  });
}
