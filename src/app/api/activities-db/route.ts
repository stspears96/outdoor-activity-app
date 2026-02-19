import Database from "better-sqlite3";
import path from "node:path";
import { NextResponse } from "next/server";
import type { TrailItem } from "@/lib/types";

const DB_PATH = path.join(process.cwd(), "data", "activities.db");

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function parseMiles(tags: string[]): number | undefined {
  const re = /^(\d+\.?\d*) Miles$/;
  for (const tag of tags) {
    const m = re.exec(tag);
    if (m) return parseFloat(m[1]);
  }
  return undefined;
}

function parseElevationFt(tags: string[]): number | undefined {
  const re = /^(\d+) ft elevation gain$/;
  for (const tag of tags) {
    const m = re.exec(tag);
    if (m) return parseInt(m[1], 10);
  }
  return undefined;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const activityType = searchParams.get("activityType") ?? "hiking";
  const radiusKm = Number(searchParams.get("radiusKm") ?? "40");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const activityLike =
    activityType === "running" ? "%Running%" :
    activityType === "mtb" ? "%Mountain Biking%" :
    "%Hiking%";

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `
      SELECT id, title, latitude, longitude, rating, tags, url
      FROM activities
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
        AND activities LIKE ?
        AND rating != '[0, 0]'
      `
    )
    .all(
      lat - latDelta,
      lat + latDelta,
      lon - lonDelta,
      lon + lonDelta,
      activityLike
    ) as Array<{
    id: number;
    title: string;
    latitude: number;
    longitude: number;
    rating: string;
    tags: string;
    url: string;
  }>;
  db.close();

  type RankedItem = TrailItem & { _reviewCount: number; _stars: number };

  const ranked: RankedItem[] = [];
  for (const row of rows) {
    let stars = 0;
    let reviewCount = 0;
    try {
      const parsed = JSON.parse(row.rating) as [number, number];
      stars = parsed[0] ?? 0;
      reviewCount = parsed[1] ?? 0;
    } catch {}

    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags) as string[];
    } catch {}

    const distKm = haversineKm(lat, lon, row.latitude, row.longitude);
    if (distKm > radiusKm) continue;

    ranked.push({
      id: `outbound:${row.id}`,
      itemType: "hiking_route" as const,
      source: "outbound" as const,
      name: row.title,
      lat: row.latitude,
      lon: row.longitude,
      miles: parseMiles(tags),
      elevationFt: parseElevationFt(tags),
      outboundUrl: row.url,
      _reviewCount: reviewCount,
      _stars: stars,
    });
  }

  ranked.sort((a, b) => b._reviewCount - a._reviewCount || b._stars - a._stars);

  const items: TrailItem[] = ranked.slice(0, 60).map(({ _reviewCount, _stars, ...item }) => item);

  return NextResponse.json(
    { items, count: items.length },
    { headers: { "Cache-Control": "public, max-age=86400" } }
  );
}
