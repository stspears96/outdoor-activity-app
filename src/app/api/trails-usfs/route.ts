import { NextResponse } from "next/server";
import type { TrailItem, TrailLine } from "@/lib/types";

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

/** Compute the midpoint of an ArcGIS polyline (array of path arrays of [x,y] points). */
function polylineMidpoint(paths: number[][][]): { lat: number; lon: number } | null {
  const allPoints: number[][] = paths.flat();
  if (!allPoints.length) return null;
  const mid = allPoints[Math.floor(allPoints.length / 2)];
  return { lat: mid[1], lon: mid[0] };
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
    where: "TRAIL_NAME IS NOT NULL",
    returnGeometry: "true",
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

  const items: TrailItem[] = [];
  const lines: TrailLine[] = [];

  for (const f of features) {
    const attrs = f.attributes ?? {};
    const name: string = attrs.TRAIL_NAME ?? "";
    if (!name) continue;

    const trailNo: string | undefined = attrs.TRAIL_NO ?? undefined;
    const trailClass: number | undefined =
      typeof attrs.TRAIL_CLASS === "number" ? attrs.TRAIL_CLASS : undefined;
    const gisMiles: number | undefined =
      typeof attrs.GIS_MILES === "number" ? attrs.GIS_MILES : undefined;
    const surface: string | undefined = attrs.TRAIL_SURFACE ?? undefined;

    const paths: number[][][] = f.geometry?.paths ?? [];
    const midpoint = polylineMidpoint(paths);
    if (!midpoint) continue;

    const id = `usfs:${trailNo ?? name.replace(/\s+/g, "_")}`;

    items.push({
      id,
      itemType: "hiking_route",
      name,
      lat: midpoint.lat,
      lon: midpoint.lon,
      surface: surface ?? undefined,
      source: "usfs",
      miles: gisMiles,
      trailClass,
      difficulty: trailClassLabel(trailClass),
      ref: trailNo,
    });

    // Build TrailLine geometry for immediate display (no second fetch needed)
    if (paths.length > 0) {
      const latlngs: Array<[number, number]> = paths
        .flat()
        .map(([x, y]: number[]) => [y, x] as [number, number]);

      if (latlngs.length > 0) {
        lines.push({ id, name, latlngs });
      }
    }
  }

  return NextResponse.json({ items, lines, count: items.length, radiusMiles });
}
