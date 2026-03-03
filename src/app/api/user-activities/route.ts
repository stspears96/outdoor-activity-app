import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";

const DB_PATH = path.join(process.cwd(), "data", "activities.db");
const GPX_DIR = path.join(process.cwd(), "data", "gpx");

const ACTIVITY_MAP: Record<string, string> = {
  run: '["Running"]',
  hike: '["Hiking"]',
  bike: '["Cycling"]',
  mtb: '["Mountain Biking"]',
  picnic: '["Picnic"]',
};

export async function GET() {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, title, latitude, longitude, activities, gpx_track_id
       FROM activities
       WHERE url = 'user-created'
       ORDER BY id DESC`
    )
    .all() as Array<{
    id: number;
    title: string;
    latitude: number;
    longitude: number;
    activities: string;
    gpx_track_id: number;
  }>;
  db.close();
  return NextResponse.json({ items: rows });
}

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const title = (formData.get("title") as string | null)?.trim();
  const activityType = formData.get("activityType") as string | null;
  const lat = Number(formData.get("lat"));
  const lon = Number(formData.get("lon"));

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!activityType || !ACTIVITY_MAP[activityType]) {
    return NextResponse.json({ error: "invalid activityType" }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "invalid lat/lon" }, { status: 400 });
  }

  const activities = ACTIVITY_MAP[activityType];
  const location = JSON.stringify([lat, lon]);

  const db = new Database(DB_PATH);
  const result = db
    .prepare(
      `INSERT INTO activities (title, latitude, longitude, url, rating, tags, location, activities, gpx_track_id)
       VALUES (?, ?, ?, 'user-created', '[0, 0]', '[]', ?, ?, 0)`
    )
    .run(title, lat, lon, location, activities);

  const insertedId = result.lastInsertRowid as number;

  // Handle optional GPX upload
  const gpxFile = formData.get("gpx") as File | null;
  if (gpxFile && gpxFile.size > 0) {
    try {
      await fs.mkdir(GPX_DIR, { recursive: true });
      const gpxPath = path.join(GPX_DIR, `${insertedId}.gpx`);
      const buffer = Buffer.from(await gpxFile.arrayBuffer());
      await fs.writeFile(gpxPath, buffer);
      db.prepare(`UPDATE activities SET gpx_track_id = ? WHERE id = ?`).run(insertedId, insertedId);
    } catch {
      // GPX save failure is non-fatal
    }
  }

  db.close();

  return NextResponse.json({ id: insertedId }, { status: 201 });
}
