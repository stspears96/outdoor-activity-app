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

  const includeSurf = !activityType || activityType === "all" || activityType === "surf";
  const includeDb = !activityType || activityType === "all" || activityType !== "surf";

  let activitiesUrl = `${baseUrl}/api/activities-db?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}`;
  if (activityType && activityType !== "all" && activityType !== "surf") {
    activitiesUrl += `&activityType=${activityType}`;
  }

  const fetchers: Promise<any>[] = [
    fetch(`${baseUrl}/api/weather?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
    fetch(`${baseUrl}/api/air-quality?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
  ];

  if (includeDb) fetchers.push(fetch(activitiesUrl));
  if (includeSurf) fetchers.push(fetch(`${baseUrl}/api/surf?lat=${lat}&lon=${lon}&radiusKm=60`));

  const results = await Promise.allSettled(fetchers);
  
  const weatherRes = results[0];
  const aqiRes = results[1];
  
  if (weatherRes.status === "rejected" || !weatherRes.value.ok) {
    return NextResponse.json({ error: "Failed to load weather" }, { status: 502 });
  }
  const weather = (await weatherRes.value.json()) as WeatherResponse;

  let aqi: number | null = null;
  if (aqiRes.status === "fulfilled" && aqiRes.value.ok) {
    const aqiData = await aqiRes.value.json();
    aqi = typeof aqiData.aqi === "number" ? aqiData.aqi : null;
  }

  let individualActivities: any[] = [];
  
  if (includeDb) {
      const dbIdx = 2;
      const res = results[dbIdx];
      if (res && res.status === "fulfilled" && res.value.ok) {
          const data = await res.value.json();
          individualActivities = individualActivities.concat(data.items ?? []);
      }
  }

  if (includeSurf) {
      const surfIdx = includeDb ? 3 : 2;
      const res = results[surfIdx];
      if (res && res.status === "fulfilled" && res.value.ok) {
          const data = await res.value.json();
          const spots = (data.spots ?? []).map((s: any) => ({
              ...s,
              activityId: "surf",
              isSurf: true,
          }));
          individualActivities = individualActivities.concat(spots);
      }
  }

  const scoredActivities = individualActivities.map(activity => {
    let activityId: ActivityId | null = null;
    if (activity.isSurf) {
        activityId = "surf";
    } else {
        activityId = mapDbActivitiesToActivityId(activity.activities!);
    }
    
    if (!activityId) return null;
    
    const score = computeActivityScore(activityId, activity.name, weather, wh);
    
    let bestHourConditions = null;
    if (score.bestHourISO) {
        const hourIdx = findHourIndex(weather.hourly.time, score.bestHourISO);
        if (hourIdx !== -1) {
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
            const sunrise = weather.daily?.sunrise?.[hourIdx % 2]; // Approximation or pass full daily
            const sunset = weather.daily?.sunset?.[hourIdx % 2];
            
            bestHourConditions = computeConditions(miniHourly, 1, aqi, sunrise, sunset);
            bestHourConditions.timeISO = score.bestHourISO;
            
            if (activity.isSurf && activity.conditions) {
                bestHourConditions.swellHeightM = activity.conditions.swellHeightM;
                bestHourConditions.swellPeakPeriodS = activity.conditions.swellPeakPeriodS;
                bestHourConditions.swellAvgPeriodS = activity.conditions.swellAvgPeriodS;
                bestHourConditions.swellPeriodDiffS = activity.conditions.swellPeriodDiffS;
                bestHourConditions.windOffshoreAngleDeg = activity.conditions.windOffshoreAngleDeg;
            }
        }
    }

    return { 
        ...score, 
        lat: activity.lat, 
        lon: activity.lon, 
        bestHourConditions,
        isSurf: activity.isSurf,
        cdip_transect_id: activity.cdip_transect_id,
        wind_offshore_min_deg: activity.wind_offshore_min_deg,
        wind_offshore_max_deg: activity.wind_offshore_max_deg,
        swell_min_deg: activity.swell_min_deg,
        swell_max_deg: activity.swell_max_deg,
        reasons: activity.reasons
    };
  }).filter((a): a is NonNullable<typeof a> => a !== null);

  const conditions = computeConditions(weather.hourly, wh, aqi, weather.daily?.sunrise?.[0], weather.daily?.sunset?.[0]);

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
