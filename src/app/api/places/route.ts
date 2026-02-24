import { NextResponse } from "next/server";
import type { Place, PlaceType } from "@/lib/types";

function metersFromMiles(mi: number) {
  return Math.round(mi * 1609.344);
}

function buildOverpassQuery(type: PlaceType, lat: number, lon: number, radiusM: number) {
  const filters: Record<PlaceType, string[]> = {
    park: [
      'node["leisure"="park"]',
      'way["leisure"="park"]',
      'relation["leisure"="park"]',
    ],
    trail: [
      'way["highway"="path"]',
      'way["highway"="footway"]',
      'way["highway"="cycleway"]',
    ],
    cafe: [
      'node["amenity"="cafe"]["outdoor_seating"="yes"]',
      'way["amenity"="cafe"]["outdoor_seating"="yes"]',
      'relation["amenity"="cafe"]["outdoor_seating"="yes"]',
    ],
    dogpark: [
      'node["leisure"="dog_park"]',
      'way["leisure"="dog_park"]',
      'relation["leisure"="dog_park"]',
    ],
    viewpoint: [
      'node["tourism"="viewpoint"]',
      'way["tourism"="viewpoint"]',
      'relation["tourism"="viewpoint"]',
    ],
  };

  const clauses = filters[type]
    .map((f) => `${f}(around:${radiusM},${lat},${lon});`)
    .join("\n");

  return `
    [out:json][timeout:25];
    (
      ${clauses}
    );
    out tags center;
  `;
}

function osmElementUrl(el: any) {
  const t = el.type;
  const id = el.id;
  if (!t || !id) return undefined;
  return `https://www.openstreetmap.org/${t}/${id}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const type = (searchParams.get("type") ?? "") as PlaceType;
  const radiusMiles = Number(searchParams.get("radiusMiles") ?? "2");
  const limit = Number(searchParams.get("limit") ?? "40");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const allowed: PlaceType[] = ["park", "trail", "cafe", "dogpark", "viewpoint"];
  if (!allowed.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Use one of: ${allowed.join(", ")}` }, { status: 400 });
  }

  const radiusM = metersFromMiles(Math.max(0.25, Math.min(10, radiusMiles)));
  const lim = Math.max(1, Math.min(200, limit));

  const query = buildOverpassQuery(type, lat, lon, radiusM);

  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const res = await fetch(overpassUrl, {
    method: "POST",
    body: query,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": "outdoor-activity-app/1.0 (places)",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "Overpass request failed", status: res.status, body: text.slice(0, 200) },
      { status: 502 }
    );
  }

  const data = await res.json();

  const places: Place[] = (data.elements ?? [])
    .map((el: any): Place | null => {
      const plat = typeof el.lat === "number" ? el.lat : el.center?.lat;
      const plon = typeof el.lon === "number" ? el.lon : el.center?.lon;
      if (typeof plat !== "number" || typeof plon !== "number") return null;

      const name = (el.tags?.name as string | undefined) || type;

      return {
        id: `${el.type}:${el.id}`,
        type,
        name,
        lat: plat,
        lon: plon,
        osmUrl: osmElementUrl(el),
      };
    })
    .filter((p: Place | null): p is Place => !!p)
    .slice(0, lim);

  return NextResponse.json({ type, lat, lon, radiusMiles, places });
}

