import { NextRequest, NextResponse } from "next/server";
import { getScoredSurfSpots } from "@/lib/surfService";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusKm = Number(searchParams.get("radiusKm") ?? "80");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }

  try {
    const spots = await getScoredSurfSpots(lat, lon, radiusKm);
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
