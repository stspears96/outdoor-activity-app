export type ActivityId =
  | "run"
  | "hike"
  | "bike"
  | "mtb"
  | "picnic"
  | "surf";

export type ActivityScore = {
  id: ActivityId;
  name: string;
  score: number; // 0-100
  why: string[];
  bestHourISO?: string; // e.g. 2026-02-07T18:00
  lat?: number;
  lon?: number;
};

export type WeatherHourly = {
  time: string[]; // ISO strings
  temperature_2m?: number[];
  apparent_temperature?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  windspeed_10m?: number[];
  windgusts_10m?: number[];
  cloudcover?: number[];
  winddirection_10m?: number[];
  relativehumidity_2m?: number[];
  visibility?: number[];    // meters
  weathercode?: number[];   // WMO weather code
  cape?: number[];          // J/kg
};

export type Conditions = {
  tempF: number;
  windMph: number;
  windDirDeg: number;        // 0–360 meteorological (0=N)
  precipProb: number;        // 0–100
  cloudCover: number;        // 0–100
  humidity: number;          // 0–100
  recentRainIn: number;      // inches past 24h
  aqi: number | null;        // US AQI, null if unavailable
  cape: number;              // J/kg
  precipType: "none" | "drizzle" | "rain" | "snow" | "freezing_rain";
  precipIntensityMmh: number; // mm/h (max over window)
  visibilityKm: number;      // km (min over window)
  sunrise?: string;          // ISO string
  sunset?: string;           // ISO string
  timeISO?: string;          // ISO string for the specific hour
  // Surf-specific (optional — only present when rating a surf spot)
  swellHeightM?: number;         // metres
  swellPeakPeriodS?: number;     // seconds (Tp)
  swellAvgPeriodS?: number;      // seconds (Ta)
  swellPeriodDiffS?: number;     // seconds (Tp - Ta)
  windOffshoreAngleDeg?: number; // degrees from offshore window centre (0 = dead offshore)
  tideHeightFt?: number;         // feet (MLLW)
  tideState?: "rising" | "falling" | "stable";
};

export type WeatherResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: WeatherHourly;
  daily: {
    sunrise: string[];
    sunset: string[];
  };
};

export type RecommendationsResponse = {
  lat: number;
  lon: number;
  windowHours: number;
  generatedAtISO: string;
  activities: ActivityScore[];
  conditions?: Conditions;
  hourlyPreview: Array<{
    timeISO: string;
    tempF?: number;
    precipProb?: number;
    windMph?: number;
  }>;
};

export type PlaceType = "park" | "trail" | "cafe" | "dogpark" | "viewpoint";

export type Place = {
  id: string;
  type: PlaceType;
  name: string;
  lat: number;
  lon: number;
  osmUrl?: string;
};

export type TrailItemType = "trailhead" | "hiking_route" | "path";

export type TrailItem = {
  id: string;
  refType?: "node" | "way" | "relation";
  refId?: number;
  itemType: TrailItemType;
  name: string;
  lat: number;
  lon: number;
  difficulty?: string;
  surface?: string;
  symbol?: string;
  ref?: string;
  osmUrl?: string;
  source?: "osm" | "usfs" | "outbound" | "strava";
  miles?: number;
  trailClass?: number;
  elevationFt?: number;
  outboundUrl?: string;
  gpxTrackId?: string | number;
  activities?: string;
};

export type TrailLine = {
  id: string; // "way:123"
  name?: string;
  osmUrl?: string;
  // Leaflet expects [lat, lon]
  latlngs: Array<[number, number]>;
};

export type TrailsResponse = {
  lat: number;
  lon: number;
  radiusMiles: number;
  countItems: number;
  countLines?: number;
  items: TrailItem[];
  lines?: TrailLine[];
  overpassEndpoint?: string;
};

export type TrailLinesResponse = {
  lat: number;
  lon: number;
  radiusMiles: number;
  countLines: number;
  lines: TrailLine[];
  overpassEndpoint?: string;
};

