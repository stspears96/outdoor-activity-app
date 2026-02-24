import { GET } from "./route";

describe("GET /api/weather", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 when lat is missing", async () => {
    const req = new Request("http://localhost/api/weather?lon=-122.4194");
    const res = await GET(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing lat/lon" });
  });

  it("returns 400 when lon is missing", async () => {
    const req = new Request("http://localhost/api/weather?lat=37.7749");
    const res = await GET(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing lat/lon" });
  });

  it("fetches all three models and returns stitched data", async () => {
    const mockData = {
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: "America/Los_Angeles",
      hourly: { time: ["2024-01-01T00:00"], temperature_2m: [70] },
      daily: { sunrise: ["2024-01-01T07:00"], sunset: ["2024-01-01T18:00"] },
    };
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => mockData,
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/weather?lat=37.7749&lon=-122.4194");
    const res = await GET(req);

    // One fetch per model: hrrr_conus, nam_conus, ecmwf_ifs
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Every call shares the same base params
    for (const [calledUrl, calledOptions] of fetchMock.mock.calls) {
      const url = new URL(calledUrl);
      expect(url.hostname).toBe("api.open-meteo.com");
      expect(url.pathname).toBe("/v1/forecast");
      expect(url.searchParams.get("latitude")).toBe("37.7749");
      expect(url.searchParams.get("longitude")).toBe("-122.4194");
      expect(url.searchParams.get("temperature_unit")).toBe("fahrenheit");
      expect(url.searchParams.get("windspeed_unit")).toBe("mph");
      expect(url.searchParams.get("precipitation_unit")).toBe("inch");
      expect(url.searchParams.get("timezone")).toBe("auto");
      expect(url.searchParams.get("hourly")).toContain("temperature_2m");
      expect(url.searchParams.get("daily")).toBe("sunrise,sunset");
      expect(calledOptions).toEqual(
        expect.objectContaining({
          next: { revalidate: 600 },
          headers: { "User-Agent": "outdoor-activity-app/1.0" },
        }),
      );
    }

    // Each call uses a different model
    const models = fetchMock.mock.calls.map(([url]: [string]) =>
      new URL(url).searchParams.get("models")
    );
    expect(models).toContain("hrrr_conus");
    expect(models).toContain("nam_conus");
    expect(models).toContain("ecmwf_ifs");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hourly.time).toEqual(["2024-01-01T00:00"]);
    expect(body.hourly.temperature_2m).toEqual([70]);
  });

  it("returns 502 when all upstream model requests fail", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "Server error",
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/weather?lat=37.7749&lon=-122.4194");
    const res = await GET(req);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "All weather model fetches failed",
    });
  });
});
