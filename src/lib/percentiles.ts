import type { ActivityId } from "./types";
import { PERCENTILE_TABLES } from "./percentile-tables";

// Rightmost insertion point for val in sorted Float32Array (standard bisect-right).
function bisectRight(arr: Float32Array, val: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= val) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Map a raw 0–1 activity score to a percentile rank (0–100) against the
 * historical Bay Area distribution stored in PERCENTILE_TABLES.
 *
 * Falls back to `raw * 100` if no table exists yet (i.e. before first
 * `npm run calibrate`).
 */
export function rawScoreToPercentile(id: ActivityId, raw: number): number {
  const table = PERCENTILE_TABLES[id];
  if (!table || table.length === 0) return Math.round(raw * 100);
  return Math.round((bisectRight(table, raw) / table.length) * 100);
}
