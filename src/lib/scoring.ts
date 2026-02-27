import type { ActivityId, ActivityScore, WeatherResponse } from "./types";
import { ACTIVITY_CATALOG } from "./activities";
import { rawScoreToPercentile } from "./percentiles";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const ACTIVITY_WINDOW_HOURS: Partial<Record<ActivityId, number>> = {
  run: 3,
  hike: 3,
  bike: 3,
  mtb: 3,
  picnic: 3,
  surf: 3,
};

export function getActivityWindowHours(id: ActivityId, defaultHours: number) {
  const raw = typeof ACTIVITY_WINDOW_HOURS[id] === "number" ? ACTIVITY_WINDOW_HOURS[id]! : defaultHours;
  return clamp(raw, 1, 24);
}

// Score a value where "best" is a band [bestLo, bestHi] and drops outside.
function bandScore(x: number, bestLo: number, bestHi: number, minLo: number, maxHi: number) {
  if (x >= bestLo && x <= bestHi) return 1;
  if (x < bestLo) return clamp((x - minLo) / (bestLo - minLo), 0, 1);
  return clamp((maxHi - x) / (maxHi - bestHi), 0, 1);
}

function pickHourIndices(
  weather: WeatherResponse,
  windowHours: number,
  baseTimeMs?: number,
  dateStr?: string,
) {
  const times = weather.hourly.time;
  const now = typeof baseTimeMs === "number" ? baseTimeMs : Date.now();
  const idxs: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (dateStr && !times[i].startsWith(dateStr)) continue;
    const t = new Date(times[i]).getTime();
    if (t >= now) idxs.push(i);
    if (idxs.length >= windowHours) break;
  }
  if (idxs.length === 0 && times.length > 0) {
    if (Number.isFinite(baseTimeMs)) {
      let startIdx = -1;
      for (let i = 0; i < times.length; i++) {
        if (dateStr && !times[i].startsWith(dateStr)) continue;
        const t = new Date(times[i]).getTime();
        if (t >= (baseTimeMs as number)) {
          startIdx = i;
          break;
        }
      }
      if (startIdx === -1) startIdx = Math.max(0, times.length - 1);
      for (let i = startIdx; i < times.length && idxs.length < windowHours; i++) {
        if (dateStr && !times[i].startsWith(dateStr)) continue;
        idxs.push(i);
      }
    } else {
      for (let i = 0; i < times.length && idxs.length < windowHours; i++) {
        if (dateStr && !times[i].startsWith(dateStr)) continue;
        idxs.push(i);
      }
    }
  }
  return idxs;
}

function mphToPenalty(mph: number, soft: number, hard: number) {
  // 1 at <=soft, 0 at >=hard
  if (mph <= soft) return 1;
  if (mph >= hard) return 0;
  return clamp(1 - (mph - soft) / (hard - soft), 0, 1);
}

// Penalty from actual precipitation in inches/hr.
// 0 in/hr → 1.0 (dry), 0.2+ in/hr → 0.0 (moderate rain).
function precipToPenalty(inHr: number) {
  if (inHr <= 0) return 1;
  if (inHr >= 0.2) return 0;
  return clamp(1 - inHr / 0.2, 0, 1);
}

// Per-activity scoring preferences.
// temp: [minLo, bestLo, bestHi, maxHi] in °F — narrower ideal bands = more score spread
// cloudIdeal: [lo, hi] in % — ideal cloud cover range for the activity
// weights must sum to 1.0
const ACTIVITY_PREFS: Record<
  ActivityId,
  {
    temp: [number, number, number, number];
    cloudIdeal: [number, number];
    wind: [number, number];
    precipWeight: number;
    windWeight: number;
    tempWeight: number;
    cloudWeight: number;
  }
> = {
  //                temp band (°F)        cloud ideal    wind (mph)  precip  wind  temp  cloud
  run:    { temp: [40, 55, 65, 82], cloudIdeal: [20, 50], wind: [15, 25], precipWeight: 0.35, windWeight: 0.22, tempWeight: 0.31, cloudWeight: 0.12 },
  hike:   { temp: [42, 58, 70, 88], cloudIdeal: [20, 60], wind: [18, 30], precipWeight: 0.44, windWeight: 0.13, tempWeight: 0.31, cloudWeight: 0.12 },
  bike:   { temp: [45, 58, 70, 88], cloudIdeal: [10, 40], wind: [12, 22], precipWeight: 0.40, windWeight: 0.26, tempWeight: 0.22, cloudWeight: 0.12 },
  mtb:    { temp: [40, 55, 68, 85], cloudIdeal: [20, 70], wind: [15, 25], precipWeight: 0.50, windWeight: 0.18, tempWeight: 0.22, cloudWeight: 0.10 },
  picnic: { temp: [52, 65, 75, 90], cloudIdeal: [0,  25], wind: [10, 20], precipWeight: 0.47, windWeight: 0.17, tempWeight: 0.21, cloudWeight: 0.15 },
  surf:   { temp: [48, 58, 68, 88], cloudIdeal: [0,  30], wind: [18, 30], precipWeight: 0.40, windWeight: 0.13, tempWeight: 0.35, cloudWeight: 0.12 },
};

/**
 * Compute the raw 0–1 score for an activity given specific conditions.
 * No nighttime penalty is applied here — that is handled separately.
 * This function is used both in live scoring and by the calibration script.
 */
export function computeRawScore(
  id: ActivityId,
  tempF: number,
  windMph: number,
  precipInHr: number,
  cloudPct: number,
): number {
  const p = ACTIVITY_PREFS[id];
  const tComp  = bandScore(tempF,     p.temp[1],        p.temp[2],        p.temp[0], p.temp[3]);
  const wComp  = mphToPenalty(windMph, p.wind[0], p.wind[1]);
  const prComp = precipToPenalty(precipInHr);
  const cComp  = bandScore(cloudPct,  p.cloudIdeal[0],  p.cloudIdeal[1],  0,         100);
  return p.tempWeight * tComp + p.windWeight * wComp + p.precipWeight * prComp + p.cloudWeight * cComp;
}

export function computeActivityScore(
  id: ActivityId,
  name: string,
  weather: WeatherResponse,
  windowHours: number,
  baseTimeMs?: number,
  dateStr?: string,
): ActivityScore {
  const idxs = pickHourIndices(weather, windowHours, baseTimeMs, dateStr);

  let bestHourISO: string | undefined;
  let bestRaw = -1;
  // Display values for the best hour (precipitation_probability shown to user if available)
  let bestDisplay = { tempF: 0, windMph: 0, precipProb: 0 };

  for (const i of idxs) {
    const timeISO = weather.hourly.time[i];
    const tempF      = weather.hourly.apparent_temperature?.[i] ?? weather.hourly.temperature_2m?.[i] ?? 65;
    const windMph    = weather.hourly.windspeed_10m?.[i] ?? 5;
    const precipInHr = weather.hourly.precipitation?.[i] ?? 0;
    const cloudPct   = weather.hourly.cloudcover?.[i] ?? 50;
    // precipitation_probability is only used for display in the why string
    const precipProb = weather.hourly.precipitation_probability?.[i] ?? Math.round(Math.min(100, precipInHr / 0.2 * 100));

    const raw = computeRawScore(id, tempF, windMph, precipInHr, cloudPct);

    if (raw > bestRaw) {
      bestRaw = raw;
      bestHourISO = timeISO;
      bestDisplay = { tempF, windMph, precipProb };
    }
  }

  const score = bestRaw >= 0 ? rawScoreToPercentile(id, bestRaw) : 0;

  const why: string[] = [];
  why.push(`Rain chance ~${Math.round(bestDisplay.precipProb)}%`);
  why.push(`Wind ~${Math.round(bestDisplay.windMph)} mph`);
  why.push(`"Feels like" ~${Math.round(bestDisplay.tempF)}°F`);

  return { id, name, score, why, bestHourISO };
}

export function scoreActivities(
  weather: WeatherResponse,
  windowHours: number,
  baseTimeMs?: number,
  dateStr?: string,
) {
  const activities = ACTIVITY_CATALOG
    .map(a => {
      const wh = getActivityWindowHours(a.id, windowHours);
      return computeActivityScore(a.id, a.name, weather, wh, baseTimeMs, dateStr);
    })
    .sort((a, b) => b.score - a.score);

  return activities;
}
