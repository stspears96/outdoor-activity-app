import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query parameter q" }, { status: 400 });
  }

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;

  const res = await fetch(url, {
    headers: { "User-Agent": "outdoor-activity-app/1.0" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Geocoding service error" }, { status: 502 });
  }

  const raw = await res.json();
  const results = (raw as any[]).map((r) => ({
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name as string,
  }));

  return NextResponse.json({ results });
}
