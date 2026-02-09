import Database from "better-sqlite3";
import path from "node:path";
import { NextResponse } from "next/server";

const DB_PATH = path.join(process.cwd(), "data", "surfspots.sqlite");

// Simple haversine (km)
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusKm = Number(searchParams.get("radiusKm") ?? "50");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const db = new Database(DB_PATH, { readonly: true });

  // Bounding-box prefilter (fast)
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const rows = db
    .prepare(
      `
      SELECT *
      FROM surf_spots
      WHERE lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
      `
    )
    .all(lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta);

  db.close();

  // Precise distance filter
  const spots = rows
    .map((s: any) => ({
      ...s,
      distanceKm: haversineKm(lat, lon, s.lat, s.lon),
    }))
    .filter((s: any) => s.distanceKm <= radiusKm)
    .sort((a: any, b: any) => a.distanceKm - b.distanceKm);

  return NextResponse.json({
    lat,
    lon,
    count: spots.length,
    spots,
  });
}

