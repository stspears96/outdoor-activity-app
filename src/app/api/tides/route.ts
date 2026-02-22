import { NextRequest, NextResponse } from "next/server";
import { fetchNearestTideStation, fetchTidePredictions } from "@/lib/noaa";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }

  try {
    const station = await fetchNearestTideStation(lat, lon, 100);
    if (!station) {
      return NextResponse.json({ predictions: [], station: null });
    }

    const predictions = await fetchTidePredictions(station.id);
    return NextResponse.json({
      station,
      predictions: predictions.map(p => ({
        timeISO: new Date(p.t.replace(" ", "T") + "Z").toISOString(),
        heightFt: Number(p.v),
      }))
    });
  } catch (error: any) {
    console.error("Tide API Error:", error);
    return NextResponse.json({ error: "Failed to fetch tides" }, { status: 500 });
  }
}
