import { GET } from "./route";

describe("GET /api/trails-usfs", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 for missing/invalid lat lon", async () => {
    const req = new Request("http://localhost/api/trails-usfs?lat=abc&lon=-122");
    const res = await GET(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing or invalid lat/lon" });
  });

  it("returns 502 when upstream response is not ok", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "Server error",
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trails-usfs?lat=37&lon=-122&radiusMiles=5");
    const res = await GET(req);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "USFS API error: 500",
      detail: "Server error",
    });
  });

  it("returns 502 when upstream throws or returns an error payload", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ error: { message: "bad request" } }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trails-usfs?lat=37&lon=-122");
    const res = await GET(req);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "USFS returned error: bad request",
    });
  });

  it("maps USFS features to items and lines", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        features: [
          {
            attributes: {
              TRAIL_NAME: "Ridge Trail",
              TRAIL_NO: "123",
              TRAIL_CLASS: 2,
              GIS_MILES: 3.4,
              TRAIL_SURFACE: "dirt",
            },
            geometry: {
              paths: [
                [
                  [-122.0, 37.0],
                  [-122.1, 37.1], // midpoint
                  [-122.2, 37.2],
                ],
              ],
            },
          },
          {
            attributes: { TRAIL_NAME: "" },
            geometry: { paths: [] },
          },
          {
            attributes: { TRAIL_NAME: "No Number Trail" },
            geometry: {
              paths: [[[-120.0, 35.0]]],
            },
          },
        ],
      }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trails-usfs?lat=37&lon=-122&radiusMiles=999");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.count).toBe(2);
    expect(body.radiusMiles).toBe(999); // echo original param

    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "usfs:123",
          name: "Ridge Trail",
          itemType: "hiking_route",
          lat: 37.1,
          lon: -122.1,
          miles: 3.4,
          surface: "dirt",
          source: "usfs",
          trailClass: 2,
          difficulty: "moderately developed",
          ref: "123",
        }),
        expect.objectContaining({
          id: "usfs:No_Number_Trail",
          name: "No Number Trail",
        }),
      ]),
    );

    expect(body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "usfs:123",
          name: "Ridge Trail",
          latlngs: [
            [37.0, -122.0],
            [37.1, -122.1],
            [37.2, -122.2],
          ],
        }),
        expect.objectContaining({
          id: "usfs:No_Number_Trail",
          latlngs: [[35.0, -120.0]],
        }),
      ]),
    );

    // Ensure radius gets clamped in request (max 100 miles)
    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(calledUrl);
    expect(url.searchParams.get("distance")).toBe("160934"); // 100 miles in meters
  });
});
