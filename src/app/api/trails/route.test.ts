import { GET } from "./route";

describe("GET /api/trails", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 for missing/invalid lat lon", async () => {
    const req = new Request("http://localhost/api/trails?lat=abc&lon=-122");
    const res = await GET(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing or invalid lat/lon" });
  });

  it("tries multiple Overpass endpoints and returns 502 with errors when all fail", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trails?lat=37&lon=-122");
    const res = await GET(req);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toBe("All Overpass endpoints failed");
    expect(body.errors).toHaveLength(3);
    expect(body.errors[0]).toEqual(
      expect.objectContaining({
        status: 429,
        body: "rate limit",
      }),
    );
  });

  it("maps elements to trail items and respects limitItems", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: "node",
            id: 1,
            lat: 37.0,
            lon: -122.0,
            tags: { highway: "trailhead", name: "Main Trailhead", ref: "TH-1" },
          },
          {
            type: "relation",
            id: 2,
            center: { lat: 37.1, lon: -122.1 },
            tags: { route: "hiking", name: "Ridge Loop", distance: "5.5" },
          },
          {
            type: "way",
            id: 3,
            lat: 37.2,
            lon: -122.2,
            tags: { sac_scale: "hiking", surface: "dirt" },
          },
        ],
      }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trails?lat=37&lon=-122&limitItems=2&radiusMiles=50");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.countItems).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.overpassEndpoint).toBe("https://overpass-api.de/api/interpreter");
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        id: "node:1",
        itemType: "trailhead",
        name: "Main Trailhead",
        lat: 37.0,
        lon: -122.0,
        osmUrl: "https://www.openstreetmap.org/node/1",
        ref: "TH-1",
      }),
    );
    expect(body.items[1]).toEqual(
      expect.objectContaining({
        id: "relation:2",
        itemType: "hiking_route",
        name: "Ridge Loop",
        lat: 37.1,
        lon: -122.1,
        miles: 5.5,
        osmUrl: "https://www.openstreetmap.org/relation/2",
      }),
    );
  });

  it("clamps radiusMiles and limitItems in the outgoing query", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [] }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trails?lat=37&lon=-122&radiusMiles=999&limitItems=999");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://overpass-api.de/api/interpreter");

    const body = String(calledOptions.body);
    // radiusMiles is clamped to 20 miles => 32187 meters
    expect(body).toContain("around:32187,37,-122");
  });
});
