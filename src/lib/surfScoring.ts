// ---------- helpers ----------
function inDegWindow(deg: number, minDeg: number, maxDeg: number) {
  const d = ((deg % 360) + 360) % 360;
  const a = ((minDeg % 360) + 360) % 360;
  const b = ((maxDeg % 360) + 360) % 360;
  if (a <= b) return d >= a && d <= b;
  return d >= a || d <= b;
}

function circularCenter(minDeg: number, maxDeg: number): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const sinMean = (Math.sin(toR(minDeg)) + Math.sin(toR(maxDeg))) / 2;
  const cosMean = (Math.cos(toR(minDeg)) + Math.cos(toR(maxDeg))) / 2;
  return ((Math.atan2(sinMean, cosMean) * 180) / Math.PI + 360) % 360;
}

function angularDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const CARDINAL_16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function toCardinal(deg: number): string {
  const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return CARDINAL_16[i];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export type SurfConditions = {
  windSpeedKts?: number;
  windDirDeg?: number;
  waveHeightM?: number;
  wavePeriodS?: number;
  waveDirDeg?: number;
  swellHeightM?: number;
  swellPeakPeriodS?: number;
  swellAvgPeriodS?: number;
  swellPeriodDiffS?: number;
  swellDirDeg?: number;
  tideHeightFt?: number;
  tideState?: "rising" | "falling" | "stable";
};

export type SurfSpotParams = {
  wind_offshore_min_deg?: number | null;
  wind_offshore_max_deg?: number | null;
  swell_min_deg?: number | null;
  swell_max_deg?: number | null;
  tide_preference?: string | null;
};

export type SurfQuality = "poor" | "fair" | "good" | "excellent";

export function scoreSurfSpot(
  params: SurfSpotParams,
  cond: SurfConditions
): { score: number; quality: SurfQuality; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;

  const windDir = cond.windDirDeg;
  const windKts = cond.windSpeedKts;

  const swellDir = cond.swellDirDeg ?? cond.waveDirDeg;
  const swellH   = cond.swellHeightM ?? cond.waveHeightM;
  const swellP   = cond.swellPeakPeriodS ?? cond.wavePeriodS;

  // ── Wind direction ──
  if (typeof windDir === "number" && params.wind_offshore_min_deg != null && params.wind_offshore_max_deg != null) {
    const offCenter = circularCenter(params.wind_offshore_min_deg, params.wind_offshore_max_deg);
    const dist = angularDist(windDir, offCenter);
    const pts = Math.round(Math.cos((dist * Math.PI) / 180) * 20);
    score += pts;

    const label =
      dist <= 30  ? "offshore" :
      dist <= 70  ? "side-offshore" :
      dist <= 110 ? "sideshore" :
      dist <= 150 ? "side-onshore" :
                    "onshore";
    const icon = pts >= 12 ? "✅" : pts >= 0 ? "" : pts >= -10 ? "⚠️" : "❌";
    reasons.push(`Wind ${toCardinal(windDir)} — ${label} (${icon})`);
  } else if (typeof windDir === "number") {
    reasons.push(`Wind ${toCardinal(windDir)} (${Math.round(windDir)}°)`);
  }

  // ── Wind speed ──
  if (typeof windKts === "number") {
    let pts = 0;
    if (windKts <= 5)       { pts = 12; reasons.push(`${windKts.toFixed(0)} kts — light ✅`); }
    else if (windKts <= 10) { pts = 6;  reasons.push(`${windKts.toFixed(0)} kts — moderate`); }
    else if (windKts <= 15) { pts = 1;  reasons.push(`${windKts.toFixed(0)} kts — breezy`); }
    else if (windKts <= 20) { pts = -8; reasons.push(`${windKts.toFixed(0)} kts — windy ⚠️`); }
    else                    { pts = -16; reasons.push(`${windKts.toFixed(0)} kts — very windy ❌`); }
    score += pts;
  }

  // ── Swell ──
  if (typeof swellH === "number" || typeof swellP === "number" || typeof swellDir === "number") {
    const parts: string[] = [];

    if (typeof swellH === "number") {
      if (swellH < 0.5)       { score -= 10; parts.push(`${swellH.toFixed(1)}m (flat)`); }
      else if (swellH < 1.2)  { score += 6;  parts.push(`${swellH.toFixed(1)}m`); }
      else if (swellH < 2.2)  { score += 10; parts.push(`${swellH.toFixed(1)}m`); }
      else                    { score -= 4;  parts.push(`${swellH.toFixed(1)}m (large)`); }
    }

    if (typeof swellP === "number") {
      if (swellP >= 14)      { score += 12; parts.push(`${swellP.toFixed(0)}s`); }
      else if (swellP >= 11) { score += 8;  parts.push(`${swellP.toFixed(0)}s`); }
      else if (swellP >= 8)  { score += 3;  parts.push(`${swellP.toFixed(0)}s`); }
      else                   { score -= 6;  parts.push(`${swellP.toFixed(0)}s (short)`); }
    }

    if (typeof swellDir === "number") {
      const dir = `${toCardinal(swellDir)} (${Math.round(swellDir)}°)`;
      if (params.swell_min_deg != null && params.swell_max_deg != null) {
        if (inDegWindow(swellDir, params.swell_min_deg, params.swell_max_deg)) {
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

    if (parts.length > 0) {
        reasons.push(`Swell: ${parts.join(", ")}`);
    }
  }

  // ── Tide ──
  if (typeof cond.tideHeightFt === "number" && params.tide_preference && params.tide_preference !== "any") {
    const h = cond.tideHeightFt;
    const pref = params.tide_preference;
    let tidePts = 0;

    if (pref === "low") {
      if (h < 2.5)      { tidePts = 10; reasons.push(`Tide ${h.toFixed(1)}ft — optimal low ✅`); }
      else if (h < 4.5) { tidePts = 0;  reasons.push(`Tide ${h.toFixed(1)}ft — getting high`); }
      else              { tidePts = -10; reasons.push(`Tide ${h.toFixed(1)}ft — too high ⚠️`); }
    } else if (pref === "high") {
      if (h > 4.5)      { tidePts = 10; reasons.push(`Tide ${h.toFixed(1)}ft — optimal high ✅`); }
      else if (h > 2.5) { tidePts = 0;  reasons.push(`Tide ${h.toFixed(1)}ft — getting low`); }
      else              { tidePts = -10; reasons.push(`Tide ${h.toFixed(1)}ft — too low ⚠️`); }
    } else if (pref === "mid") {
      if (h >= 2.5 && h <= 4.5) { tidePts = 10; reasons.push(`Tide ${h.toFixed(1)}ft — optimal mid ✅`); }
      else                      { tidePts = -5;  reasons.push(`Tide ${h.toFixed(1)}ft — outside mid range`); }
    }
    score += tidePts;
  } else if (typeof cond.tideHeightFt === "number") {
    reasons.push(`Tide: ${cond.tideHeightFt.toFixed(1)}ft ${cond.tideState ? `(${cond.tideState})` : ""}`);
  }

  score = clamp(Math.round(score), 0, 100);

  let quality: SurfQuality = "poor";
  if (score >= 78)      quality = "excellent";
  else if (score >= 60) quality = "good";
  else if (score >= 42) quality = "fair";

  return { score, quality, reasons };
}

export function qualityToColor(quality: SurfQuality): string {
  switch (quality) {
    case "excellent": return "#059669"; // Green-600
    case "good":      return "#10b981"; // Green-500
    case "fair":      return "#f59e0b"; // Amber-500
    case "poor":      default: return "#ef4444"; // Red-500
  }
}
