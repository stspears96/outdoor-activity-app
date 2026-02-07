import { NextResponse } from "next/server";
import type { TrailLine } from "@/lib/types";

function osmElementUrl(el: any) {
  const t = el.type;
  const id = el.id;
  if (!t || !id) return undefined;
  return `https://www.openstreetmap.org/${t}/${id}`;
}

function downsampleLatLngs(latlngs: Array<[number, number]>, everyN: number) {
  if (everyN <= 1) return latlngs;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < latlngs.length; i += everyN) out.push(latlngs[i]);
  if (latlngs.length) {
    const last = latlngs[latlngs.length - 1];
    const lastOut = out[out.length - 1];
    if (!lastOut || lastOut[0] !== last[0] || lastOut[1] !== last[1]) out.push(last);
  }
  return out;
}

function buildQuery(refType: "relation" | "way", id: number, wayGeomLimit: number) {
  // For a relation route=hiking: fetch its member ways with geometry
  if (refType === "relation") {
    return `
      [out:json][timeout:60];
      relation(${id})->.r;
      way(r.r)->.w;
      .w out tags geom ${wayGeomLimit};
    `;
  }

  // For a way: fetch its geometry
  return `
    [out:json][timeout:60];
    way(${id});
    out tags geom;
  `;
}

async function fetchFromOverpass(endpoint: string, query: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": "outdoor-activity-app/1.0 (trail-lines-for)",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false as const, status: res.status, body: text.slice(0, 400) };
  }

  const json = await res.json();
  return { ok: true as const, json };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const refType = (searchParams.get("refType") ?? "") as "relation" | "way";
  const id = Number(searchParams.get("id"));
  const wayGeomLimit = Number(searchParams.get("wayGeomLimit") ?? "120");
  const simplifyEveryN = Number(searchParams.get("simplifyEveryN") ?? "2");

  if (!["relation", "way"].includes(refType) || !Number.isFinite(id)) {
    return NextResponse.json({ error: "Use refType=relation|way and numeric id" }, { status: 400 });
  }

  const wlim = Math.max(20, Math.min(400, wayGeomLimit));
  const simp = Math.max(1, Math.min(10, simplifyEveryN));

  const query = buildQuery(refType, id, wlim);

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
  ];

  let data: any | null = null;
  let usedEndpoint: string | null = null;
  const errors: any[] = [];

  for (const ep of endpoints) {
    const r = await fetchFromOverpass(ep, query);
    if (r.ok) {
      data = r.json;
      usedEndpoint = ep;
      break;
    } else {
      errors.push({ endpoint: ep, status: r.status, body: r.body });
    }
  }

  if (!data) {
    return NextResponse.json({ error: "All Overpass endpoints failed", errors }, { status: 502 });
  }

  const lines: TrailLine[] = (data.elements ?? [])
    .filter((el: any) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map((el: any): TrailLine | null => {
      const raw: Array<[number, number]> = el.geometry
        .map((pt: any) => (typeof pt.lat === "number" && typeof pt.lon === "number" ? [pt.lat, pt.lon] : null))
        .filter((x: any): x is [number, number] => !!x);

      if (raw.length < 2) return null;

      return {
        id: `way:${el.id}`,
        name: (el.tags?.name as string | undefined) || (el.tags?.ref as string | undefined),
        osmUrl: osmElementUrl(el),
        latlngs: downsampleLatLngs(raw, simp),
      };
    })
    .filter((x: TrailLine | null): x is TrailLine => !!x);

  return NextResponse.json({
    refType,
    id,
    countLines: lines.length,
    lines,
    overpassEndpoint: usedEndpoint ?? undefined,
  });
}

