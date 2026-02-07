import { NextResponse } from "next/server";
import type { TrailItem, TrailsResponse } from "@/lib/types";

function metersFromMiles(mi: number) {
  return Math.round(mi * 1609.344);
}

function osmElementUrl(el: any) {
  const t = el.type;
  const id = el.id;
  if (!t || !id) return undefined;
  return `https://www.openstreetmap.org/${t}/${id}`;
}

function bestName(el: any, fallback: string) {
  return (el.tags?.name as string | undefined) || (el.tags?.ref as string | undefined) || fallback;
}

function classify(el: any): TrailItem["itemType"] {
  if (el.type === "relation" && el.tags?.route === "hiking") return "hiking_route";
  if (el.type === "node" && el.tags?.highway === "trailhead") return "trailhead";
  if (el.type === "node" && el.tags?.tourism === "information") return "trailhead";
  return "path";
}

function buildTrailsMarkersQuery(lat: number, lon: number, radiusM: number) {
  return `
    [out:json][timeout:35];
    (
      // Trailheads
      node["highway"="trailhead"](around:${radiusM},${lat},${lon});
      node["tourism"="information"]["information"="guidepost"](around:${radiusM},${lat},${lon});
      node["tourism"="information"]["information"="map"](around:${radiusM},${lat},${lon});
      node["tourism"="information"]["information"="board"](around:${radiusM},${lat},${lon});

      // Hiking routes as relations (marker at center)
      relation["route"="hiking"](around:${radiusM},${lat},${lon});

      // A small set of explicitly-hiking-ish path ways as markers (center)
      way["highway"="path"]["sac_scale"](around:${radiusM},${lat},${lon});
      way["highway"="path"]["trail_visibility"](around:${radiusM},${lat},${lon});
      way["highway"="footway"]["sac_scale"](around:${radiusM},${lat},${lon});
    );
    out tags center;
  `;
}

async function fetchFromOverpass(endpoint: string, query: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": "outdoor-activity-app/1.0 (trails-markers)",
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
  const radiusMiles = Number(searchParams.get("radiusMiles") ?? "6");
  const limitItems = Number(searchParams.get("limitItems") ?? "180");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const radiusM = metersFromMiles(Math.max(0.5, Math.min(20, radiusMiles)));
  const li = Math.max(1, Math.min(400, limitItems));

  const query = buildTrailsMarkersQuery(lat, lon, radiusM);

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

  const items: TrailItem[] = (data.elements ?? [])
    .map((el: any): TrailItem | null => {
      const plat = typeof el.lat === "number" ? el.lat : el.center?.lat;
      const plon = typeof el.lon === "number" ? el.lon : el.center?.lon;
      if (typeof plat !== "number" || typeof plon !== "number") return null;

      const itemType = classify(el);
      const name = bestName(
        el,
        itemType === "hiking_route"
          ? "Hiking route"
          : itemType === "trailhead"
            ? "Trailhead"
            : "Trail"
      );

      return {
        id: `${el.type}:${el.id}`,
        refType: el.type,
	refId: el.id,
	itemType,
        name,
        lat: plat,
        lon: plon,
        difficulty: el.tags?.sac_scale,
        surface: el.tags?.surface,
        symbol: el.tags?.["osmc:symbol"],
        ref: el.tags?.ref,
        osmUrl: osmElementUrl(el),
      };
    })
    .filter((x: TrailItem | null): x is TrailItem => !!x)
    .slice(0, li);

  const out: TrailsResponse = {
    lat,
    lon,
    radiusMiles,
    countItems: items.length,
    items,
    overpassEndpoint: usedEndpoint ?? undefined,
  };

  return NextResponse.json(out);
}

