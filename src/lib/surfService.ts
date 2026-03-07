import Database from "better-sqlite3";
import path from "node:path";
import { fetchCdipAtTime } from "./cdip";
import { scoreSurfSpot, SurfConditions, SurfSpotParams } from "./surfScoring";
import { fetchNearestTideStation, fetchTidePredictions } from "./noaa";
import type { SpectralSwell } from "./spectral";

const DB_PATH = path.join(process.cwd(), "data", "surfspots.sqlite");

export type ScoredSurfSpot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  score: number;
  quality: string;
  reasons: string[];
  conditions: SurfConditions;
  tideStation?: any;
  wind_offshore_min_deg?: number;
  wind_offshore_max_deg?: number;
  swell_min_deg?: number;
  swell_max_deg?: number;
  tide_preference?: string;
  cdip_transect_id?: string;
  swellComponents?: SpectralSwell[];
  bestHourISO?: string;
};

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

function msToKnots(ms: number) {
  return ms * 1.943844;
}

/**
 * Core logic to find, fetch data for, and score surf spots.
 * Can be called directly by API routes to avoid internal HTTP overhead.
 */
export async function getScoredSurfSpots(
  lat: number,
  lon: number,
  radiusKm: number = 80,
  baseTimeMs?: number
): Promise<ScoredSurfSpot[]> {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(`SELECT * FROM surf_spots WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`)
    .all(lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta);
  db.close();

  const spots0 = rows
    .map((s: any) => ({
      ...s,
      distanceKm: haversineKm(lat, lon, s.lat, s.lon),
    }))
    .filter((s: any) => s.distanceKm <= radiusKm)
    .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
    .slice(0, 50);

  if (spots0.length === 0) return [];

  const transects = Array.from(new Set(spots0.map((s: any) => s.cdip_transect_id).filter(Boolean)));

  const targetMs = typeof baseTimeMs === "number" ? baseTimeMs : Date.now();

  // Parallel fetch: Wave models, Tide predictions, and Wind/Marine forecasts
  const [cdipResults, tideStation] = await Promise.all([
    Promise.all(transects.map(t => fetchCdipAtTime(t as string, targetMs))),
    fetchNearestTideStation(lat, lon, 100),
  ]);

  const cdipByTransect = new Map<string, any>();
  cdipResults.forEach((res, i) => cdipByTransect.set(transects[i] as string, res));

  // Batch Wind/Marine fetch from Open-Meteo
  const lats = spots0.map(s => s.lat).join(",");
  const lons = spots0.map(s => s.lon).join(",");
  
  const [windRes, marineRes] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=UTC`).then(r => r.json()),
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period&cell_selection=sea&timezone=UTC`).then(r => r.json()),
  ]);

  const windArray = Array.isArray(windRes) ? windRes : [windRes];
  const marineArray = Array.isArray(marineRes) ? marineRes : [marineRes];

  let tideData: any[] = [];
  if (tideStation) {
    tideData = await fetchTidePredictions(tideStation.id, 6, 72); // 72 hours of predictions
  }

  const getTideAt = (timeMs: number) => {
    if (tideData.length === 0) return null;
    let closest = tideData[0];
    let minDist = Math.abs(Date.parse(closest.t.replace(" ", "T") + "Z") - timeMs);
    for (const p of tideData) {
        const d = Math.abs(Date.parse(p.t.replace(" ", "T") + "Z") - timeMs);
        if (d < minDist) {
            minDist = d;
            closest = p;
        }
    }
    const idx = tideData.indexOf(closest);
    let state: "rising" | "falling" | "stable" = "stable";
    if (idx !== -1 && idx < tideData.length - 1) {
        const next = tideData[idx + 1];
        if (Number(next.v) > Number(closest.v) + 0.1) state = "rising";
        else if (Number(next.v) < Number(closest.v) - 0.1) state = "falling";
    }
    return { height: Number(closest.v), state };
  };

  const currentTide = getTideAt(targetMs);

  const pickHourIndex = (times?: string[]) => {
    if (!times || times.length === 0) return -1;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]).getTime();
      if (t >= targetMs) return i;
    }
    return -1;
  };

  return spots0.map((s, i) => {
    const w = windArray[i]?.hourly;
    const m = marineArray[i]?.hourly;
    const cdip = s.cdip_transect_id ? cdipByTransect.get(s.cdip_transect_id) : null;
    const windIdx = pickHourIndex(w?.time);
    const marineIdx = pickHourIndex(m?.time);
    const bestHourISO = (windIdx >= 0 ? w?.time?.[windIdx] : undefined) ?? (marineIdx >= 0 ? m?.time?.[marineIdx] : undefined);

    const cond: SurfConditions = {
        windSpeedKts: windIdx >= 0 ? msToKnots(w?.wind_speed_10m?.[windIdx] ?? 0) : undefined,
        windDirDeg: windIdx >= 0 ? w?.wind_direction_10m?.[windIdx] : undefined,
        waveHeightM: marineIdx >= 0 ? m?.wave_height?.[marineIdx] : undefined,
        waveDirDeg: marineIdx >= 0 ? m?.wave_direction?.[marineIdx] : undefined,
        wavePeriodS: marineIdx >= 0 ? m?.wave_period?.[marineIdx] : undefined,
        swellHeightM: cdip?.waveHs ?? (marineIdx >= 0 ? m?.swell_wave_height?.[marineIdx] : undefined),
        swellDirDeg: cdip?.waveDm ?? (marineIdx >= 0 ? m?.swell_wave_direction?.[marineIdx] : undefined),
        swellPeakPeriodS: cdip?.waveTp ?? (marineIdx >= 0 ? m?.swell_wave_period?.[marineIdx] : undefined) ?? (marineIdx >= 0 ? m?.wave_period?.[marineIdx] : undefined),
        swellAvgPeriodS: cdip?.waveTa,
        tideHeightFt: currentTide?.height,
        tideState: currentTide?.state as any,
        swellComponents: cdip?.swellComponents,
    };

    const { score, quality, reasons } = scoreSurfSpot(s as SurfSpotParams, cond);
    
    return {
      ...s,
      score,
      quality,
      reasons,
      conditions: cond,
      tideStation,
      swellComponents: cdip?.swellComponents,
      bestHourISO,
    };
  });
}
