import type { Conditions } from "@/lib/types";

// ─── Bucket assignment functions ─────────────────────────────────────────────

export function getTempBucket(tempF: number): string {
  if (tempF < 10) return "frigid";
  if (tempF < 32) return "freezing";
  if (tempF < 50) return "cold";
  if (tempF < 65) return "cool";
  if (tempF < 80) return "mild";
  if (tempF < 95) return "hot";
  return "extreme_hot";
}

export function getWindBucket(windMph: number): string {
  if (windMph < 3) return "glassy";
  if (windMph < 8) return "calm";
  if (windMph < 18) return "breezy";
  if (windMph < 28) return "windy";
  return "stormy";
}

export function getWindDirBucket(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 337.5 || d < 22.5) return "N";
  if (d < 67.5) return "NE";
  if (d < 112.5) return "E";
  if (d < 157.5) return "SE";
  if (d < 202.5) return "S";
  if (d < 247.5) return "SW";
  if (d < 292.5) return "W";
  return "NW";
}

export function getRainBucket(precipProb: number): string {
  if (precipProb < 15) return "none";
  if (precipProb < 40) return "possible";
  if (precipProb < 70) return "likely";
  return "heavy";
}

export function getCloudBucket(cloudCover: number): string {
  if (cloudCover < 25) return "clear";
  if (cloudCover < 70) return "partly";
  return "overcast";
}

export function getHumidityBucket(humidity: number): string {
  if (humidity < 30) return "dry";
  if (humidity < 60) return "comfortable";
  if (humidity < 80) return "humid";
  return "oppressive";
}

export function getRecentRainBucket(recentRainIn: number): string {
  if (recentRainIn <= 0) return "none";
  if (recentRainIn < 0.25) return "light";
  if (recentRainIn < 1) return "moderate";
  return "heavy";
}

export function getAqiBucket(aqi: number | null): string {
  if (aqi === null || aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy";
  return "hazardous";
}

export function getLightningBucket(cape: number): string {
  if (cape < 500) return "low";
  if (cape < 1500) return "moderate";
  return "high";
}

export function getPrecipIntensityBucket(precipIntensityMmh: number): string {
  if (precipIntensityMmh <= 0) return "none";
  if (precipIntensityMmh < 2) return "light";
  if (precipIntensityMmh < 10) return "moderate";
  return "heavy";
}

export function getVisibilityBucket(visibilityKm: number): string {
  if (visibilityKm >= 10) return "excellent";
  if (visibilityKm >= 5) return "good";
  if (visibilityKm >= 1) return "moderate";
  return "poor";
}

export function getWindRainBucket(windBucket: string, rainBucket: string): string {
  const isStormy = windBucket === "stormy";
  const isWindy = windBucket === "windy";
  const isCalm = windBucket === "glassy" || windBucket === "calm";
  const isBreezy = windBucket === "breezy";
  const noRain = rainBucket === "none";
  const possibleRain = rainBucket === "possible";
  const likelyRain = rainBucket === "likely";
  const heavyRain = rainBucket === "heavy";

  if (isStormy || heavyRain) return "terrible";
  if (isWindy && likelyRain) return "bad";
  if (isWindy || likelyRain) return "marginal";
  if (isCalm && noRain) return "good";
  if ((isCalm || isBreezy) && possibleRain) return "ok";
  if (isBreezy && noRain) return "ok";
  return "marginal";
}

// ─── Surf-specific bucket functions ──────────────────────────────────────────

export function getSwellHeightBucket(m: number): string {
  if (m < 0.3) return "flat";
  if (m < 0.8) return "small";
  if (m < 1.5) return "waist_high";
  if (m < 2.5) return "head_high";
  return "overhead";
}

export function getSwellPeriodBucket(s: number): string {
  if (s < 8) return "short";
  if (s < 11) return "medium";
  if (s < 14) return "good";
  return "long";
}

// windOffshoreAngleDeg: degrees from the offshore window centre (0=dead offshore, 180=onshore)
export function getWindOffshoreBucket(deg: number): string {
  if (deg <= 30) return "offshore";
  if (deg <= 70) return "side_offshore";
  if (deg <= 110) return "sideshore";
  if (deg <= 150) return "side_onshore";
  return "onshore";
}

// Angular helpers (shared with surf/route.ts)
export function circularCenter(minDeg: number, maxDeg: number): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const sinMean = (Math.sin(toR(minDeg)) + Math.sin(toR(maxDeg))) / 2;
  const cosMean = (Math.cos(toR(minDeg)) + Math.cos(toR(maxDeg))) / 2;
  return ((Math.atan2(sinMean, cosMean) * 180) / Math.PI + 360) % 360;
}

export function angularDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function getTempWindBucket(tempBucket: string, windBucket: string): string {
  if (tempBucket === "frigid") return "frigid_any";
  if (tempBucket === "extreme_hot") return "extreme_hot_any";

  const isWindy = windBucket === "windy" || windBucket === "stormy";

  if (tempBucket === "freezing" || tempBucket === "cold") {
    return isWindy ? "cold_windy" : "cold_calm";
  }
  if (tempBucket === "hot") {
    return isWindy ? "hot_windy" : "hot_calm";
  }
  return "comfortable";
}

// ─── All-bucket extractor ─────────────────────────────────────────────────────

export type BucketMap = Record<string, string>;

export function getBuckets(cond: Conditions): BucketMap {
  const tempBucket = getTempBucket(cond.tempF);
  const windBucket = getWindBucket(cond.windMph);
  const rainBucket = getRainBucket(cond.precipProb);

  const result: BucketMap = {
    temp: tempBucket,
    wind: windBucket,
    windDir: getWindDirBucket(cond.windDirDeg),
    rain: rainBucket,
    cloud: getCloudBucket(cond.cloudCover),
    humidity: getHumidityBucket(cond.humidity),
    recentRain: getRecentRainBucket(cond.recentRainIn),
    aqi: getAqiBucket(cond.aqi),
    lightning: getLightningBucket(cond.cape),
    precipType: cond.precipType, // already a bucket label
    precipIntensity: getPrecipIntensityBucket(cond.precipIntensityMmh),
    visibility: getVisibilityBucket(cond.visibilityKm),
    windRain: getWindRainBucket(windBucket, rainBucket),
    tempWind: getTempWindBucket(tempBucket, windBucket),
  };

  if (cond.timeISO && cond.sunrise && cond.sunset) {
    const t = new Date(cond.timeISO).getTime();
    const sr = new Date(cond.sunrise).getTime();
    const ss = new Date(cond.sunset).getTime();
    result.daylight = (t >= sr && t <= ss) ? "day" : "night";
  } else {
    result.daylight = "day";
  }

  // Surf-specific dims — only included when the caller supplies them
  if (cond.swellHeightM != null) result.swellHeight = getSwellHeightBucket(cond.swellHeightM);
  if (cond.swellPeriodS != null) result.swellPeriod = getSwellPeriodBucket(cond.swellPeriodS);
  if (cond.windOffshoreAngleDeg != null) result.windOffshore = getWindOffshoreBucket(cond.windOffshoreAngleDeg);

  return result;
}

// ─── Feature vector (20 values) for linear / GP models ───────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function extractFeatures(cond: Conditions): number[] {
  const tempNorm = clamp((cond.tempF - 65) / 30, -2, 2);
  const windSpeedNorm = clamp(cond.windMph / 30, 0, 2);
  const windDirRad = (cond.windDirDeg * Math.PI) / 180;
  const windDirSin = Math.sin(windDirRad);
  const windDirCos = Math.cos(windDirRad);
  const rainProbNorm = cond.precipProb / 100;
  const cloudNorm = cond.cloudCover / 100;
  const humidityNorm = cond.humidity / 100;
  const recentRainNorm = clamp(cond.recentRainIn, 0, 2);
  const aqiNorm = clamp((cond.aqi ?? 0) / 150, 0, 2);
  const lightningNorm = clamp(cond.cape / 1500, 0, 2);
  const precipIntensityNorm = clamp(cond.precipIntensityMmh / 10, 0, 2);
  const visibilityNorm = 1 - Math.min(cond.visibilityKm / 10, 1); // inverted: 1=poor

  return [
    1,                                        // 0: bias
    tempNorm,                                 // 1
    windSpeedNorm,                            // 2
    windDirSin,                               // 3
    windDirCos,                               // 4
    rainProbNorm,                             // 5
    cloudNorm,                                // 6
    humidityNorm,                             // 7
    recentRainNorm,                           // 8
    aqiNorm,                                  // 9
    lightningNorm,                            // 10
    precipIntensityNorm,                      // 11
    visibilityNorm,                           // 12
    tempNorm * tempNorm,                      // 13: tempNorm²
    windSpeedNorm * windSpeedNorm,            // 14: windSpeedNorm²
    windSpeedNorm * rainProbNorm,             // 15
    tempNorm * windSpeedNorm,                 // 16
    tempNorm * humidityNorm,                  // 17
    rainProbNorm * cloudNorm,                 // 18
    precipIntensityNorm * rainProbNorm,       // 19
  ];
}

// ─── Bucket label lists (used for initialisation and UI) ─────────────────────

export const BUCKET_DIMS: Array<{ key: string; label: string; buckets: string[] }> = [
  { key: "temp",             label: "Temperature",      buckets: ["frigid","freezing","cold","cool","mild","hot","extreme_hot"] },
  { key: "wind",             label: "Wind speed",       buckets: ["glassy","calm","breezy","windy","stormy"] },
  { key: "windDir",          label: "Wind direction",   buckets: ["N","NE","E","SE","S","SW","W","NW"] },
  { key: "rain",             label: "Rain probability", buckets: ["none","possible","likely","heavy"] },
  { key: "cloud",            label: "Cloud cover",      buckets: ["clear","partly","overcast"] },
  { key: "humidity",         label: "Humidity",         buckets: ["dry","comfortable","humid","oppressive"] },
  { key: "recentRain",       label: "Recent rain",      buckets: ["none","light","moderate","heavy"] },
  { key: "aqi",              label: "Air quality",      buckets: ["good","moderate","unhealthy","hazardous"] },
  { key: "lightning",        label: "Lightning risk",   buckets: ["low","moderate","high"] },
  { key: "precipType",       label: "Precip type",      buckets: ["none","drizzle","rain","snow","freezing_rain"] },
  { key: "precipIntensity",  label: "Precip intensity", buckets: ["none","light","moderate","heavy"] },
  { key: "visibility",       label: "Visibility",       buckets: ["excellent","good","moderate","poor"] },
  { key: "windRain",         label: "Wind × Rain",      buckets: ["good","ok","marginal","bad","terrible"] },
  { key: "tempWind",         label: "Temp × Wind",      buckets: ["frigid_any","cold_windy","cold_calm","comfortable","hot_calm","hot_windy","extreme_hot_any"] },
  // Surf-only dims (present only when conditions include surf data)
  { key: "swellHeight",      label: "Swell height",     buckets: ["flat","small","waist_high","head_high","overhead"] },
  { key: "swellPeriod",      label: "Swell period",     buckets: ["short","medium","good","long"] },
  { key: "windOffshore",     label: "Wind vs offshore", buckets: ["offshore","side_offshore","sideshore","side_onshore","onshore"] },
  { key: "daylight",         label: "Daylight",         buckets: ["day", "night"] },
];
