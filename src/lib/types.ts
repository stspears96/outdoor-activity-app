export type ActivityId =
  | "walk"
  | "run"
  | "hike"
  | "bike"
  | "picnic"
  | "cafe"
  | "dogpark";

export type ActivityScore = {
  id: ActivityId;
  name: string;
  score: number; // 0-100
  why: string[];
  bestHourISO?: string; // e.g. 2026-02-07T18:00
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
};

export type WeatherResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: WeatherHourly;
};

export type RecommendationsResponse = {
  lat: number;
  lon: number;
  windowHours: number;
  generatedAtISO: string;
  activities: ActivityScore[];
  hourlyPreview: Array<{
    timeISO: string;
    tempF?: number;
    precipProb?: number;
    windMph?: number;
  }>;
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
  countLines: number;
  items: TrailItem[];
  lines: TrailLine[];
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

