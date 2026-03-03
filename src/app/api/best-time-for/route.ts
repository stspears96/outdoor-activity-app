import { NextResponse } from "next/server";
import type { ActivityId, WeatherResponse } from "@/lib/types";
import { computeActivityScore } from "@/lib/scoring";
import { ACTIVITY_CATALOG } from "@/lib/activities";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const activity = searchParams.get("activity") as ActivityId | null;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const activityEntry = ACTIVITY_CATALOG.find(a => a.id === activity);
  if (!activityEntry) {
    return NextResponse.json({ error: "Invalid activity" }, { status: 400 });
  }

  // Snap to nearest 0.025° (~3 km) to share Open-Meteo model cache entries
  // with individual-recommendations, which uses the same grid resolution.
  const normLat = Math.round(lat / 0.025) * 0.025;
  const normLon = Math.round(lon / 0.025) * 0.025;

  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  // No next: { revalidate } here — the weather route's internal fetchModel calls
  // already cache Open-Meteo responses. Caching the stitched response here risks
  // serving stale data when ECMWF was down at cache-population time.
  const weatherRes = await fetch(`${base}/api/weather?lat=${normLat}&lon=${normLon}`);
  if (!weatherRes.ok) {
    return NextResponse.json({ error: "Failed to fetch weather" }, { status: 502 });
  }

  const weatherRaw = await weatherRes.json();
  // Handle case where the weather route returns an array (batch response) instead of one object
  const weather = (Array.isArray(weatherRaw) ? weatherRaw[0] : weatherRaw) as WeatherResponse;
  if (!weather?.hourly?.time?.length) {
    return NextResponse.json({ error: "No hourly weather data available" }, { status: 502 });
  }

  const now = Date.now();

  const days: Array<{
    dateStr: string;
    id: ActivityId;
    name: string;
    score: number;
    why: string[];
    bestHourISO?: string;
  }> = [];

  for (let d = 0; d < 7; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateStr = `${y}-${mo}-${day}`;

    // For today use the current time so we only look forward.
    // For future days, start from sunrise (or 7am as fallback).
    let baseTimeMs: number;
    if (d === 0) {
      baseTimeMs = now;
    } else {
      const sunriseISO = weather.daily?.sunrise?.find(s => s.startsWith(dateStr));
      baseTimeMs = sunriseISO
        ? new Date(sunriseISO).getTime()
        : new Date(`${dateStr}T07:00:00`).getTime();
    }

    // 18 window hours covers a full daylight span for any latitude.
    const result = computeActivityScore(
      activityEntry.id,
      activityEntry.name,
      weather,
      18,
      baseTimeMs,
      dateStr,
    );

    // Only include days where scoring found valid hourly data.
    // Days beyond ~60h may have no entries when ECMWF is unavailable.
    if (result.bestHourISO) {
      days.push({ dateStr, ...result });
    }
  }

  days.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    activity: activityEntry.id,
    activityName: activityEntry.name,
    lat,
    lon,
    days,
  });
}
