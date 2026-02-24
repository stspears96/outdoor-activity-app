export const CDIP_FREQS = [
  0.04, 0.045, 0.05, 0.055, 0.06, 0.065, 0.07, 0.075,
  0.0813, 0.09, 0.1, 0.11, 0.1225, 0.14, 0.16, 0.18,
  0.2075, 0.25, 0.3125, 0.4,
];

export type SpectralSwell = {
  Hs: number;           // significant wave height (m)
  Tp: number;           // peak period (s) = 1/fp
  dirDeg: number;       // energy-weighted mean direction (°T)
  spreadingDeg: number; // energy-weighted directional spreading (°)
  isWindSea: boolean;   // Tp < 8s OR spreading > 45°
};

// Bandwidth df[i]: midpoint between adjacent band centers
function bandwidths(): number[] {
  const n = CDIP_FREQS.length;
  const df: number[] = new Array(n);
  df[0] = CDIP_FREQS[1] - CDIP_FREQS[0];
  df[n - 1] = CDIP_FREQS[n - 1] - CDIP_FREQS[n - 2];
  for (let i = 1; i < n - 1; i++) {
    df[i] = (CDIP_FREQS[i + 1] - CDIP_FREQS[i - 1]) / 2;
  }
  return df;
}

// Parse 20-float space-separated string into number[]
export function parseSpectralArray(s: string): number[] {
  return s.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
}

// Directional spreading per band: σ = sqrt(2(1 - r1)) * (180/π)
// r1 = sqrt(a1² + b1²), clamp r1 to [0,1]
function bandSpreading(a1: number[], b1: number[]): number[] {
  return a1.map((a, i) => {
    const b = b1[i] ?? 0;
    const r1 = Math.min(1, Math.sqrt(a * a + b * b));
    return Math.sqrt(2 * (1 - r1)) * (180 / Math.PI);
  });
}

// Main partitioning: find local energy maxima, split at valleys
export function partitionSwells(
  energy: number[],
  dir: number[],
  a1: number[],
  b1: number[]
): SpectralSwell[] {
  const df = bandwidths();
  const spreading = bandSpreading(a1, b1);

  // 1. Smooth energy (3-pt moving average)
  const smooth: number[] = [...energy];
  for (let i = 1; i < energy.length - 1; i++) {
    smooth[i] = (energy[i - 1] + energy[i] + energy[i + 1]) / 3;
  }

  // 2. Find local maxima indices
  const maxima: number[] = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    if (smooth[i] > smooth[i - 1] && smooth[i] > smooth[i + 1]) {
      maxima.push(i);
    }
  }

  // 3. If 0 maxima → treat whole spectrum as one partition
  let partitions: [number, number][];
  if (maxima.length === 0) {
    partitions = [[0, energy.length - 1]];
  } else {
    // 4. Find valleys between consecutive maxima, split there
    const boundaries: number[] = [];
    for (let k = 0; k < maxima.length - 1; k++) {
      const lo = maxima[k];
      const hi = maxima[k + 1];
      let minIdx = lo + 1;
      let minVal = smooth[lo + 1];
      for (let i = lo + 2; i < hi; i++) {
        if (smooth[i] < minVal) {
          minVal = smooth[i];
          minIdx = i;
        }
      }
      boundaries.push(minIdx);
    }

    const starts = [0, ...boundaries.map((b) => b + 1)];
    const ends = [...boundaries, energy.length - 1];
    partitions = starts.map((s, i) => [s, ends[i]] as [number, number]);
  }

  // 5. Compute stats for each partition
  const swells: SpectralSwell[] = partitions.map(([lo, hi]) => {
    let totalE = 0;
    let sinSum = 0;
    let cosSum = 0;
    let weightedSpread = 0;
    let peakE = -Infinity;
    let peakFreq = CDIP_FREQS[lo];

    for (let i = lo; i <= hi; i++) {
      const e = energy[i] * df[i];
      totalE += e;
      const rad = (dir[i] * Math.PI) / 180;
      sinSum += e * Math.sin(rad);
      cosSum += e * Math.cos(rad);
      weightedSpread += e * spreading[i];
      if (energy[i] > peakE) {
        peakE = energy[i];
        peakFreq = CDIP_FREQS[i];
      }
    }

    const Hs = 4 * Math.sqrt(Math.max(0, totalE));
    const Tp = peakFreq > 0 ? 1 / peakFreq : 0;
    const dirDeg =
      totalE > 0
        ? ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360
        : 0;
    const spreadingDeg = totalE > 0 ? weightedSpread / totalE : 90;
    const isWindSea = Tp < 8 || spreadingDeg > 45;

    return { Hs, Tp, dirDeg, spreadingDeg, isWindSea };
  });

  // 6. Filter out components with Hs < 0.05m (noise)
  const filtered = swells.filter((s) => s.Hs >= 0.05);

  // 7. Sort by Hs desc, return top 3
  filtered.sort((a, b) => b.Hs - a.Hs);
  return filtered.slice(0, 3);
}
