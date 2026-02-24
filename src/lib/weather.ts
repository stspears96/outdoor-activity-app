import type { Conditions, WeatherHourly } from "./types";

function pickWindowIndices(
  time: string[],
  windowHours: number,
  baseTimeMs?: number,
  dateStr?: string,
): number[] {
  const now = typeof baseTimeMs === "number" ? baseTimeMs : Date.now();
  const idxs: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (dateStr && !time[i].startsWith(dateStr)) continue;
    const t = new Date(time[i]).getTime();
    if (t >= now) idxs.push(i);
    if (idxs.length >= windowHours) break;
  }
  if (idxs.length === 0 && time.length > 0) {
    if (Number.isFinite(baseTimeMs)) {
      let startIdx = -1;
      for (let i = 0; i < time.length; i++) {
        if (dateStr && !time[i].startsWith(dateStr)) continue;
        const t = new Date(time[i]).getTime();
        if (t >= (baseTimeMs as number)) {
          startIdx = i;
          break;
        }
      }
      if (startIdx === -1) startIdx = Math.max(0, time.length - 1);
      for (let i = startIdx; i < time.length && idxs.length < windowHours; i++) {
        if (dateStr && !time[i].startsWith(dateStr)) continue;
        idxs.push(i);
      }
    } else {
      for (let i = 0; i < time.length && idxs.length < windowHours; i++) {
        if (dateStr && !time[i].startsWith(dateStr)) continue;
        idxs.push(i);
      }
    }
  }
  return idxs;
}

type PrecipType = "none" | "drizzle" | "rain" | "snow" | "freezing_rain";

function wmoToPrecipType(code: number): PrecipType {
  if (code >= 56 && code <= 57) return "freezing_rain";
  if (code >= 66 && code <= 67) return "freezing_rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 61 && code <= 65) return "rain";
  if (code >= 51 && code <= 55) return "drizzle";
  return "none";
}

const PRECIP_TYPE_SEVERITY: Record<PrecipType, number> = {
  none: 0,
  drizzle: 1,
  rain: 2,
  snow: 3,
  freezing_rain: 4,
};

export function computeConditions(
  hourly: WeatherHourly,
  windowHours: number,
  aqi: number | null,
  sunrise?: string,
  sunset?: string,
  baseTimeMs?: number,
  dateStr?: string
): Conditions {
  const idxs = pickWindowIndices(hourly.time, windowHours, baseTimeMs, dateStr);
  const now = typeof baseTimeMs === "number" ? baseTimeMs : Date.now();

  // Temperature: avg apparent/temperature_2m over window
  const tempVals = idxs
    .map(i => hourly.apparent_temperature?.[i] ?? hourly.temperature_2m?.[i])
    .filter((v): v is number => typeof v === "number");
  const tempF = tempVals.length > 0
    ? tempVals.reduce((a, b) => a + b, 0) / tempVals.length
    : 65;

  // Wind speed: max over window
  const windVals = idxs
    .map(i => hourly.windspeed_10m?.[i])
    .filter((v): v is number => typeof v === "number");
  const windMph = windVals.length > 0 ? Math.max(...windVals) : 0;

  // Wind direction: circular mean
  const windDirVals = idxs
    .map(i => hourly.winddirection_10m?.[i])
    .filter((v): v is number => typeof v === "number");
  let windDirDeg = 180;
  if (windDirVals.length > 0) {
    const sinMean = windDirVals.reduce((s, d) => s + Math.sin(d * Math.PI / 180), 0) / windDirVals.length;
    const cosMean = windDirVals.reduce((s, d) => s + Math.cos(d * Math.PI / 180), 0) / windDirVals.length;
    windDirDeg = ((Math.atan2(sinMean, cosMean) * 180 / Math.PI) + 360) % 360;
  }

  // Precip probability: max over window
  const precipProbVals = idxs
    .map(i => hourly.precipitation_probability?.[i])
    .filter((v): v is number => typeof v === "number");
  const precipProb = precipProbVals.length > 0 ? Math.max(...precipProbVals) : 0;

  // Cloud cover: avg over window
  const cloudVals = idxs
    .map(i => hourly.cloudcover?.[i])
    .filter((v): v is number => typeof v === "number");
  const cloudCover = cloudVals.length > 0
    ? cloudVals.reduce((a, b) => a + b, 0) / cloudVals.length
    : 50;

  // Humidity: avg over window
  const humVals = idxs
    .map(i => hourly.relativehumidity_2m?.[i])
    .filter((v): v is number => typeof v === "number");
  const humidity = humVals.length > 0
    ? humVals.reduce((a, b) => a + b, 0) / humVals.length
    : 50;

  // Recent rain: sum precipitation over past 24h (inches)
  const past24hStart = now - 24 * 3600 * 1000;
  let recentRainIn = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]).getTime();
    if (t >= past24hStart && t < now) {
      recentRainIn += hourly.precipitation?.[i] ?? 0;
    }
  }

  // CAPE: max over window
  const capeVals = idxs
    .map(i => hourly.cape?.[i])
    .filter((v): v is number => typeof v === "number");
  const cape = capeVals.length > 0 ? Math.max(...capeVals) : 0;

  // Precip type: most severe in window (from WMO weathercode)
  const wmoVals = idxs
    .map(i => hourly.weathercode?.[i])
    .filter((v): v is number => typeof v === "number");
  let precipType: PrecipType = "none";
  for (const code of wmoVals) {
    const t = wmoToPrecipType(code);
    if (PRECIP_TYPE_SEVERITY[t] > PRECIP_TYPE_SEVERITY[precipType]) {
      precipType = t;
    }
  }

  // Precip intensity: max precipitation in window, converted to mm/h
  // (weather route requests precipitation_unit: "inch", so values are inches/h)
  const precipVals = idxs
    .map(i => hourly.precipitation?.[i])
    .filter((v): v is number => typeof v === "number");
  const maxPrecipIn = precipVals.length > 0 ? Math.max(...precipVals) : 0;
  const precipIntensityMmh = maxPrecipIn * 25.4;

  // Visibility: min over window, converted from meters to km
  const visVals = idxs
    .map(i => hourly.visibility?.[i])
    .filter((v): v is number => typeof v === "number");
  const visibilityKm = visVals.length > 0 ? Math.min(...visVals) / 1000 : 10;

  return {
    tempF,
    windMph,
    windDirDeg,
    precipProb,
    cloudCover,
    humidity,
    recentRainIn,
    aqi,
    cape,
    precipType,
    precipIntensityMmh,
    visibilityKm,
    sunrise,
    sunset,
  };
}
