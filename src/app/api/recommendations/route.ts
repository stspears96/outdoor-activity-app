import { NextResponse } from "next/server";
import type { RecommendationsResponse, WeatherResponse } from "@/lib/types";
import { scoreActivities } from "@/lib/scoring";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const windowHours = Number(searchParams.get("windowHours") ?? "6");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const wh = Number.isFinite(windowHours) ? Math.max(1, Math.min(24, windowHours)) : 6;

  // Call our own weather route (keeps provider logic in one place)
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const weatherRes = await fetch(`${baseUrl}/api/weather?lat=${lat}&lon=${lon}`, {
    next: { revalidate: 600 },
  });

  if (!weatherRes.ok) {
    return NextResponse.json({ error: "Failed to load weather" }, { status: 502 });
  }

  const weather = (await weatherRes.json()) as WeatherResponse;

  const activities = scoreActivities(weather, wh);

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
    hourlyPreview: preview,
  };

  return NextResponse.json(out);
}

