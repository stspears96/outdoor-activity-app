import { computeConditions } from "./weather";
import type { WeatherHourly } from "./types";

describe("computeConditions", () => {
  const nowIso = "2026-02-22T12:00:00.000Z";
  const nowMs = new Date(nowIso).getTime();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("computes window stats, conversions, and precip type severity", () => {
    jest.spyOn(Date, "now").mockReturnValue(nowMs);

    const hourly: WeatherHourly = {
      time: [
        "2026-02-22T11:00:00.000Z", // past
        "2026-02-22T12:00:00.000Z",
        "2026-02-22T13:00:00.000Z",
        "2026-02-22T14:00:00.000Z",
        "2026-02-22T15:00:00.000Z",
      ],
      temperature_2m: [40, 50, 60, 70, 80],
      apparent_temperature: [41, 51, 61, 71, 81],
      windspeed_10m: [5, 10, 20, 8, 7],
      winddirection_10m: [180, 350, 10, 20, 30],
      precipitation_probability: [10, 40, 60, 20, 0],
      precipitation: [0.05, 0.1, 0.2, 0.15, 0],
      cloudcover: [10, 30, 50, 70, 90],
      relativehumidity_2m: [20, 40, 60, 80, 100],
      visibility: [10000, 9000, 8000, 12000, 15000],
      weathercode: [0, 51, 61, 56, 3],
      cape: [0, 100, 400, 200, 50],
    };

    const conditions = computeConditions(hourly, 3, 42, "2026-02-22T07:00:00.000Z", "2026-02-22T19:00:00.000Z");

    // Window is indices 1..3 (>= now), size 3
    expect(conditions.tempF).toBeCloseTo((51 + 61 + 71) / 3);
    expect(conditions.windMph).toBe(20);
    expect(conditions.precipProb).toBe(60);
    expect(conditions.cloudCover).toBeCloseTo((30 + 50 + 70) / 3);
    expect(conditions.humidity).toBeCloseTo((40 + 60 + 80) / 3);
    expect(conditions.cape).toBe(400);

    // Circular mean of 350, 10, 20 is near 6.7 degrees
    expect(conditions.windDirDeg).toBeCloseTo(6.7, 1);

    // Precip type severity in window (51 drizzle, 61 rain, 56 freezing_rain) => freezing_rain
    expect(conditions.precipType).toBe("freezing_rain");

    // Precip intensity max in inches -> mm/h
    expect(conditions.precipIntensityMmh).toBeCloseTo(0.2 * 25.4);

    // Visibility min in meters -> km
    expect(conditions.visibilityKm).toBeCloseTo(8000 / 1000);

    expect(conditions.recentRainIn).toBeCloseTo(0.05);
    expect(conditions.aqi).toBe(42);
    expect(conditions.sunrise).toBe("2026-02-22T07:00:00.000Z");
    expect(conditions.sunset).toBe("2026-02-22T19:00:00.000Z");
  });

  it("uses defaults when data is missing and sums recent rain over past 24h", () => {
    jest.spyOn(Date, "now").mockReturnValue(nowMs);

    const hourly: WeatherHourly = {
      time: [
        "2026-02-21T11:00:00.000Z", // 25h before now, excluded
        "2026-02-22T11:00:00.000Z", // 1h before now, included
        "2026-02-22T13:00:00.000Z", // after now
      ],
      precipitation: [0.5, 1.25, 2],
    };

    const conditions = computeConditions(hourly, 2, null);

    expect(conditions.tempF).toBe(65);
    expect(conditions.windMph).toBe(0);
    expect(conditions.windDirDeg).toBe(180);
    expect(conditions.precipProb).toBe(0);
    expect(conditions.cloudCover).toBe(50);
    expect(conditions.humidity).toBe(50);
    expect(conditions.cape).toBe(0);
    expect(conditions.precipType).toBe("none");
    expect(conditions.precipIntensityMmh).toBeCloseTo(2 * 25.4); // precipitation[2]=2 in/h is in the window
    expect(conditions.visibilityKm).toBe(10);
    expect(conditions.recentRainIn).toBeCloseTo(1.25);
  });
});
