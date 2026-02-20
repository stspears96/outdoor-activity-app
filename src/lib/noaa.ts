const MDAPI_BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const DATAGETTER_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

export type TideStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
};

export type TidePrediction = {
  t: string; // time
  v: string; // value (height)
};

// Simple in-memory cache for station lookups
const stationCache = new Map<string, TideStation | null>();

/**
 * Finds the nearest NOAA tide station within a given radius.
 */
export async function fetchNearestTideStation(lat: number, lon: number, radiusKm: number = 50): Promise<TideStation | null> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (stationCache.has(cacheKey)) return stationCache.get(cacheKey)!;

  const url = `${MDAPI_BASE}/stations.json?lat=${lat}&lon=${lon}&radius=${radiusKm}`;
  
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } }); // Cache mapping for 24h
    if (!res.ok) return null;
    
    const data = await res.json();
    const stations = data.stations as any[];
    
    if (!stations || stations.length === 0) {
      stationCache.set(cacheKey, null);
      return null;
    }

    // MDAPI sorts by distance by default when using lat/lon/radius
    const best = stations[0];
    const station: TideStation = {
      id: best.id,
      name: best.name,
      lat: best.lat,
      lon: best.lng,
      distanceKm: best.distance,
    };

    stationCache.set(cacheKey, station);
    return station;
  } catch (e) {
    console.error("NOAA Station Lookup failed:", e);
    return null;
  }
}

/**
 * Fetches tide predictions for a station over a specific time range.
 */
export async function fetchTidePredictions(stationId: string, hoursPast: number = 24, hoursFuture: number = 72): Promise<TidePrediction[]> {
  const now = new Date();
  const beginDate = new Date(now.getTime() - hoursPast * 3600 * 1000);
  const endDate = new Date(now.getTime() + hoursFuture * 3600 * 1000);

  const formatDate = (d: Date) => {
    return d.toISOString().replace(/[:\-TZ]/g, "").slice(0, 12); // YYYYMMDDHHMM
  };

  const params = new URLSearchParams({
    begin_date: formatDate(beginDate),
    end_date: formatDate(endDate),
    station: stationId,
    product: "predictions",
    datum: "MLLW",
    time_zone: "gmt",
    units: "english", // feet
    format: "json",
    interval: "h", // hourly
  });

  const url = `${DATAGETTER_BASE}?${params.toString()}`;

  try {
    const res = await fetch(url, { next: { revalidate: 1800 } }); // Cache predictions for 30 mins
    if (!res.ok) return [];
    
    const data = await res.json();
    return data.predictions ?? [];
  } catch (e) {
    console.error("NOAA Tide Fetch failed:", e);
    return [];
  }
}
