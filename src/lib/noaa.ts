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

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Simple in-memory cache for station lookups
const stationCache = new Map<string, TideStation | null>();

/**
 * Finds the nearest NOAA tide-prediction station within a given radius that
 * actually returns predictions. The MDAPI /stations.json endpoint does not
 * filter by lat/lon/radius, and includes subordinate stations that have no
 * harmonic data, so we sort by distance and probe each candidate in order.
 */
export async function fetchNearestTideStation(lat: number, lon: number, radiusKm: number = 100): Promise<TideStation | null> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (stationCache.has(cacheKey)) return stationCache.get(cacheKey)!;

  const url = `${MDAPI_BASE}/stations.json?type=tidepredictions&units=english`;

  try {
    const res = await fetch(url, { next: { revalidate: 86400 } }); // Cache station list for 24h
    if (!res.ok) return null;

    const data = await res.json();
    const stations = data.stations as any[];

    if (!stations || stations.length === 0) {
      stationCache.set(cacheKey, null);
      return null;
    }

    // Sort candidates by distance, keep only those within radius
    const candidates = stations
      .map((s: any) => ({ ...s, dist: haversineKm(lat, lon, s.lat, s.lng) }))
      .filter((s: any) => s.dist < radiusKm)
      .sort((a: any, b: any) => a.dist - b.dist)
      .slice(0, 10);

    // Probe each candidate until one actually returns predictions
    const now = new Date();
    const testDate = now.toISOString().slice(0, 10).replace(/-/g, "");
    const testEnd = new Date(now.getTime() + 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");

    for (const s of candidates) {
      const probeUrl = `${DATAGETTER_BASE}?station=${s.id}&product=predictions&datum=MLLW&time_zone=gmt&units=english&format=json&interval=h&begin_date=${testDate}&end_date=${testEnd}`;
      try {
        const pr = await fetch(probeUrl, { next: { revalidate: 86400 } });
        if (!pr.ok) continue;
        const pd = await pr.json();
        if (Array.isArray(pd.predictions) && pd.predictions.length > 0) {
          const station: TideStation = { id: s.id, name: s.name, lat: s.lat, lon: s.lng, distanceKm: s.dist };
          stationCache.set(cacheKey, station);
          return station;
        }
      } catch { continue; }
    }

    stationCache.set(cacheKey, null);
    return null;
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
    return d.toISOString().slice(0, 10).replace(/-/g, ""); // "20260220"
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
