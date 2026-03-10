import type { ActivityId, Conditions } from "@/lib/types";
import type { LinearParams } from "./types";
import { extractFeatures } from "./buckets";

const NUM_FEATURES = 25;

export function initLinearParams(): LinearParams {
  // Start with small uniform weights; bias = 0.5 for neutral prior
  const weights = new Array(NUM_FEATURES).fill(0);
  weights[0] = 0.5; // bias term → initial prediction = 0.5
  return { weights, updateCount: 0 };
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function updateLinear(
  params: LinearParams,
  conditions: Conditions,
  rating01: number
): void {
  const features = extractFeatures(conditions);
  // Extend weights array if stored model predates surf features (backwards compat)
  while (params.weights.length < features.length) {
    params.weights.push(0);
  }
  const lr = 0.05 / (1 + params.updateCount / 20);

  const pred = Math.max(0, Math.min(1, dotProduct(params.weights, features)));
  const error = rating01 - pred;

  for (let i = 0; i < params.weights.length; i++) {
    params.weights[i] += lr * error * features[i];
  }

  params.updateCount++;
}

export function predictLinear(
  params: LinearParams,
  conditions: Conditions
): number {
  const features = extractFeatures(conditions);
  return Math.max(0, Math.min(1, dotProduct(params.weights, features)));
}

export function initAllLinearParams(activityIds: ActivityId[]): Record<ActivityId, LinearParams> {
  const result: Partial<Record<ActivityId, LinearParams>> = {};
  for (const id of activityIds) {
    result[id] = initLinearParams();
  }
  return result as Record<ActivityId, LinearParams>;
}
