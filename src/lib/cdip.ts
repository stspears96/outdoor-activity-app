type CdipLatest = {
  ok: boolean;
  transect: string;
  time?: string;
  waveHs?: number; // meters
  waveTp?: number; // seconds (peak period)
  waveTa?: number; // seconds (average period)
  waveDm?: number; // degrees (bulk mean direction)
  waveDp?: number; // degrees (peak direction)
  note?: string;
};

function parseCsvSimple(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] as Record<string, string>[] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",");
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = (cols[i] ?? "").trim()));
    return r;
  });
  return { headers, rows };
}

// Simple in-memory cache (per server process)
const cdipCache = new Map<string, { at: number; value: CdipLatest }>();
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

export async function fetchCdipLatest(transect: string): Promise<CdipLatest> {
  const now = Date.now();
  const cached = cdipCache.get(transect);
  if (cached && now - cached.at < CACHE_MS) return cached.value;

  const base =
    `https://thredds.cdip.ucsd.edu/thredds/ncss/point/cdip/model/MOP_alongshore/${transect}_nowcast.nc`;

  // time=all avoids “No features are in the requested subset”
  const url =
    `${base}?` +
    `var=waveHs&var=waveTp&var=waveTa&var=waveDm&var=waveDp&var=waveFlagPrimary` +
    `&time=all&accept=csv`;

  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    const text = await res.text();

    if (!res.ok) {
      const v: CdipLatest = { ok: false, transect, note: `HTTP ${res.status}: ${text.slice(0, 120)}` };
      cdipCache.set(transect, { at: now, value: v });
      return v;
    }

    const { rows } = parseCsvSimple(text);
    if (!rows.length) {
      const v: CdipLatest = { ok: false, transect, note: "No rows returned" };
      cdipCache.set(transect, { at: now, value: v });
      return v;
    }

    // Find latest QC-good record (waveFlagPrimary == 1 when present)
    let best: any = null;
    let bestT = -Infinity;

    for (const r of rows) {
      const t = Date.parse(r.time ?? "");
      if (!Number.isFinite(t)) continue;

      const flag = r.waveFlagPrimary === "" ? null : Number(r.waveFlagPrimary);
      if (flag != null && flag !== 1) continue;

      if (t > bestT) {
        bestT = t;
        best = r;
      }
    }

    if (!best) {
      const v: CdipLatest = { ok: false, transect, note: "No QC-good records found" };
      cdipCache.set(transect, { at: now, value: v });
      return v;
    }

    const v: CdipLatest = {
      ok: true,
      transect,
      time: best.time,
      waveHs: best.waveHs ? Number(best.waveHs) : undefined,
      waveTp: best.waveTp ? Number(best.waveTp) : undefined,
      waveTa: best.waveTa ? Number(best.waveTa) : undefined,
      waveDm: best.waveDm ? Number(best.waveDm) : undefined,
      waveDp: best.waveDp ? Number(best.waveDp) : undefined,
    };

    cdipCache.set(transect, { at: now, value: v });
    return v;
  } catch (e: any) {
    const v: CdipLatest = { ok: false, transect, note: e?.message ?? String(e) };
    cdipCache.set(transect, { at: now, value: v });
    return v;
  }
}
