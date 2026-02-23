import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "node:path";
import { logActivitySession, getAllSessions, getSessionsByActivity } from "@/lib/activitySessions";

const DB_PATH = path.join(process.cwd(), "data", "surfspots.sqlite");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { activity_type, spot_id, spot_name, spot_lat, spot_lon, session_time, rating } = body;

    if (!activity_type || typeof activity_type !== "string") {
      return NextResponse.json({ error: "activity_type required" }, { status: 400 });
    }
    if (!spot_name || typeof spot_name !== "string") {
      return NextResponse.json({ error: "spot_name required" }, { status: 400 });
    }
    if (typeof spot_lat !== "number" || typeof spot_lon !== "number") {
      return NextResponse.json({ error: "spot_lat and spot_lon required" }, { status: 400 });
    }
    if (!session_time || typeof session_time !== "string") {
      return NextResponse.json({ error: "session_time required" }, { status: 400 });
    }
    const sessionTimeMs = Date.parse(session_time);
    if (!Number.isFinite(sessionTimeMs)) {
      return NextResponse.json({ error: "session_time must be a valid ISO string" }, { status: 400 });
    }
    if (typeof rating !== "number") {
      return NextResponse.json({ error: "rating must be a number 0-100" }, { status: 400 });
    }

    const clampedRating = Math.max(0, Math.min(100, Math.round(rating)));

    // For surf spots with a spot_id, look up spot params from the DB
    let spotParams = null;
    let cdipTransectId: string | null = null;
    if (activity_type === "surf" && spot_id) {
      try {
        const db = new Database(DB_PATH, { readonly: true });
        const row = db.prepare("SELECT * FROM surf_spots WHERE id = ?").get(spot_id) as any;
        db.close();
        if (row) {
          spotParams = {
            wind_offshore_min_deg: row.wind_offshore_min_deg ?? null,
            wind_offshore_max_deg: row.wind_offshore_max_deg ?? null,
            swell_min_deg: row.swell_min_deg ?? null,
            swell_max_deg: row.swell_max_deg ?? null,
            tide_preference: row.tide_preference ?? null,
          };
          cdipTransectId = row.cdip_transect_id ?? null;
        }
      } catch { /* spot not found — proceed without params */ }
    }

    const result = await logActivitySession({
      activityType: activity_type,
      spotId: spot_id ?? null,
      spotName: spot_name,
      lat: spot_lat,
      lon: spot_lon,
      spotParams,
      cdipTransectId,
      sessionTimeMs,
      rating: clampedRating,
    });

    return NextResponse.json({
      id: result.id,
      model_score: result.model_score,
      session_time: new Date(sessionTimeMs).toISOString(),
      rating: clampedRating,
      conditions: result.conditions,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const activityType = searchParams.get("activity_type");

    const sessions = activityType ? getSessionsByActivity(activityType) : getAllSessions();
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
