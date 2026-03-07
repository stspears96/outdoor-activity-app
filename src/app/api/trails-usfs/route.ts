import { NextResponse } from "next/server";
import type { TrailItem } from "@/lib/types";

const USFS_ENDPOINT =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query";

function milesToMeters(miles: number) {
  return Math.round(miles * 1609.344);
}

function trailClassLabel(tc?: number): string | undefined {
  if (!tc) return undefined;
  switch (tc) {
    case 1: return "minimally developed";
    case 2: return "moderately developed";
    case 3: return "developed";
    case 4: return "highly developed";
    case 5: return "fully developed";
    default: return undefined;
  }
}


export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusMiles = Number(searchParams.get("radiusMiles") ?? "30");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const radiusM = milesToMeters(Math.max(1, Math.min(100, radiusMiles)));

  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusM),
    units: "esriSRUnit_Meter",
    outFields: "TRAIL_NAME,TRAIL_NO,TRAIL_CLASS,GIS_MILES,TRAIL_SURFACE",
    where: "TRAIL_NAME IS NOT NULL AND GIS_MILES > 3 AND TRAIL_SURFACE IN ('NAT - NATIVE MATERIAL', 'NATIVE MATERIAL') AND TRAIL_NAME NOT LIKE '%4WD%' AND TRAIL_NAME NOT LIKE '%OHV%' AND TRAIL_NAME NOT LIKE '%ATV%' AND TRAIL_NAME NOT LIKE '%JEEP%'",
    returnGeometry: "true",
    // Coarse simplification (~5km tolerance) — just enough to get a midpoint for the marker;
    // full geometry is fetched on demand via /api/usfs-trail-line.
    maxAllowableOffset: "0.05",
    outSR: "4326",
    f: "json",
  });

  let data: any;
  try {
    const res = await fetch(`${USFS_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": "outdoor-activity-app/1.0 (trails-usfs)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `USFS API error: ${res.status}`, detail: text.slice(0, 400) },
        { status: 502 }
      );
    }
    data = await res.json();
  } catch (e: any) {
    return NextResponse.json({ error: `USFS fetch failed: ${e?.message}` }, { status: 502 });
  }

  if (data?.error) {
    return NextResponse.json(
      { error: `USFS returned error: ${data.error.message ?? JSON.stringify(data.error)}` },
      { status: 502 }
    );
  }

  const features: any[] = data?.features ?? [];

  // ArcGIS returns one feature per trail segment; deduplicate by trail ID,
  // keeping the segment with the most miles as the representative marker.
  const byId = new Map<string, TrailItem & { miles: number }>();

  for (const f of features) {
    const attrs = f.attributes ?? {};
    const name: string = attrs.TRAIL_NAME ?? "";
    if (!name) continue;

    const trailNo: string | undefined = attrs.TRAIL_NO ?? undefined;
    const trailClass: number | undefined =
      typeof attrs.TRAIL_CLASS === "number" ? attrs.TRAIL_CLASS : undefined;
    const gisMiles: number =
      typeof attrs.GIS_MILES === "number" ? attrs.GIS_MILES : 0;
    const surface: string | undefined = attrs.TRAIL_SURFACE ?? undefined;

    const paths: number[][][] = f.geometry?.paths ?? [];
    const allPoints = paths.flat();
    if (!allPoints.length) continue;
    const mid = allPoints[Math.floor(allPoints.length / 2)];

    const id = `usfs:${trailNo ?? name.replace(/\s+/g, "_")}`;
    const existing = byId.get(id);
    if (existing && existing.miles >= gisMiles) continue;

    byId.set(id, {
      id,
      itemType: "hiking_route",
      name,
      lat: mid[1],
      lon: mid[0],
      surface: surface ?? undefined,
      source: "usfs",
      miles: gisMiles,
      trailClass,
      difficulty: trailClassLabel(trailClass),
      ref: trailNo,
    });
  }

  const items: TrailItem[] = [...byId.values()];
  return NextResponse.json({ items, count: items.length, radiusMiles });
}
