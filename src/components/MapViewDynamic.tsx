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
  onLoadTrailLine?: (refType: "relation" | "way", id: number, label: string) => void;
};

// IMPORTANT: resolve to the default export, not the module object
const MapViewDynamic = dynamic<MapViewProps>(
  () => import("./MapView").then((m) => m.default),
  { ssr: false }
);

export default MapViewDynamic;

