import { NextRequest, NextResponse } from "next/server";
import { getScoredSurfSpots } from "@/lib/surfService";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusKm = Number(searchParams.get("radiusKm") ?? "80");
  const dateParam = searchParams.get("date") ?? undefined;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }

  let baseTimeMs: number | undefined;
  if (dateParam) {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
    const isDateTime = /^\d{4}-\d{2}-\d{2}T/.test(dateParam);
    if (!isDateOnly && !isDateTime) {
      return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
    }
    if (isDateOnly) {
      const ms = new Date(`${dateParam}T12:00:00`).getTime();
      if (!Number.isFinite(ms)) {
        return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
      }
      baseTimeMs = ms;
    } else {
      const ms = new Date(dateParam).getTime();
      if (!Number.isFinite(ms)) {
        return NextResponse.json({ error: "Invalid or unavailable date" }, { status: 400 });
      }
      baseTimeMs = ms;
    }
  }

  try {
    const spots = await getScoredSurfSpots(lat, lon, radiusKm, baseTimeMs);
    return NextResponse.json({
      lat,
      lon,
      count: spots.length,
      spots,
    });
  } catch (error: any) {
    console.error("Surf API Error:", error);
    return NextResponse.json({ error: "Failed to fetch surf spots" }, { status: 500 });
  }
}
