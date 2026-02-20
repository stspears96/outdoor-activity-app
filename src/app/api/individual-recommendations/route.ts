import { NextResponse } from "next/server";
import type { ActivityId, RecommendationsResponse, WeatherResponse, TrailItem } from "@/lib/types";
import { computeActivityScore } from "@/lib/scoring";
import { computeConditions } from "@/lib/weather";

function mapDbActivitiesToActivityId(dbActivities: string): ActivityId | null {
    if (!dbActivities) return null;
    const lower = dbActivities.toLowerCase();
    if (lower.includes("hiking")) return "hike";
    if (lower.includes("running")) return "run";
    if (lower.includes("mountain biking")) return "mtb";
    if (lower.includes("bike")) return "bike";
    // Add other mappings as needed
    return null;
}

function findHourIndex(times: string[], target: string): number {
  return times.findIndex(t => t === target);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const windowHours = Number(searchParams.get("windowHours") ?? "6");
  const radiusKm = Number(searchParams.get("radiusKm") ?? "16");
  const activityType = searchParams.get("activityType");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const wh = Number.isFinite(windowHours) ? Math.max(1, Math.min(24, windowHours)) : 6;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  let activitiesUrl = `${baseUrl}/api/activities-db?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}`;
  if (activityType) {
    activitiesUrl += `&activityType=${activityType}`;
  }

  // Fetch weather, AQI, and activities in parallel
  const [weatherRes, aqiRes, activitiesRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/weather?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
    fetch(`${baseUrl}/api/air-quality?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
    fetch(activitiesUrl),
  ]);

  if (weatherRes.status === "rejected" || !weatherRes.value.ok) {
    return NextResponse.json({ error: "Failed to load weather" }, { status: 502 });
  }
  const weather = (await weatherRes.value.json()) as WeatherResponse;

  if (activitiesRes.status === "rejected" || !activitiesRes.value.ok) {
    return NextResponse.json({ error: "Failed to load activities" }, { status: 502 });
  }
  const activitiesData = await activitiesRes.value.json();
  const individualActivities = activitiesData.items as TrailItem[];


  let aqi: number | null = null;
  if (aqiRes.status === "fulfilled" && aqiRes.value.ok) {
    const aqiData = await aqiRes.value.json();
    aqi = typeof aqiData.aqi === "number" ? aqiData.aqi : null;
  }

  const sunrise = weather.daily?.sunrise?.[0];
  const sunset = weather.daily?.sunset?.[0];

  const scoredActivities = individualActivities.map(activity => {
    const activityId = mapDbActivitiesToActivityId(activity.activities!);
    if (!activityId) return null;
    const score = computeActivityScore(activityId, activity.name, weather, wh, sunrise, sunset);
    
    // Determine conditions specifically for the best hour
    let bestHourConditions = null;
    if (score.bestHourISO) {
        const hourIdx = findHourIndex(weather.hourly.time, score.bestHourISO);
        if (hourIdx !== -1) {
            // Create a mini-hourly for just this hour
            const miniHourly = {
                time: [weather.hourly.time[hourIdx]],
                temperature_2m: [weather.hourly.temperature_2m?.[hourIdx] ?? 65],
                apparent_temperature: [weather.hourly.apparent_temperature?.[hourIdx] ?? 65],
                precipitation_probability: [weather.hourly.precipitation_probability?.[hourIdx] ?? 0],
                precipitation: [weather.hourly.precipitation?.[hourIdx] ?? 0],
                windspeed_10m: [weather.hourly.windspeed_10m?.[hourIdx] ?? 0],
                winddirection_10m: [weather.hourly.winddirection_10m?.[hourIdx] ?? 180],
                cloudcover: [weather.hourly.cloudcover?.[hourIdx] ?? 50],
                relativehumidity_2m: [weather.hourly.relativehumidity_2m?.[hourIdx] ?? 50],
                visibility: [weather.hourly.visibility?.[hourIdx] ?? 10000],
                weathercode: [weather.hourly.weathercode?.[hourIdx] ?? 0],
                cape: [weather.hourly.cape?.[hourIdx] ?? 0],
            };
            bestHourConditions = computeConditions(miniHourly, 1, aqi, sunrise, sunset);
            bestHourConditions.timeISO = score.bestHourISO;
        }
    }

    return { ...score, lat: activity.lat, lon: activity.lon, bestHourConditions };
  }).filter((a): a is NonNullable<typeof a> => a !== null);

  const conditions = computeConditions(weather.hourly, wh, aqi, sunrise, sunset);

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

  const out = {
    lat,
    lon,
    windowHours: wh,
    generatedAtISO: new Date().toISOString(),
    activities: scoredActivities.sort((a, b) => b.score - a.score),
    conditions,
    hourlyPreview: preview,
  };

  return NextResponse.json(out);
}
