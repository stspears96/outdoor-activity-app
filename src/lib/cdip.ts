import { parseSpectralArray, partitionSwells, SpectralSwell } from "./spectral";

type CdipLatest = {
  ok: boolean;
  transect: string;
  time?: string;
  waveHs?: number; // meters
  waveTp?: number; // seconds (peak period)
  waveTa?: number; // seconds (average period)
  waveDm?: number; // degrees (bulk mean direction)
  waveDp?: number; // degrees (peak direction)
  swellComponents?: SpectralSwell[];
  note?: string;
};

// RFC 4180-style quoted-field CSV row parser
function parseQuotedCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      // trailing empty field after last comma handled above; break
      break;
    }
    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field.trim());
      if (line[i] === ",") i++;
    } else {
      // Unquoted field
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i).trim());
        break;
      } else {
        fields.push(line.slice(i, end).trim());
        i = end + 1;
      }
    }
  }
  return fields;
}

function parseCsvSimple(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] as Record<string, string>[] };
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = parseQuotedCsvLine(line);
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = cols[i] ?? ""));
    return r;
  });
  return { headers, rows };
}

// Simple in-memory cache (per server process)
const cdipCache = new Map<string, { at: number; value: CdipLatest }>();
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

// Raw-rows cache for time-based lookups (fetchCdipAtTime)
type RawRow = Record<string, string>;
const cdipRawCache = new Map<string, { at: number; rows: RawRow[] }>();
const cdipForecastCache = new Map<string, { at: number; rows: RawRow[] }>();

async function fetchCdipQCRows(transect: string): Promise<RawRow[]> {
  const now = Date.now();
  const cached = cdipRawCache.get(transect);
  if (cached && now - cached.at < CACHE_MS) return cached.rows;

  const base =
    `https://thredds.cdip.ucsd.edu/thredds/ncss/point/cdip/model/MOP_alongshore/${transect}_nowcast.nc`;
  const url =
    `${base}?` +
    `var=waveHs&var=waveTp&var=waveTa&var=waveDm&var=waveDp&var=waveFlagPrimary` +
    `&var=waveEnergyDensity&var=waveMeanDirection&var=waveA1Value&var=waveB1Value` +
    `&time=all&accept=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      cdipRawCache.set(transect, { at: now, rows: [] });
      return [];
    }
    const { rows } = parseCsvSimple(text);
    const goodRows = rows.filter(r => {
      const flag = r.waveFlagPrimary === "" ? null : Number(r.waveFlagPrimary);
      return flag == null || flag === 1;
    });
    cdipRawCache.set(transect, { at: now, rows: goodRows });
    return goodRows;
  } catch {
    cdipRawCache.set(transect, { at: now, rows: [] });
    return [];
  }
}

async function fetchCdipForecastRows(transect: string): Promise<RawRow[]> {
  const now = Date.now();
  const cached = cdipForecastCache.get(transect);
  if (cached && now - cached.at < CACHE_MS) return cached.rows;

  const base =
    `https://thredds.cdip.ucsd.edu/thredds/ncss/point/cdip/model/MOP_alongshore/${transect}_forecast.nc`;
  const url = `${base}?var=waveHs&var=waveTp&var=waveTa&var=waveDm&var=waveDp&time=all&accept=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      cdipForecastCache.set(transect, { at: now, rows: [] });
      return [];
    }
    const { rows } = parseCsvSimple(text);
    cdipForecastCache.set(transect, { at: now, rows: rows });
    return rows;
  } catch {
    cdipForecastCache.set(transect, { at: now, rows: [] });
    return [];
  }
}

export async function fetchCdipAtTime(transect: string, targetMs: number): Promise<CdipLatest> {
  // Fetch nowcast and forecast in parallel; pick whichever row is closest in time.
  const [nowcastRows, forecastRows] = await Promise.all([
    fetchCdipQCRows(transect),
    fetchCdipForecastRows(transect),
  ]);

  const allRows = [...nowcastRows, ...forecastRows];
  if (!allRows.length) {
    return { ok: false, transect, note: "No QC-good records found" };
  }

  // Find row with minimum |t - targetMs|
  let best: RawRow | null = null;
  let bestDelta = Infinity;

  for (const r of allRows) {
    const t = Date.parse(r.time ?? "");
    if (!Number.isFinite(t)) continue;
    const delta = Math.abs(t - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = r;
    }
  }

  if (!best) {
    return { ok: false, transect, note: "No valid timestamps in data" };
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

  const energyRaw = best["waveEnergyDensity"];
  const dirRaw    = best["waveMeanDirection"];
  const a1Raw     = best["waveA1Value"];
  const b1Raw     = best["waveB1Value"];

  if (energyRaw && dirRaw && a1Raw && b1Raw) {
    const energy = parseSpectralArray(energyRaw);
    const dir    = parseSpectralArray(dirRaw);
    const a1     = parseSpectralArray(a1Raw);
    const b1     = parseSpectralArray(b1Raw);
    if (energy.length === 20) {
      v.swellComponents = partitionSwells(energy, dir, a1, b1);
    }
  }

  return v;
}

export async function fetchCdipLatest(transect: string): Promise<CdipLatest> {
  const now = Date.now();
  const cached = cdipCache.get(transect);
  if (cached && now - cached.at < CACHE_MS) return cached.value;

  const base =
    `https://thredds.cdip.ucsd.edu/thredds/ncss/point/cdip/model/MOP_alongshore/${transect}_nowcast.nc`;

  // time=all avoids "No features are in the requested subset"
  const url =
    `${base}?` +
    `var=waveHs&var=waveTp&var=waveTa&var=waveDm&var=waveDp&var=waveFlagPrimary` +
    `&var=waveEnergyDensity&var=waveMeanDirection&var=waveA1Value&var=waveB1Value` +
    `&time=all&accept=csv`;

  try {
    const res = await fetch(url, { cache: "no-store" });
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

    // Parse spectral data if available
    const energyRaw = best["waveEnergyDensity"];
    const dirRaw    = best["waveMeanDirection"];
    const a1Raw     = best["waveA1Value"];
    const b1Raw     = best["waveB1Value"];

    if (energyRaw && dirRaw && a1Raw && b1Raw) {
      const energy = parseSpectralArray(energyRaw);
      const dir    = parseSpectralArray(dirRaw);
      const a1     = parseSpectralArray(a1Raw);
      const b1     = parseSpectralArray(b1Raw);
      if (energy.length === 20) {
        v.swellComponents = partitionSwells(energy, dir, a1, b1);
      }
    }

    cdipCache.set(transect, { at: now, value: v });
    return v;
  } catch (e: any) {
    const v: CdipLatest = { ok: false, transect, note: e?.message ?? String(e) };
    cdipCache.set(transect, { at: now, value: v });
    return v;
  }
}
