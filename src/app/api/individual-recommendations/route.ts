import { NextResponse } from "next/server";
import type { ActivityId, RecommendationsResponse, WeatherResponse, TrailItem } from "@/lib/types";
import { computeActivityScore, getActivityWindowHours } from "@/lib/scoring";
import { computeConditions } from "@/lib/weather";
import { getScoredSurfSpots } from "@/lib/surfService";

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

function normCoord(c: number): number {
    return Math.round(c * 1000) / 1000;
}

function dateFromMs(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveBaseTime(time: string[], dateParam: string, sunrise?: string[]) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  const isDateTime = /^\d{4}-\d{2}-\d{2}T/.test(dateParam);

  if (!isDateOnly && !isDateTime) return null;

  if (isDateOnly) {
    const now = Date.now();
    const todayStr = dateFromMs(now);

    if (dateParam === todayStr) {
      return { baseTimeMs: now, dateStr: dateParam };
    }

    if (sunrise) {
      const sunIdx = sunrise.findIndex(sr => sr.startsWith(dateParam));
      if (sunIdx !== -1) {
        const sunriseMs = new Date(sunrise[sunIdx]).getTime();
        if (Number.isFinite(sunriseMs)) {
          for (let i = 0; i < time.length; i++) {
            const t = new Date(time[i]).getTime();
            if (t >= sunriseMs) {
              return { baseTimeMs: t, dateStr: dateParam };
            }
          }
        }
      }
    }

    const idx = time.findIndex(t => t.startsWith(dateParam));
    if (idx === -1) return null;
    const baseTimeMs = new Date(time[idx]).getTime();
    if (!Number.isFinite(baseTimeMs)) return null;
    return { baseTimeMs, dateStr: dateParam };
  }

  const targetMs = new Date(dateParam).getTime();
  if (!Number.isFinite(targetMs)) return null;

  let idx = -1;
  for (let i = 0; i < time.length; i++) {
    const t = new Date(time[i]).getTime();
    if (t >= targetMs) {
      idx = i;
      break;
    }
  }

  if (idx === -1) return null;
  const baseTimeMs = new Date(time[idx]).getTime();
  if (!Number.isFinite(baseTimeMs)) return null;
  const dateStr = time[idx].split("T")[0];
  return { baseTimeMs, dateStr };
}

function resolveDateParamToMs(dateParam: string) {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  const isDateTime = /^\d{4}-\d{2}-\d{2}T/.test(dateParam);
  if (!isDateOnly && !isDateTime) return null;
  if (isDateOnly) {
    // Use local noon to avoid anchoring to midnight.
    const ms = new Date(`${dateParam}T12:00:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(dateParam).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function pickBestHourISO(times: string[], baseTimeMs?: number, dateStr?: string) {
  for (let i = 0; i < times.length; i++) {
    if (dateStr && !times[i].startsWith(dateStr)) continue;
    const t = new Date(times[i]).getTime();
    if (typeof baseTimeMs === "number") {
      if (t >= baseTimeMs) return times[i];
    } else {
      if (t >= Date.now()) return times[i];
    }
  }
  return dateStr ? times.find(t => t.startsWith(dateStr)) : times[0];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const windowHours = Number(searchParams.get("windowHours") ?? "3");
  const radiusKm = Number(searchParams.get("radiusKm") ?? "16");
  const activityType = searchParams.get("activityType");
  const dateParam = searchParams.get("date") ?? undefined;
  const isDateOnly = !!dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  const isDateTime = !!dateParam && /^\d{4}-\d{2}-\d{2}T/.test(dateParam);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  if (dateParam && !isDateOnly && !isDateTime) {
    return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
  }

  const wh = Number.isFinite(windowHours) ? Math.max(1, Math.min(24, windowHours)) : 3;
  const surfBaseTimeMs = dateParam ? resolveDateParamToMs(dateParam) ?? undefined : undefined;

  const includeSurf = !activityType || activityType === "all" || activityType === "surf";
  const includeDb = !activityType || activityType === "all" || activityType !== "surf";

  // Phase 1: Fetch candidate activities from DB and Surf Service
  const [aqiRes, activitiesRes, surfSpots] = await Promise.allSettled([
    fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/air-quality?lat=${lat}&lon=${lon}`, { next: { revalidate: 600 } }),
    includeDb ? fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/activities-db?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}${activityType && activityType !== "all" && activityType !== "surf" ? `&activityType=${activityType}` : ""}`) : Promise.resolve(null),
    includeSurf ? getScoredSurfSpots(lat, lon, 60, surfBaseTimeMs) : Promise.resolve([]),
  ]);

  let aqi: number | null = null;
  if (aqiRes.status === "fulfilled" && aqiRes.value.ok) {
    const aqiData = await aqiRes.value.json();
    aqi = typeof aqiData.aqi === "number" ? aqiData.aqi : null;
  }

  let rawActivities: any[] = [];
  if (activitiesRes.status === "fulfilled" && activitiesRes.value?.ok) {
      const data = await activitiesRes.value.json();
      rawActivities = rawActivities.concat(data.items ?? []);
  }
  
  const surfList = surfSpots.status === "fulfilled" ? surfSpots.value : [];
  const candidates = [
      ...rawActivities.map(a => ({ ...a, activityId: mapDbActivitiesToActivityId(a.activities!), isSurf: false })),
      ...surfList.map(s => ({ ...s, activityId: "surf", isSurf: true }))
  ].filter(a => !!a.activityId);

  // Phase 2: Batch weather using INDEX-based matching
  const locsArray: { lat: number, lon: number }[] = [];
  const locKeyToIndex = new Map<string, number>();

  const centerKey = `${normCoord(lat)},${normCoord(lon)}`;
  locsArray.push({ lat, lon });
  locKeyToIndex.set(centerKey, 0);

  const activityToLocIndex: number[] = [];
  for (const a of candidates) {
      const key = `${normCoord(a.lat)},${normCoord(a.lon)}`;
      let idx = locKeyToIndex.get(key);
      if (idx === undefined && locsArray.length < 50) {
          idx = locsArray.length;
          locsArray.push({ lat: a.lat, lon: a.lon });
          locKeyToIndex.set(key, idx);
      }
      activityToLocIndex.push(idx ?? 0);
  }

  const batchLat = locsArray.map(l => l.lat).join(",");
  const batchLon = locsArray.map(l => l.lon).join(",");
  
  const weatherRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/weather?lat=${batchLat}&lon=${batchLon}`);
  if (!weatherRes.ok) {
      return NextResponse.json({ error: "Failed to load weather batch" }, { status: 502 });
  }
  
  const weatherData = await weatherRes.json();
  const weatherArray = Array.isArray(weatherData) ? weatherData : [weatherData];
  const searchWeather = weatherArray[0];
  let baseTimeMs: number | undefined;
  let dateStr: string | undefined;

  if (dateParam) {
    const resolved = resolveBaseTime(searchWeather.hourly.time, dateParam, searchWeather.daily?.sunrise);
    if (!resolved) {
      return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
    }
    baseTimeMs = resolved.baseTimeMs;
    dateStr = resolved.dateStr;
  }

  // Phase 3: Score each activity
  const scoredActivities = candidates.map((activity, i) => {
    const weatherIdx = activityToLocIndex[i];
    const specificWeather = weatherArray[weatherIdx] || searchWeather;
    
    const activityWh = getActivityWindowHours(activity.activityId, wh);
    const score = computeActivityScore(activity.activityId, activity.name, specificWeather, activityWh, baseTimeMs, dateStr);
    if (activity.isSurf && !score.bestHourISO) {
      const fallbackIso = pickBestHourISO(specificWeather.hourly.time, baseTimeMs, dateStr);
      if (fallbackIso) score.bestHourISO = fallbackIso;
    }
    
    // For surf spots, use the surf-specific score and reasons from scoreSurfSpot
    if (activity.isSurf) {
        if (typeof activity.score === "number") score.score = activity.score;
        if (activity.reasons) score.why = activity.reasons;
    }

    let bestHourConditions = null;
    if (score.bestHourISO) {
        const hourIdx = findHourIndex(specificWeather.hourly.time, score.bestHourISO);
        if (hourIdx !== -1) {
            const miniHourly = {
                time: [specificWeather.hourly.time[hourIdx]],
                temperature_2m: [specificWeather.hourly.temperature_2m?.[hourIdx] ?? 65],
                apparent_temperature: [specificWeather.hourly.apparent_temperature?.[hourIdx] ?? 65],
                precipitation_probability: [specificWeather.hourly.precipitation_probability?.[hourIdx] ?? 0],
                precipitation: [specificWeather.hourly.precipitation?.[hourIdx] ?? 0],
                windspeed_10m: [specificWeather.hourly.windspeed_10m?.[hourIdx] ?? 0],
                winddirection_10m: [specificWeather.hourly.winddirection_10m?.[hourIdx] ?? 180],
                cloudcover: [specificWeather.hourly.cloudcover?.[hourIdx] ?? 50],
                relativehumidity_2m: [specificWeather.hourly.relativehumidity_2m?.[hourIdx] ?? 50],
                visibility: [specificWeather.hourly.visibility?.[hourIdx] ?? 10000],
                weathercode: [specificWeather.hourly.weathercode?.[hourIdx] ?? 0],
                cape: [specificWeather.hourly.cape?.[hourIdx] ?? 0],
            };
            let sunrise = specificWeather.daily?.sunrise?.[0];
            let sunset = specificWeather.daily?.sunset?.[0];
            if (dateStr && specificWeather.daily?.sunrise && specificWeather.daily?.sunset) {
                const sunIdx = specificWeather.daily.sunrise.findIndex((sr: string) => sr.startsWith(dateStr));
                if (sunIdx !== -1) {
                    sunrise = specificWeather.daily.sunrise[sunIdx];
                    sunset = specificWeather.daily.sunset[sunIdx];
                }
            }
            
            bestHourConditions = computeConditions(miniHourly, 1, aqi, sunrise, sunset, baseTimeMs, dateStr);
            bestHourConditions.timeISO = score.bestHourISO;
            
            if (activity.isSurf && activity.conditions) {
                bestHourConditions.swellHeightM = activity.conditions.swellHeightM;
                bestHourConditions.swellPeakPeriodS = activity.conditions.swellPeakPeriodS;
                bestHourConditions.swellAvgPeriodS = activity.conditions.swellAvgPeriodS;
                bestHourConditions.swellPeriodDiffS = activity.conditions.swellPeriodDiffS;
                bestHourConditions.windOffshoreAngleDeg = activity.conditions.windOffshoreAngleDeg;
                bestHourConditions.tideHeightFt = activity.conditions.tideHeightFt;
                bestHourConditions.tideState = activity.conditions.tideState;
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
        tide_preference: activity.tide_preference,
    };
  }).filter((a): a is NonNullable<typeof a> => a !== null);

  let sunrise: string | undefined;
  let sunset: string | undefined;
  if (dateStr && searchWeather.daily?.sunrise && searchWeather.daily?.sunset) {
    const sunIdx = searchWeather.daily.sunrise.findIndex((sr: string) => sr.startsWith(dateStr));
    if (sunIdx !== -1) {
      sunrise = searchWeather.daily.sunrise[sunIdx];
      sunset = searchWeather.daily.sunset[sunIdx];
    }
  } else {
    sunrise = searchWeather.daily?.sunrise?.[0];
    sunset = searchWeather.daily?.sunset?.[0];
  }

  const conditions = computeConditions(searchWeather.hourly, wh, aqi, sunrise, sunset, baseTimeMs, dateStr);

  const now = typeof baseTimeMs === "number" ? baseTimeMs : Date.now();
  const preview: RecommendationsResponse["hourlyPreview"] = [];
  for (let i = 0; i < searchWeather.hourly.time.length && preview.length < wh; i++) {
    if (dateStr && !searchWeather.hourly.time[i].startsWith(dateStr)) continue;
    const t = new Date(searchWeather.hourly.time[i]).getTime();
    if (t < now) continue;

    preview.push({
      timeISO: searchWeather.hourly.time[i],
      tempF: searchWeather.hourly.apparent_temperature?.[i] ?? searchWeather.hourly.temperature_2m?.[i],
      precipProb: searchWeather.hourly.precipitation_probability?.[i],
      windMph: searchWeather.hourly.windspeed_10m?.[i],
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
