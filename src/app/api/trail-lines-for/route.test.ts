import { GET } from "./route";

describe("GET /api/trail-lines-for", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 for invalid refType or id", async () => {
    const req = new Request("http://localhost/api/trail-lines-for?refType=bad&id=abc");
    const res = await GET(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Use refType=relation|way and numeric id" });
  });

  it("returns 502 when all Overpass endpoints fail", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "server error",
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trail-lines-for?refType=relation&id=12");
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
            id: 99,
            tags: { ref: "TR-5" },
            geometry: [
              { lat: 37.0, lon: -122.0 },
              { lat: 37.1, lon: -122.1 },
              { lat: 37.2, lon: -122.2 },
            ],
          },
        ],
      }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request("http://localhost/api/trail-lines-for?refType=way&id=99&simplifyEveryN=2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countLines).toBe(1);
    expect(body.lines).toEqual([
      {
        id: "way:99",
        name: "TR-5",
        osmUrl: "https://www.openstreetmap.org/way/99",
        latlngs: [
          [37.0, -122.0],
          [37.2, -122.2], // downsampled + last
        ],
      },
    ]);
  });

  it("clamps wayGeomLimit and simplifyEveryN in the outgoing query", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ elements: [] }),
    }));
    // @ts-expect-error - override global fetch in tests
    global.fetch = fetchMock;

    const req = new Request(
      "http://localhost/api/trail-lines-for?refType=relation&id=12&wayGeomLimit=5&simplifyEveryN=99"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://overpass-api.de/api/interpreter");

    const body = String(calledOptions.body);
    // wayGeomLimit clamped to min 20 for relation query
    expect(body).toContain("geom 20");
  });
});
