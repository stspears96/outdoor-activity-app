import Database from "better-sqlite3";
import path from "node:path";
import { fetchCdipAtTime } from "./cdip";
import { scoreSurfSpot, type SurfSpotParams, type SurfConditions } from "./surfScoring";
import { fetchNearestTideStation, fetchTidePredictions } from "./noaa";
import { circularCenter, angularDist } from "./learning/buckets";
import type { Conditions } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "surfspots.sqlite");

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS activity_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_type TEXT    NOT NULL,
    spot_id       TEXT,
    spot_name     TEXT    NOT NULL,
    spot_lat      REAL    NOT NULL,
    spot_lon      REAL    NOT NULL,
    session_time  TEXT    NOT NULL,
    logged_at     TEXT    NOT NULL,
    rating        INTEGER NOT NULL,
    conditions_json TEXT  NOT NULL,
    model_score   INTEGER,
    model_version TEXT    DEFAULT 'v1'
  );
  CREATE INDEX IF NOT EXISTS idx_act_sessions_type ON activity_sessions(activity_type);
  CREATE INDEX IF NOT EXISTS idx_act_sessions_time ON activity_sessions(session_time);
`;

export type ActivitySession = {
  id: number;
  activity_type: string;
  spot_id: string | null;
  spot_name: string;
  spot_lat: number;
  spot_lon: number;
  session_time: string;
  logged_at: string;
  rating: number;
  conditions_json: string;
  model_score: number | null;
  model_version: string;
};

export async function logActivitySession(params: {
  activityType: string;
  spotId?: string | null;
  spotName: string;
  lat: number;
  lon: number;
  spotParams?: SurfSpotParams | null;
  cdipTransectId?: string | null;
  sessionTimeMs: number;
  rating: number;
}): Promise<{ id: number; model_score: number | null; conditions: Conditions }> {
  const isSurf = params.activityType === "surf";

  const [weatherResult, marineResult, cdipResult, tideResult] = await Promise.all([
    fetchWeather(params.lat, params.lon, params.sessionTimeMs),
    isSurf ? fetchMarine(params.lat, params.lon, params.sessionTimeMs) : Promise.resolve(null),
    isSurf && params.cdipTransectId
      ? fetchCdipAtTime(params.cdipTransectId, params.sessionTimeMs).catch(() => null)
      : Promise.resolve(null),
    isSurf ? fetchTideForSession(params.lat, params.lon, params.sessionTimeMs) : Promise.resolve(null),
  ]);

  const conditionsJson: Record<string, unknown> = {
    conditions_time: new Date(params.sessionTimeMs).toISOString(),
  };
  if (weatherResult) conditionsJson.weather = weatherResult;
  if (marineResult) conditionsJson.marine = marineResult;
  if (cdipResult && (cdipResult as any).ok) {
    const cdip = cdipResult as any;
    conditionsJson.cdip = {
      waveHs: cdip.waveHs,
      waveTp: cdip.waveTp,
      waveTa: cdip.waveTa,
      waveDm: cdip.waveDm,
      waveDp: cdip.waveDp,
      swellComponents: cdip.swellComponents,
    };
  }
  if (tideResult) conditionsJson.tide = tideResult;

  // Build Conditions object for localStorage learning
  const conditions: Conditions = {
    tempF: weatherResult ? weatherResult.tempC * 9 / 5 + 32 : 60,
    windMph: weatherResult ? weatherResult.windSpeedMs * 2.237 : 0,
    windDirDeg: weatherResult?.windDirDeg ?? 0,
    precipProb: weatherResult?.precipProbPct ?? 0,
    cloudCover: weatherResult?.cloudCover ?? 50,
    humidity: weatherResult?.humidity ?? 70,
    recentRainIn: 0,
    aqi: null,
    cape: 0,
    precipType: "none",
    precipIntensityMmh: weatherResult?.precipMmh ?? 0,
    visibilityKm: 10,
    timeISO: new Date(params.sessionTimeMs).toISOString(),
  };

  if (isSurf) {
    const cdip = cdipResult && (cdipResult as any).ok ? (cdipResult as any) : null;
    conditions.swellHeightM = cdip?.waveHs ?? marineResult?.swellHeightM ?? undefined;
    conditions.swellPeakPeriodS = cdip?.waveTp ?? marineResult?.swellPeriodS ?? undefined;
    conditions.swellAvgPeriodS = cdip?.waveTa ?? undefined;
    conditions.tideHeightFt = tideResult?.heightFt ?? undefined;
    conditions.tideState = tideResult?.state as ("rising" | "falling" | "stable") | undefined;

    if (
      params.spotParams &&
      typeof conditions.windDirDeg === "number" &&
      params.spotParams.wind_offshore_min_deg != null &&
      params.spotParams.wind_offshore_max_deg != null
    ) {
      const center = circularCenter(
        params.spotParams.wind_offshore_min_deg,
        params.spotParams.wind_offshore_max_deg
      );
      conditions.windOffshoreAngleDeg = angularDist(conditions.windDirDeg, center);
    }
  }

  // Compute model_score for surf
  let model_score: number | null = null;
  if (isSurf && params.spotParams) {
    try {
      const cdip = cdipResult && (cdipResult as any).ok ? (cdipResult as any) : null;
      const surfCond: SurfConditions = {
        windSpeedKts: weatherResult ? weatherResult.windSpeedMs * 1.943844 : undefined,
        windDirDeg: weatherResult?.windDirDeg,
        waveHeightM: marineResult?.waveHeightM,
        waveDirDeg: marineResult?.waveDirDeg,
        wavePeriodS: marineResult?.wavePeriodS,
        swellHeightM: cdip?.waveHs ?? marineResult?.swellHeightM,
        swellDirDeg: cdip?.waveDm ?? marineResult?.swellDirDeg,
        swellPeakPeriodS: cdip?.waveTp ?? marineResult?.swellPeriodS,
        swellAvgPeriodS: cdip?.waveTa,
        tideHeightFt: tideResult?.heightFt,
        tideState: tideResult?.state as any,
        swellComponents: cdip?.swellComponents,
      };
      const { score } = scoreSurfSpot(params.spotParams, surfCond);
      model_score = score;
    } catch { /* ignore scoring errors */ }
  }

  const db = new Database(DB_PATH);
  db.exec(CREATE_TABLE_SQL);
  const result = db.prepare(`
    INSERT INTO activity_sessions
      (activity_type, spot_id, spot_name, spot_lat, spot_lon, session_time, logged_at, rating, conditions_json, model_score, model_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1')
  `).run(
    params.activityType,
    params.spotId ?? null,
    params.spotName,
    params.lat,
    params.lon,
    new Date(params.sessionTimeMs).toISOString(),
    new Date().toISOString(),
    params.rating,
    JSON.stringify(conditionsJson),
    model_score,
  ) as { lastInsertRowid: number | bigint };
  db.close();

  return { id: Number(result.lastInsertRowid), model_score, conditions };
}

export function getAllSessions(): ActivitySession[] {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db
      .prepare(`SELECT * FROM activity_sessions ORDER BY session_time DESC`)
      .all() as ActivitySession[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

export function getSessionsByActivity(type: string): ActivitySession[] {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db
      .prepare(`SELECT * FROM activity_sessions WHERE activity_type = ? ORDER BY session_time DESC`)
      .all(type) as ActivitySession[];
    db.close();
    return rows;
  } catch {
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type WeatherSlot = {
  tempC: number;
  windSpeedMs: number;
  windDirDeg: number;
  precipProbPct: number;
  cloudCover: number;
  humidity: number;
  precipMmh: number;
};

async function fetchWeather(lat: number, lon: number, sessionTimeMs: number): Promise<WeatherSlot | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,cloud_cover,relative_humidity_2m,precipitation` +
      `&wind_speed_unit=ms&past_days=2&timezone=UTC`
    );
    const json = await res.json();
    const hourly = json.hourly ?? {};
    const times: string[] = hourly.time ?? [];

    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(times[i]);
      if (!Number.isFinite(t)) continue;
      const delta = Math.abs(t - sessionTimeMs);
      if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
    }
    if (bestIdx < 0) return null;

    return {
      tempC: hourly.temperature_2m?.[bestIdx] ?? 15,
      windSpeedMs: hourly.wind_speed_10m?.[bestIdx] ?? 0,
      windDirDeg: hourly.wind_direction_10m?.[bestIdx] ?? 0,
      precipProbPct: hourly.precipitation_probability?.[bestIdx] ?? 0,
      cloudCover: hourly.cloud_cover?.[bestIdx] ?? 50,
      humidity: hourly.relative_humidity_2m?.[bestIdx] ?? 70,
      precipMmh: hourly.precipitation?.[bestIdx] ?? 0,
    };
  } catch {
    return null;
  }
}

type MarineSlot = {
  waveHeightM: number;
  waveDirDeg: number;
  wavePeriodS: number;
  swellHeightM: number;
  swellDirDeg: number;
  swellPeriodS: number;
};

async function fetchMarine(lat: number, lon: number, sessionTimeMs: number): Promise<MarineSlot | null> {
  try {
    const res = await fetch(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period` +
      `&cell_selection=sea&past_days=2&timezone=UTC`
    );
    const json = await res.json();
    const hourly = json.hourly ?? {};
    const times: string[] = hourly.time ?? [];

    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(times[i]);
      if (!Number.isFinite(t)) continue;
      const delta = Math.abs(t - sessionTimeMs);
      if (delta < bestDelta) { bestDelta = delta; bestIdx = i; }
    }
    if (bestIdx < 0 || hourly.wave_height?.[bestIdx] == null) return null;

    return {
      waveHeightM: hourly.wave_height[bestIdx],
      waveDirDeg: hourly.wave_direction?.[bestIdx] ?? 0,
      wavePeriodS: hourly.wave_period?.[bestIdx] ?? 0,
      swellHeightM: hourly.swell_wave_height?.[bestIdx] ?? 0,
      swellDirDeg: hourly.swell_wave_direction?.[bestIdx] ?? 0,
      swellPeriodS: hourly.swell_wave_period?.[bestIdx] ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchTideForSession(
  lat: number,
  lon: number,
  sessionTimeMs: number
): Promise<{ heightFt: number; state: string } | null> {
  try {
    const station = await fetchNearestTideStation(lat, lon, 100);
    if (!station) return null;

    const predictions = await fetchTidePredictions(station.id, 48, 6);
    if (!predictions.length) return null;

    let closest = predictions[0];
    let minDelta = Infinity;
    for (const p of predictions) {
      const t = Date.parse(p.t.replace(" ", "T") + "Z");
      const delta = Math.abs(t - sessionTimeMs);
      if (delta < minDelta) { minDelta = delta; closest = p; }
    }

    const idx = predictions.indexOf(closest);
    let state = "stable";
    if (idx !== -1 && idx < predictions.length - 1) {
      const next = predictions[idx + 1];
      if (Number(next.v) > Number(closest.v) + 0.1) state = "rising";
      else if (Number(next.v) < Number(closest.v) - 0.1) state = "falling";
    }

    return { heightFt: Number(closest.v), state };
  } catch {
    return null;
  }
}
