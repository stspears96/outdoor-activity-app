import { NextResponse } from "next/server";
import type { WeatherResponse } from "@/lib/types";

// Open-Meteo returns metric by default; request Fahrenheit + mph
function buildUrl(lat: string, lon: string) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "windspeed_10m",
      "windgusts_10m",
      "cloudcover",
      "winddirection_10m",
      "relativehumidity_2m",
      "visibility",
      "weathercode",
      "cape",
    ].join(","),
    daily: "sunrise,sunset",
    temperature_unit: "fahrenheit",
    windspeed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get("lat");
  const lonParam = searchParams.get("lon");

  if (!latParam || !lonParam) {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 });
  }

  const url = buildUrl(latParam, lonParam);

  const res = await fetch(url, {
    // Next.js caching: revalidate every 10 minutes
    next: { revalidate: 600 },
    headers: { "User-Agent": "outdoor-activity-app/1.0" },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Weather fetch failed: ${res.status}`, detail: text }, { status: 502 });
  }

  const data = await res.json();
  // If multiple coordinates are provided, Open-Meteo returns an array.
  // If one is provided, it returns an object.
  // We return exactly what it gives us.
  return NextResponse.json(data);
}
