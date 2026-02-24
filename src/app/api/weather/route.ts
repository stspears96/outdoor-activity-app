import { NextResponse } from "next/server";
import type { WeatherResponse, WeatherHourly } from "@/lib/types";

const HOURLY_FIELDS: (keyof WeatherHourly)[] = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "windspeed_10m",
  "windgusts_10m",
  "cloudcover",
  "winddirection_10m",
  "relativehumidity_2m",
  "visibility",
  "weathercode",
  "cape",
];

// Model cutoffs: HRRR for 0–24 h, NAM for 24–60 h, ECMWF beyond
const HRRR_CUTOFF_MS = 24 * 3600 * 1000;
const NAM_CUTOFF_MS = 60 * 3600 * 1000;

function buildUrl(lat: string, lon: string, model: string): string {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    models: model,
    hourly: HOURLY_FIELDS.join(","),
    daily: "sunrise,sunset",
    temperature_unit: "fahrenheit",
    windspeed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

async function fetchModel(lat: string, lon: string, model: string): Promise<any> {
  try {
    const res = await fetch(buildUrl(lat, lon, model), {
      next: { revalidate: 600 },
      headers: { "User-Agent": "outdoor-activity-app/1.0" },
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

type FieldValueMap = Map<string, number | null>;

function buildFieldMaps(response: any): Map<keyof WeatherHourly, FieldValueMap> {
  const out = new Map<keyof WeatherHourly, FieldValueMap>();
  const times: string[] = response?.hourly?.time ?? [];
  for (const field of HOURLY_FIELDS) {
    const map: FieldValueMap = new Map();
    for (let i = 0; i < times.length; i++) {
      map.set(times[i], response.hourly[field]?.[i] ?? null);
    }
    out.set(field, map);
  }
  return out;
}

function stitchOne(hrrr: any, nam: any, ecmwf: any, nowMs: number): WeatherResponse {
  const hrrrMaps = hrrr ? buildFieldMaps(hrrr) : null;
  const namMaps = nam ? buildFieldMaps(nam) : null;
  const ecmwfMaps = ecmwf ? buildFieldMaps(ecmwf) : null;

  // Union of all time strings, sorted — gives full coverage across all model windows
  const allTimes = new Set<string>([
    ...(hrrr?.hourly?.time ?? []),
    ...(nam?.hourly?.time ?? []),
    ...(ecmwf?.hourly?.time ?? []),
  ]);
  const sortedTimes = [...allTimes].sort();
  const timeToMs = new Map(sortedTimes.map(t => [t, new Date(t).getTime()]));

  const hourly: WeatherHourly = { time: sortedTimes };

  for (const field of HOURLY_FIELDS) {
    const hrrrMap = hrrrMaps?.get(field);
    const namMap = namMaps?.get(field);
    const ecmwfMap = ecmwfMaps?.get(field);

    hourly[field] = sortedTimes.map(t => {
      const offset = timeToMs.get(t)! - nowMs;
      // Prefer HRRR today, NAM through end of its window, ECMWF beyond
      const preferred =
        offset < HRRR_CUTOFF_MS
          ? [hrrrMap, namMap, ecmwfMap]
          : offset < NAM_CUTOFF_MS
          ? [namMap, ecmwfMap, hrrrMap]
          : [ecmwfMap, namMap, hrrrMap];

      for (const map of preferred) {
        if (!map) continue;
        const v = map.get(t);
        if (typeof v === "number") return v;
      }
      return null;
    }) as number[];
  }

  const base = ecmwf ?? nam ?? hrrr;
  return {
    latitude: base.latitude,
    longitude: base.longitude,
    timezone: base.timezone,
    hourly,
    // Use ECMWF daily for longest sunrise/sunset coverage
    daily: ecmwf?.daily ?? nam?.daily ?? hrrr?.daily ?? { sunrise: [], sunset: [] },
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get("lat");
  const lonParam = searchParams.get("lon");

  if (!latParam || !lonParam) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const nowMs = Date.now();

  const [hrrrData, namData, ecmwfData] = await Promise.all([
    fetchModel(latParam, lonParam, "hrrr_conus"),
    fetchModel(latParam, lonParam, "nam_conus"),
    fetchModel(latParam, lonParam, "ecmwf_ifs"),
  ]);

  if (!hrrrData && !namData && !ecmwfData) {
    return NextResponse.json({ error: "All weather model fetches failed" }, { status: 502 });
  }

  const toArr = (d: any): any[] => !d ? [] : Array.isArray(d) ? d : [d];
  const hrrrArr = toArr(hrrrData);
  const namArr = toArr(namData);
  const ecmwfArr = toArr(ecmwfData);
  const count = Math.max(hrrrArr.length, namArr.length, ecmwfArr.length);

  const results = Array.from({ length: count }, (_, i) =>
    stitchOne(hrrrArr[i] ?? null, namArr[i] ?? null, ecmwfArr[i] ?? null, nowMs)
  );

  return NextResponse.json(count === 1 ? results[0] : results);
}
