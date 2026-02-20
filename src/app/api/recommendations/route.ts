import { NextResponse } from "next/server";
import type { RecommendationsResponse, WeatherResponse } from "@/lib/types";
import { scoreActivities } from "@/lib/scoring";
import { computeConditions } from "@/lib/weather";

function pickWindowIndices(time: string[], windowHours: number): number[] {
  const now = Date.now();
  const idxs: number[] = [];
  for (let i = 0; i < time.length; i++) {
    const t = new Date(time[i]).getTime();
    if (t >= now) idxs.push(i);
    if (idxs.length >= windowHours) break;
  }
  return idxs;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const windowHours = Number(searchParams.get("windowHours") ?? "6");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const wh = Number.isFinite(windowHours) ? Math.max(1, Math.min(24, windowHours)) : 6;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  // Fetch weather and AQI in parallel; AQI is best-effort
  const [weatherRes, aqiRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/weather?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
    fetch(`${baseUrl}/api/air-quality?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
  ]);

  if (weatherRes.status === "rejected" || !weatherRes.value.ok) {
    return NextResponse.json({ error: "Failed to load weather" }, { status: 502 });
  }

  const weather = (await weatherRes.value.json()) as WeatherResponse;

  let aqi: number | null = null;
  if (aqiRes.status === "fulfilled" && aqiRes.value.ok) {
    const aqiData = await aqiRes.value.json();
    aqi = typeof aqiData.aqi === "number" ? aqiData.aqi : null;
  }

  const activities = scoreActivities(weather, wh);

  const conditions = computeConditions(weather.hourly, wh, aqi);

  // Small hourly preview for UI (next wh hours)
  const now = Date.now();
  const preview: RecommendationsResponse["hourlyPreview"] = [];
  for (let i = 0; i < weather.hourly.time.length && preview.length < wh; i++) {
    const t = new Date(weather.hourly.time[i]).getTime();
    if (t < now) continue;

    preview.push({
      timeISO: weather.hourly.time[i],
      tempF: weather.hourly.apparent_temperature?.[i] ?? weather.hourly.temperature_2m?.[i],
      precipProb: weather.hourly.precipitation_probability?.[i],
      windMph: weather.hourly.windspeed_10m?.[i],
    });
  }

  const out: RecommendationsResponse = {
    lat,
    lon,
    windowHours: wh,
    generatedAtISO: new Date().toISOString(),
    activities,
    conditions,
    hourlyPreview: preview,
  };

  return NextResponse.json(out);
}
