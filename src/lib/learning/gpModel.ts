import type { ActivityId, Conditions } from "@/lib/types";
import type { GpConfig, GpObservation } from "./types";
import { extractFeatures } from "./buckets";

// Length scales per feature dimension (Gaussian kernel)
// h=1e9 for bias (no distance), h=0.5 for circular wind features,
// h=0.25 for base, h=0.35 for quadratic/interaction
export const DEFAULT_LENGTH_SCALES: number[] = [
  1e9,  // 0: bias
  0.25, // 1: tempNorm
  0.25, // 2: windSpeedNorm
  0.5,  // 3: windDirSin
  0.5,  // 4: windDirCos
  0.25, // 5: rainProbNorm
  0.25, // 6: cloudNorm
  0.25, // 7: humidityNorm
  0.25, // 8: recentRainNorm
  0.25, // 9: aqiNorm
  0.25, // 10: lightningNorm
  0.25, // 11: precipIntensityNorm
  0.25, // 12: visibilityNorm
  0.35, // 13: tempNorm²
  0.35, // 14: windSpeedNorm²
  0.35, // 15: windSpeedNorm×rainProbNorm
  0.35, // 16: tempNorm×windSpeedNorm
  0.35, // 17: tempNorm×humidityNorm
  0.35, // 18: rainProbNorm×cloudNorm
  0.35, // 19: precipIntensityNorm×rainProbNorm
  // Surf-specific (indices 20–24)
  0.25, // 20: swellHeightNorm
  0.25, // 21: swellPeakPeriodNorm
  0.25, // 22: swellPeriodDiffNorm
  0.25, // 23: windOffshoreNorm
  0.3,  // 24: tideHeightNorm
];

export function initGpConfig(): GpConfig {
  return {
    observations: [],
    lengthScales: [...DEFAULT_LENGTH_SCALES],
  };
}

export function addGpObservation(
  config: GpConfig,
  activityId: ActivityId,
  conditions: Conditions,
  rating01: number
): void {
  const obs: GpObservation = {
    features: extractFeatures(conditions),
    rating: rating01,
    activityId,
  };
  config.observations.push(obs);
}

export function predictGp(
  config: GpConfig,
  activityId: ActivityId,
  conditions: Conditions
): number {
  const actObs = config.observations.filter(o => o.activityId === activityId);
  if (actObs.length === 0) return 0.5;

  const query = extractFeatures(conditions);
  // Extend stored length-scales array if it predates surf features (backwards compat)
  const scales = query.length > config.lengthScales.length
    ? [...config.lengthScales, ...DEFAULT_LENGTH_SCALES.slice(config.lengthScales.length)]
    : config.lengthScales;

  // Nadaraya–Watson kernel regression
  // o.features[i] may be undefined for old 20-dim stored observations — treat as 0
  const kernelWeights = actObs.map(o => {
    let sumSq = 0;
    for (let i = 0; i < query.length; i++) {
      if (scales[i] >= 1e8) continue; // skip bias
      const diff = (query[i] - (o.features[i] ?? 0)) / scales[i];
      sumSq += diff * diff;
    }
    return Math.exp(-0.5 * sumSq);
  });

  const totalWeight = kernelWeights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return 0.5;

  return kernelWeights.reduce((acc, w, i) => acc + w * actObs[i].rating, 0) / totalWeight;
}
