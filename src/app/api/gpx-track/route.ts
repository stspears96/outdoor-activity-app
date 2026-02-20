import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import GpxParser from "gpxparser";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const trackId = searchParams.get("trackId");

  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  try {
    const gpxPath = path.join(process.cwd(), "data", "gpx", `${trackId}.gpx`);
    const fileContent = await fs.readFile(gpxPath, "utf-8");

    const gpx = new GpxParser();
    gpx.parse(fileContent);

    const tracks = gpx.tracks;
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ lines: [] });
    }

    const latlngs = tracks[0].points.map((point: any) => [point.lat, point.lon]);

    const line: any = {
      id: `gpx-${trackId}`,
      latlngs,
    };

    return NextResponse.json({ lines: [line] });

  } catch (error: any) {
    console.error(`Error processing GPX track ${trackId}:`, error);
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: `GPX track not found: ${trackId}` }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to parse GPX file" }, { status: 500 });
  }
}
