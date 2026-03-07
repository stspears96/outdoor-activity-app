import { NextRequest, NextResponse } from "next/server";
import { getScoredSurfSpots } from "@/lib/surfService";

const STEP_MS = 3 * 60 * 60 * 1000;   // 3-hour resolution
const WINDOW_MS = 13 * 60 * 60 * 1000; // 6am–7pm span

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusKm = Number(searchParams.get("radiusKm") ?? "80");
  const dateParam = searchParams.get("date") ?? undefined;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }

  try {
    if (!dateParam) {
      // No date selected — score at current time, show current conditions.
      const spots = await getScoredSurfSpots(lat, lon, radiusKm);
      return NextResponse.json({ lat, lon, count: spots.length, spots });
    }

    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
    const isDateTime = /^\d{4}-\d{2}-\d{2}T/.test(dateParam);
    if (!isDateOnly && !isDateTime) {
      return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
    }

    if (isDateTime) {
      // Explicit timestamp — no scanning needed.
      const baseTimeMs = new Date(dateParam).getTime();
      if (!Number.isFinite(baseTimeMs)) {
        return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
      }
      const spots = await getScoredSurfSpots(lat, lon, radiusKm, baseTimeMs);
      return NextResponse.json({ lat, lon, count: spots.length, spots });
    }

    // Date-only: scan multiple hour slots so we return the best time of day
    // per spot rather than always anchoring to noon.
    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const startMs = dateParam === todayStr
      ? Date.now()
      : new Date(`${dateParam}T06:00:00`).getTime();

    const candidates: number[] = [];
    for (let t = startMs; t <= startMs + WINDOW_MS; t += STEP_MS) {
      candidates.push(t);
    }

    const results = await Promise.all(
      candidates.map(t => getScoredSurfSpots(lat, lon, radiusKm, t))
    );

    // Per spot, keep the hour with the highest score.
    const bestBySpotId = new Map<string, any>();
    for (const scored of results) {
      for (const spot of scored) {
        const existing = bestBySpotId.get(spot.id);
        if (!existing || spot.score > existing.score) {
          bestBySpotId.set(spot.id, spot);
        }
      }
    }

    const spots = [...bestBySpotId.values()].sort((a, b) => b.score - a.score);
    return NextResponse.json({ lat, lon, count: spots.length, spots });
  } catch (error: any) {
    console.error("Surf API Error:", error);
    return NextResponse.json({ error: "Failed to fetch surf spots" }, { status: 500 });
  }
}
