import { NextResponse } from "next/server";
import type { TrailLine, TrailLinesResponse } from "@/lib/types";

function metersFromMiles(mi: number) {
  return Math.round(mi * 1609.344);
}

function osmElementUrl(el: any) {
  const t = el.type;
  const id = el.id;
  if (!t || !id) return undefined;
  return `https://www.openstreetmap.org/${t}/${id}`;
}

function buildTrailLinesQuery(lat: number, lon: number, radiusM: number, wayGeomLimit: number) {
  // Only member ways of hiking route relations, capped.
  return `
    [out:json][timeout:60];
    relation["route"="hiking"](around:${radiusM},${lat},${lon})->.routes;
    way(r.routes)->.ways;
    .ways out tags geom ${wayGeomLimit};
  `;
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

async function fetchFromOverpass(endpoint: string, query: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": "outdoor-activity-app/1.0 (trail-lines)",
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

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusMiles = Number(searchParams.get("radiusMiles") ?? "4");
  const wayGeomLimit = Number(searchParams.get("wayGeomLimit") ?? "150"); // cap ways
  const simplifyEveryN = Number(searchParams.get("simplifyEveryN") ?? "3"); // downsample points
  const limitLines = Number(searchParams.get("limitLines") ?? "200");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const radiusM = metersFromMiles(Math.max(0.5, Math.min(20, radiusMiles)));
  const wlim = Math.max(20, Math.min(400, wayGeomLimit));
  const simp = Math.max(1, Math.min(10, simplifyEveryN));
  const llim = Math.max(1, Math.min(400, limitLines));

  const query = buildTrailLinesQuery(lat, lon, radiusM, wlim);

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

      const latlngs = downsampleLatLngs(raw, simp);

      return {
        id: `way:${el.id}`,
        name: (el.tags?.name as string | undefined) || (el.tags?.ref as string | undefined),
        osmUrl: osmElementUrl(el),
        latlngs,
      };
    })
    .filter((x: TrailLine | null): x is TrailLine => !!x)
    .slice(0, llim);

  const out: TrailLinesResponse = {
    lat,
    lon,
    radiusMiles,
    countLines: lines.length,
    lines,
    overpassEndpoint: usedEndpoint ?? undefined,
  };

  return NextResponse.json(out);
}

