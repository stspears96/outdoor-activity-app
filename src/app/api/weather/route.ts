import { NextResponse } from "next/server";
import type { WeatherResponse } from "@/lib/types";

// Open-Meteo returns metric by default; request Fahrenheit + mph
function buildUrl(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "windspeed_10m",
      "windgusts_10m",
      "cloudcover",
    ].join(","),
    temperature_unit: "fahrenheit",
    windspeed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Missing or invalid lat/lon" }, { status: 400 });
  }

  const url = buildUrl(lat, lon);

  const res = await fetch(url, {
    // Next.js caching: revalidate every 10 minutes
    next: { revalidate: 600 },
    headers: { "User-Agent": "outdoor-activity-app/1.0" },
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Weather fetch failed: ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as WeatherResponse;
  return NextResponse.json(data);
}

