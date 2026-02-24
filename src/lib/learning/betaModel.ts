import type { ActivityId, Conditions } from "@/lib/types";
import type { AB, ActivityBetaParams, BetaParams } from "./types";
import { getBuckets, BUCKET_DIMS } from "./buckets";

// ─── Replicated scoring primitives (match scoring.ts) ────────────────────────

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function bandScore(x: number, bestLo: number, bestHi: number, minLo: number, maxHi: number) {
  if (x >= bestLo && x <= bestHi) return 1;
  if (x < bestLo) return clamp((x - minLo) / (bestLo - minLo), 0, 1);
  return clamp((maxHi - x) / (maxHi - bestHi), 0, 1);
}

function mphToPenalty(mph: number, soft: number, hard: number) {
  if (mph <= soft) return 1;
  if (mph >= hard) return 0;
  return clamp(1 - (mph - soft) / (hard - soft), 0, 1);
}

function precipToPenalty(p: number) {
  if (p <= 10) return 1;
  if (p >= 70) return 0;
  return clamp(1 - (p - 10) / 60, 0, 1);
}

// Activity preferences (mirrors scoring.ts PREFS)
const PREFS: Record<ActivityId, {
  temp: [number, number, number, number]; // [minLo, bestLo, bestHi, maxHi]
  wind: [number, number];                 // [soft, hard]
  daytime: boolean;
}> = {
  run:    { temp: [40, 50, 70, 85], wind: [15, 25], daytime: true },
  hike:   { temp: [40, 55, 75, 90], wind: [18, 30], daytime: true },
  bike:   { temp: [45, 55, 75, 90], wind: [12, 22], daytime: true },
  mtb:    { temp: [40, 55, 75, 88], wind: [15, 25], daytime: true },
  picnic: { temp: [50, 60, 78, 92], wind: [10, 20], daytime: true },
  surf:   { temp: [45, 55, 75, 90], wind: [18, 30], daytime: true },
};

const ACTIVITY_IDS: ActivityId[] = ["run", "hike", "bike", "mtb", "picnic", "surf"];
const CONCENTRATION = 10;

// ─── Temp bucket midpoints ────────────────────────────────────────────────────

const TEMP_MIDPOINTS: Record<string, number> = {
  frigid: 0,
  freezing: 21,
  cold: 41,
  cool: 57.5,
  mild: 72.5,
  hot: 87.5,
  extreme_hot: 100,
};

const WIND_MIDPOINTS: Record<string, number> = {
  glassy: 1.5,
  calm: 5.5,
  breezy: 13,
  windy: 23,
  stormy: 35,
};

const RAIN_MIDPOINTS: Record<string, number> = {
  none: 7.5,
  possible: 27.5,
  likely: 55,
  heavy: 85,
};

// ─── Prior helpers ────────────────────────────────────────────────────────────

const NEUTRAL: AB = { alpha: 5, beta: 5 };
const STRONG_NEG: AB = { alpha: 1, beta: 9 };

function serverDerivedAB(goodness01: number): AB {
  const alpha = Math.max(0.5, Math.min(9.5, CONCENTRATION * goodness01));
  return { alpha, beta: CONCENTRATION - alpha };
}

function neutralMap(buckets: string[]): Record<string, AB> {
  return Object.fromEntries(buckets.map(b => [b, { ...NEUTRAL }]));
}

// ─── Initialise priors for one activity ──────────────────────────────────────

function initActivityBetaParams(id: ActivityId): ActivityBetaParams {
  const p = PREFS[id];

  // Temperature — server-derived, override extremes
  const temp: Record<string, AB> = {};
  for (const [bucket, mid] of Object.entries(TEMP_MIDPOINTS)) {
    if (bucket === "frigid" || bucket === "extreme_hot") {
      temp[bucket] = { ...STRONG_NEG };
    } else {
      temp[bucket] = serverDerivedAB(bandScore(mid, p.temp[1], p.temp[2], p.temp[0], p.temp[3]));
    }
  }

  // Wind speed — server-derived, override stormy
  const wind: Record<string, AB> = {};
  for (const [bucket, mid] of Object.entries(WIND_MIDPOINTS)) {
    if (bucket === "stormy") {
      wind[bucket] = { ...STRONG_NEG };
    } else {
      wind[bucket] = serverDerivedAB(mphToPenalty(mid, p.wind[0], p.wind[1]));
    }
  }

  // Rain probability — server-derived
  const rain: Record<string, AB> = {};
  for (const [bucket, mid] of Object.entries(RAIN_MIDPOINTS)) {
    rain[bucket] = serverDerivedAB(precipToPenalty(mid));
  }

  // AQI — neutral except hazardous
  const aqi = neutralMap(["good", "moderate", "unhealthy"]);
  aqi["hazardous"] = { ...STRONG_NEG };

  // Lightning — neutral except high
  const lightning = neutralMap(["low", "moderate"]);
  lightning["high"] = { ...STRONG_NEG };

  // Interaction: tempWind — neutral except extremes
  const tempWind = neutralMap(["cold_windy", "cold_calm", "comfortable", "hot_calm", "hot_windy"]);
  tempWind["frigid_any"] = { ...STRONG_NEG };
  tempWind["extreme_hot_any"] = { ...STRONG_NEG };

  // Swell height — meaningful priors for surf, neutral for others
  const swellHeight = neutralMap(["flat", "small", "waist_high", "head_high", "overhead"]);
  if (id === "surf") {
    swellHeight["flat"]      = { ...STRONG_NEG };
    swellHeight["small"]     = serverDerivedAB(0.4);
    swellHeight["waist_high"]= serverDerivedAB(0.85);
    swellHeight["head_high"] = serverDerivedAB(0.9);
    swellHeight["overhead"]  = serverDerivedAB(0.6);
  }

  // Peak Period
  const swellPeakPeriod = neutralMap(["short", "medium", "good", "long"]);
  if (id === "surf") {
    swellPeakPeriod["short"]  = { ...STRONG_NEG };
    swellPeakPeriod["medium"] = serverDerivedAB(0.5);
    swellPeakPeriod["good"]   = serverDerivedAB(0.85);
    swellPeakPeriod["long"]   = serverDerivedAB(0.95);
  }

  // Average Period
  const swellAvgPeriod = neutralMap(["short", "medium", "good", "long"]);
  if (id === "surf") {
    swellAvgPeriod["short"]  = { ...STRONG_NEG };
    swellAvgPeriod["medium"] = serverDerivedAB(0.4);
    swellAvgPeriod["good"]   = serverDerivedAB(0.7);
    swellAvgPeriod["long"]   = serverDerivedAB(0.85);
  }

  // Period Diff (Tp - Ta)
  const swellPeriodDiff = neutralMap(["very_small", "small", "moderate", "large"]);
  if (id === "surf") {
    swellPeriodDiff["very_small"] = serverDerivedAB(0.3);
    swellPeriodDiff["small"]      = serverDerivedAB(0.6);
    swellPeriodDiff["moderate"]   = serverDerivedAB(0.9);
    swellPeriodDiff["large"]      = serverDerivedAB(0.95);
  }

  // Wind vs offshore window
  const windOffshore = neutralMap(["offshore", "side_offshore", "sideshore", "side_onshore", "onshore"]);
  if (id === "surf") {
    windOffshore["offshore"]     = serverDerivedAB(0.95);
    windOffshore["side_offshore"]= serverDerivedAB(0.75);
    windOffshore["sideshore"]    = serverDerivedAB(0.4);
    windOffshore["side_onshore"] = serverDerivedAB(0.2);
    windOffshore["onshore"]      = { ...STRONG_NEG };
  }

  // Daylight
  const daylight = neutralMap(["day", "night"]);
  if (p.daytime) {
    daylight["day"] = serverDerivedAB(0.9);
    daylight["night"] = { ...STRONG_NEG };
  }

  return {
    temp,
    wind,
    windDir: neutralMap(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
    rain,
    cloud: neutralMap(["clear", "partly", "overcast"]),
    humidity: neutralMap(["dry", "comfortable", "humid", "oppressive"]),
    recentRain: neutralMap(["none", "light", "moderate", "heavy"]),
    aqi,
    lightning,
    precipType: neutralMap(["none", "drizzle", "rain", "snow", "freezing_rain"]),
    precipIntensity: neutralMap(["none", "light", "moderate", "heavy"]),
    visibility: neutralMap(["excellent", "good", "moderate", "poor"]),
    windRain: neutralMap(["good", "ok", "marginal", "bad", "terrible"]),
    tempWind,
    daylight,
    swellHeight,
    swellPeakPeriod,
    swellAvgPeriod,
    swellPeriodDiff,
    windOffshore,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initBetaParams(): BetaParams {
  const params: Partial<BetaParams> = {};
  for (const id of ACTIVITY_IDS) {
    params[id] = initActivityBetaParams(id);
  }
  return params as BetaParams;
}

export function updateBeta(
  betaParams: BetaParams,
  activityId: ActivityId,
  conditions: Conditions,
  rating01: number
): void {
  const actParams = betaParams[activityId];
  if (!actParams) return;

  const buckets = getBuckets(conditions);

  for (const [variable, bucketLabel] of Object.entries(buckets)) {
    let varParams = (actParams as Record<string, Record<string, AB>>)[variable];
    if (!varParams) {
      const dim = BUCKET_DIMS.find(d => d.key === variable);
      if (!dim) continue;
      varParams = neutralMap(dim.buckets);
      (actParams as Record<string, Record<string, AB>>)[variable] = varParams;
    }
    const ab = varParams[bucketLabel];
    if (!ab) continue;
    ab.alpha += rating01;
    ab.beta += 1 - rating01;
  }
}

export function predictBeta(
  betaParams: BetaParams,
  activityId: ActivityId,
  conditions: Conditions
): number {
  const actParams = betaParams[activityId];
  if (!actParams) return 0.5;

  const buckets = getBuckets(conditions);

  let totalGoodness = 0;
  let count = 0;

  for (const { key } of BUCKET_DIMS) {
    const varParams = (actParams as Record<string, Record<string, AB>>)[key];
    if (!varParams) continue;
    const bucketLabel = buckets[key];
    if (!bucketLabel) continue;
    const ab = varParams[bucketLabel];
    if (!ab) continue;
    totalGoodness += ab.alpha / (ab.alpha + ab.beta);
    count++;
  }

  return count === 0 ? 0.5 : totalGoodness / count;
}
