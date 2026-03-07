import { NextResponse } from "next/server";
import type { TrailLine } from "@/lib/types";

const USFS_ENDPOINT =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const trailNo = searchParams.get("trailNo");

  if (!trailNo) {
    return NextResponse.json({ error: "Missing trailNo" }, { status: 400 });
  }

  const params = new URLSearchParams({
    where: `TRAIL_NO = '${trailNo.replace(/'/g, "''")}'`,
    outFields: "TRAIL_NAME,TRAIL_NO",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });

  let data: any;
  try {
    const res = await fetch(`${USFS_ENDPOINT}?${params.toString()}`, {
      headers: { "User-Agent": "outdoor-activity-app/1.0 (usfs-trail-line)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `USFS API error: ${res.status}` }, { status: 502 });
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
  const lines: TrailLine[] = [];
  let name: string | undefined;
  let segIdx = 0;

  for (const f of features) {
    if (!name) name = f.attributes?.TRAIL_NAME ?? undefined;
    const paths: number[][][] = f.geometry?.paths ?? [];
    // Each path is a disconnected segment — render as a separate polyline
    // to avoid straight lines jumping between segment endpoints.
    for (const path of paths) {
      const latlngs: Array<[number, number]> = path.map(([x, y]) => [y, x]);
      if (latlngs.length > 0) {
        lines.push({ id: `usfs:${trailNo}:${segIdx++}`, name, latlngs });
      }
    }
  }

  return NextResponse.json({ lines });
}
