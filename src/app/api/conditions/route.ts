import { NextResponse } from "next/server";
import type { WeatherResponse } from "@/lib/types";
import { computeConditions } from "@/lib/weather";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const windowHours = Number(searchParams.get("windowHours") ?? "6");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Invalid lat/lon" }, { status: 400 });
  }

  const wh = Math.max(1, Math.min(24, Number.isFinite(windowHours) ? windowHours : 6));

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const [weatherRes, aqiRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/weather?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
    fetch(`${baseUrl}/api/air-quality?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
  ]);

  if (weatherRes.status === "rejected" || !weatherRes.value.ok) {
    return NextResponse.json({ error: "Failed to fetch weather" }, { status: 502 });
  }

  const weather = (await weatherRes.value.json()) as WeatherResponse;

  let aqi: number | null = null;
  if (aqiRes.status === "fulfilled" && aqiRes.value.ok) {
    const d = await aqiRes.value.json();
    aqi = typeof d.aqi === "number" ? d.aqi : null;
  }

  const sunrise = weather.daily?.sunrise?.[0];
  const sunset = weather.daily?.sunset?.[0];

  const conditions = computeConditions(weather.hourly, wh, aqi, sunrise, sunset);
  return NextResponse.json({ conditions });
}
