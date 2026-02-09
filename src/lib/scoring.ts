import type { ActivityId, ActivityScore, WeatherResponse } from "./types";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Score a value where "best" is a band [bestLo, bestHi] and drops outside.
function bandScore(x: number, bestLo: number, bestHi: number, minLo: number, maxHi: number) {
  if (x >= bestLo && x <= bestHi) return 1;
  if (x < bestLo) return clamp((x - minLo) / (bestLo - minLo), 0, 1);
  return clamp((maxHi - x) / (maxHi - bestHi), 0, 1);
}

function pickHourIndices(weather: WeatherResponse, windowHours: number) {
  const times = weather.hourly.time;
  const now = Date.now();
  const idxs: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (t >= now) idxs.push(i);
    if (idxs.length >= windowHours) break;
  }
  return idxs;
}

function avg(arr: (number | undefined)[]) {
  const vals = arr.filter((v): v is number => typeof v === "number");
  if (!vals.length) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function max(arr: (number | undefined)[]) {
  const vals = arr.filter((v): v is number => typeof v === "number");
  if (!vals.length) return undefined;
  return Math.max(...vals);
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

function computeActivityScore(
  id: ActivityId,
  name: string,
  weather: WeatherResponse,
  windowHours: number
): ActivityScore {
  const idxs = pickHourIndices(weather, windowHours);

  const tempF = avg(idxs.map(i => weather.hourly.apparent_temperature?.[i] ?? weather.hourly.temperature_2m?.[i]));
  const precipProb = max(idxs.map(i => weather.hourly.precipitation_probability?.[i]));
  const windMph = max(idxs.map(i => weather.hourly.windspeed_10m?.[i]));

  // Default preferences by activity
  const prefs: Record<ActivityId, { temp: [number, number, number, number]; wind: [number, number]; precipWeight: number; windWeight: number; tempWeight: number }> = {
    walk:   { temp: [45, 55, 75, 90], wind: [18, 28], precipWeight: 0.45, windWeight: 0.20, tempWeight: 0.35 },
    run:    { temp: [40, 50, 70, 85], wind: [15, 25], precipWeight: 0.40, windWeight: 0.25, tempWeight: 0.35 },
    hike:   { temp: [40, 55, 75, 90], wind: [18, 30], precipWeight: 0.50, windWeight: 0.15, tempWeight: 0.35 },
    bike:   { temp: [45, 55, 75, 90], wind: [12, 22], precipWeight: 0.45, windWeight: 0.30, tempWeight: 0.25 },
    picnic: { temp: [50, 60, 78, 92], wind: [10, 20], precipWeight: 0.55, windWeight: 0.20, tempWeight: 0.25 },
    cafe:   { temp: [45, 55, 75, 90], wind: [12, 22], precipWeight: 0.55, windWeight: 0.15, tempWeight: 0.30 },
    surf:{ temp: [45, 55, 75, 90], wind: [18, 30], precipWeight: 0.45, windWeight: 0.15, tempWeight: 0.40 },
  };

  const p = prefs[id];

  const tempComponent = typeof tempF === "number"
    ? bandScore(tempF, p.temp[1], p.temp[2], p.temp[0], p.temp[3])
    : 0.6;

  const windComponent = typeof windMph === "number"
    ? mphToPenalty(windMph, p.wind[0], p.wind[1])
    : 0.7;

  const precipComponent = typeof precipProb === "number"
    ? precipToPenalty(precipProb)
    : 0.7;

  const score01 =
    p.tempWeight * tempComponent +
    p.windWeight * windComponent +
    p.precipWeight * precipComponent;

  const score = Math.round(clamp(score01, 0, 1) * 100);

  const why: string[] = [];
  if (typeof precipProb === "number") why.push(`Max rain chance ~${Math.round(precipProb)}% in the next ${windowHours}h`);
  if (typeof windMph === "number") why.push(`Peak wind ~${Math.round(windMph)} mph`);
  if (typeof tempF === "number") why.push(`Avg “feels like” ~${Math.round(tempF)}°F`);

  // Best hour (highest per-hour mini-score)
  let bestHourISO: string | undefined;
  let best = -1;

  for (const i of idxs) {
    const t = weather.hourly.apparent_temperature?.[i] ?? weather.hourly.temperature_2m?.[i];
    const w = weather.hourly.windspeed_10m?.[i];
    const pr = weather.hourly.precipitation_probability?.[i];

    const tComp = typeof t === "number" ? bandScore(t, p.temp[1], p.temp[2], p.temp[0], p.temp[3]) : 0.6;
    const wComp = typeof w === "number" ? mphToPenalty(w, p.wind[0], p.wind[1]) : 0.7;
    const prComp = typeof pr === "number" ? precipToPenalty(pr) : 0.7;

    const s = p.tempWeight * tComp + p.windWeight * wComp + p.precipWeight * prComp;
    if (s > best) {
      best = s;
      bestHourISO = weather.hourly.time[i];
    }
  }

  // Little nudge so UI doesn't look too uniform
  const variance = (id.charCodeAt(0) % 7) / 200; // 0..0.03
  const finalScore = Math.round(clamp(lerp(score, score + score * variance, 1), 0, 100));

  return { id, name, score: finalScore, why, bestHourISO };
}

export function scoreActivities(weather: WeatherResponse, windowHours: number) {
  const catalog: Array<{ id: ActivityId; name: string }> = [
    { id: "walk", name: "Walk" },
    { id: "run", name: "Run" },
    { id: "hike", name: "Hike" },
    { id: "bike", name: "Bike" },
    { id: "picnic", name: "Picnic" },
    { id: "cafe", name: "Outdoor café" },
    { id: "surf", name: "Surf" },
  ];

  const activities = catalog
    .map(a => computeActivityScore(a.id, a.name, weather, windowHours))
    .sort((a, b) => b.score - a.score);

  return activities;
}

