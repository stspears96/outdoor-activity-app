"use client";

import dynamic from "next/dynamic";
import type { Place, TrailItem, TrailLine } from "@/lib/types";

export type SurfSpotMarker = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region?: string;
  distanceKm?: number;

  cdipTransectId?: string | null;

  // from /api/surf scoring
  score?: number;
  quality?: "poor" | "fair" | "good" | "excellent";
  reasons?: string[];
  conditions?: {
    windSpeedKts?: number;
    windDirDeg?: number;   // degrees
    swellHeightM?: number;
    swellPeriodS?: number;
    swellDirDeg?: number;  // degrees
    waveHeightM?: number;
    wavePeriodS?: number;
    waveDirDeg?: number;
  };
};

export type MapViewProps = {
  lat: number;
  lon: number;
  height?: number;
  label?: string;
  places?: Place[];
  trailItems?: TrailItem[];
  trailLines?: TrailLine[];
  surfSpots: SurfSpotMarker[];
  onLoadTrailLine?: (refType: "relation" | "way" | "usfs", id: number | string, label: string) => void;
  onLoadGpxTrack?: (trackId: number, label: string) => void;
  onViewForecast?: (name: string, transectId: string) => void;
};

// IMPORTANT: resolve to the default export, not the module object
const MapViewDynamic = dynamic<MapViewProps>(
  () => import("./MapView").then((m) => m.default),
  { ssr: false }
);

export default MapViewDynamic;

