import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ aqi: null });
  }

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: "us_aqi",
      timezone: "auto",
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`,
      {
        next: { revalidate: 600 },
        headers: { "User-Agent": "outdoor-activity-app/1.0" },
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return NextResponse.json({ aqi: null });
    }

    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    const aqiValues: (number | null)[] = data?.hourly?.us_aqi ?? [];

    // Find the value closest to now (within the current or most recent hour)
    const now = Date.now();
    let aqi: number | null = null;
    let bestDiff = Infinity;

    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]).getTime();
      const diff = Math.abs(t - now);
      if (diff < bestDiff && aqiValues[i] !== null && aqiValues[i] !== undefined) {
        bestDiff = diff;
        aqi = aqiValues[i];
      }
    }

    return NextResponse.json({ aqi });
  } catch {
    return NextResponse.json({ aqi: null });
  }
}
