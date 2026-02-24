import { GET } from "./route";

describe("GET /api/trail-lines", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 for missing/invalid lat lon", async () => {
    const req = new Request("http://localhost/api/trail-lines?lat=abc&lon=-122");
    const res = await GET(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing or invalid lat/lon" });
  });

  it("returns 502 when all Overpass endpoints fail", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trail-lines?lat=37&lon=-122");
    const res = await GET(req);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("All Overpass endpoints failed");
    expect(body.errors).toHaveLength(3);
  });

  it("maps ways into lines and downsamples", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: "way",
            id: 10,
            tags: { name: "Creek Trail" },
            geometry: [
              { lat: 37.0, lon: -122.0 },
              { lat: 37.1, lon: -122.1 },
              { lat: 37.2, lon: -122.2 },
              { lat: 37.3, lon: -122.3 },
            ],
          },
          {
            type: "way",
            id: 11,
            geometry: [{ lat: 1, lon: 1 }], // too short
          },
        ],
      }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trail-lines?lat=37&lon=-122&simplifyEveryN=2&limitLines=5");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.countLines).toBe(1);
    expect(body.lines).toEqual([
      {
        id: "way:10",
        name: "Creek Trail",
        osmUrl: "https://www.openstreetmap.org/way/10",
        latlngs: [
          [37.0, -122.0],
          [37.2, -122.2],
          [37.3, -122.3], // ensure last is kept
        ],
      },
    ]);
  });

  it("clamps radius, geometry limit, and simplify params in the outgoing query", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [] }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request(
      "http://localhost/api/trail-lines?lat=37&lon=-122&radiusMiles=999&wayGeomLimit=5&simplifyEveryN=99"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://overpass-api.de/api/interpreter");
    const body = String(calledOptions.body);
    // radiusMiles clamped to 20 miles => 32187 meters
    expect(body).toContain("around:32187,37,-122");
    // wayGeomLimit clamped to min 20
    expect(body).toContain("geom 20");
  });
});
