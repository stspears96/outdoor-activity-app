import type { ActivityId, ActivityScore, WeatherResponse } from "./types";
import { ACTIVITY_CATALOG } from "./activities";

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
  cafe: 3,
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

function precipToPenalty(p: number) {
  // p is probability 0-100
  if (p <= 10) return 1;
  if (p >= 70) return 0;
  return clamp(1 - (p - 10) / 60, 0, 1);
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

  // Default preferences by activity
  const prefs: Record<ActivityId, { temp: [number, number, number, number]; wind: [number, number]; precipWeight: number; windWeight: number; tempWeight: number; daytime: boolean }> = {
    run:    { temp: [40, 50, 70, 85], wind: [15, 25], precipWeight: 0.40, windWeight: 0.25, tempWeight: 0.35, daytime: true },
    hike:   { temp: [40, 55, 75, 90], wind: [18, 30], precipWeight: 0.50, windWeight: 0.15, tempWeight: 0.35, daytime: true },
    bike:   { temp: [45, 55, 75, 90], wind: [12, 22], precipWeight: 0.45, windWeight: 0.30, tempWeight: 0.25, daytime: true },
    mtb:    { temp: [40, 55, 75, 88], wind: [15, 25], precipWeight: 0.55, windWeight: 0.20, tempWeight: 0.25, daytime: true },
    picnic: { temp: [50, 60, 78, 92], wind: [10, 20], precipWeight: 0.55, windWeight: 0.20, tempWeight: 0.25, daytime: true },
    cafe:   { temp: [45, 55, 75, 90], wind: [12, 22], precipWeight: 0.55, windWeight: 0.15, tempWeight: 0.30, daytime: false },
    surf:   { temp: [45, 55, 75, 90], wind: [18, 30], precipWeight: 0.45, windWeight: 0.15, tempWeight: 0.40, daytime: true },
  };

  const p = prefs[id];

  // Best hour (highest per-hour mini-score)
  let bestHourISO: string | undefined;
  let bestScore01 = -1;
  let bestHourData = { temp: 0, wind: 0, precip: 0 };

  for (const i of idxs) {
    const timeISO = weather.hourly.time[i];
    const t = weather.hourly.apparent_temperature?.[i] ?? weather.hourly.temperature_2m?.[i];
    const w = weather.hourly.windspeed_10m?.[i];
    const pr = weather.hourly.precipitation_probability?.[i];

    const tComp = typeof t === "number" ? bandScore(t, p.temp[1], p.temp[2], p.temp[0], p.temp[3]) : 0.6;
    const wComp = typeof w === "number" ? mphToPenalty(w, p.wind[0], p.wind[1]) : 0.7;
    const prComp = typeof pr === "number" ? precipToPenalty(pr) : 0.7;

    let s = p.tempWeight * tComp + p.windWeight * wComp + p.precipWeight * prComp;
    
    // Day-specific sunrise/sunset check
    if (p.daytime && weather.daily?.sunrise && weather.daily?.sunset) {
        const hourTime = new Date(timeISO).getTime();
        const dateStr = timeISO.split('T')[0]; // "2026-02-20"
        
        // Find matching sunrise/sunset for this date
        const sunIdx = weather.daily.sunrise.findIndex(sr => sr.startsWith(dateStr));
        if (sunIdx !== -1) {
            const sunriseTime = new Date(weather.daily.sunrise[sunIdx]).getTime();
            const sunsetTime = new Date(weather.daily.sunset[sunIdx]).getTime();
            if (hourTime < sunriseTime || hourTime > sunsetTime) {
                s *= 0.1;
            }
        }
    }

    if (s > bestScore01) {
      bestScore01 = s;
      bestHourISO = timeISO;
      bestHourData = { temp: t ?? 0, wind: w ?? 0, precip: pr ?? 0 };
    }
  }

  const score = Math.round(clamp(bestScore01, 0, 1) * 100);

  const why: string[] = [];
  why.push(`Rain chance ~${Math.round(bestHourData.precip)}%`);
  why.push(`Wind ~${Math.round(bestHourData.wind)} mph`);
  why.push(`“Feels like” ~${Math.round(bestHourData.temp)}°F`);

  if (p.daytime && bestHourISO && weather.daily?.sunrise && weather.daily?.sunset) {
    const hourTime = new Date(bestHourISO).getTime();
    const dateStr = bestHourISO.split('T')[0];
    const sunIdx = weather.daily.sunrise.findIndex(sr => sr.startsWith(dateStr));
    if (sunIdx !== -1) {
        const sunriseTime = new Date(weather.daily.sunrise[sunIdx]).getTime();
        const sunsetTime = new Date(weather.daily.sunset[sunIdx]).getTime();
        if (hourTime < sunriseTime || hourTime > sunsetTime) {
            why.push("Note: Best hour is at night for this daytime activity");
        }
    }
  }

  // Little nudge so UI doesn't look too uniform
  const variance = (id.charCodeAt(0) % 7) / 200; // 0..0.03
  const finalScore = Math.round(clamp(lerp(score, score + score * variance, 1), 0, 100));

  return { id, name, score: finalScore, why, bestHourISO };
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
