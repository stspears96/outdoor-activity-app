import { NextResponse } from "next/server";
import { parseSpectralArray, partitionSwells, SpectralSwell } from "@/lib/spectral";

function isoNowPlusHours(hours: number) {
  const now = new Date();
  const end = new Date(now.getTime() + hours * 3600 * 1000);
  return { start: now.toISOString(), end: end.toISOString() };
}

// RFC 4180-style quoted-field CSV row parser
function parseQuotedCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) break;
    if (line[i] === '"') {
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

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\[.*\]$/, ""));

  return lines.slice(1).map((line) => {
    const cols = parseQuotedCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const transect = (searchParams.get("transect") ?? "").trim(); // e.g. SF035
  const hours = Math.max(1, Math.min(168, Number(searchParams.get("hours") ?? "72")));

  if (!/^[A-Z]{2}\d{3}$/.test(transect)) {
    return NextResponse.json({ error: "Invalid transect (expected like SF035)" }, { status: 400 });
  }

  const { start, end } = isoNowPlusHours(hours);

  // MOP alongshore nowcast station file (one station per file)
  const base =
    `https://thredds.cdip.ucsd.edu/thredds/ncss/point/cdip/model/MOP_alongshore/${transect}_nowcast.nc`;

  const url =
    `${base}?` +
    `var=waveHs&var=waveTp&var=waveTa&var=waveDp&var=waveDm&var=waveFlagPrimary` +
    `&var=waveEnergyDensity&var=waveMeanDirection&var=waveA1Value&var=waveB1Value` +
    `&time=all` +
    `&accept=csv`;

  const res = await fetch(url, { next: { revalidate: 600 } });
  const text = await res.text();

  if (!res.ok) {
    return NextResponse.json(
      { error: "CDIP request failed", status: res.status, body: text.slice(0, 300) },
      { status: 502 }
    );
  }

  const rows = parseCsv(text);

  // Normalize + QC filter: keep only waveFlagPrimary == 1 (good) when present
  const points = rows
    .map((r) => {
      const flag = Number(r.waveFlagPrimary);

      let swellComponents: SpectralSwell[] | undefined;
      const energyRaw = r["waveEnergyDensity"];
      const dirRaw    = r["waveMeanDirection"];
      const a1Raw     = r["waveA1Value"];
      const b1Raw     = r["waveB1Value"];
      if (energyRaw && dirRaw && a1Raw && b1Raw) {
        const energy = parseSpectralArray(energyRaw);
        const dir    = parseSpectralArray(dirRaw);
        const a1     = parseSpectralArray(a1Raw);
        const b1     = parseSpectralArray(b1Raw);
        if (energy.length === 20) {
          swellComponents = partitionSwells(energy, dir, a1, b1);
        }
      }

      return {
        time: r.time ?? r["time"] ?? "",
        waveHs: r.waveHs ? Number(r.waveHs) : null,
        waveTp: r.waveTp ? Number(r.waveTp) : null,
        waveTa: r.waveTa ? Number(r.waveTa) : null,
        waveDp: r.waveDp ? Number(r.waveDp) : null,
        waveDm: r.waveDm ? Number(r.waveDm) : null,
        waveFlagPrimary: Number.isFinite(flag) ? flag : null,
        swellComponents,
      };
    })
    .filter((p) => p.time)
    .filter((p) => p.waveFlagPrimary == null || p.waveFlagPrimary === 1);

  const hoursMs = hours * 3600 * 1000;
  const newestTime = points.reduce((mx, p) => {
    const t = Date.parse(p.time);
    return Number.isFinite(t) ? Math.max(mx, t) : mx;
  }, -Infinity);

  const cutoff = newestTime - hoursMs;

  const trimmed = points.filter((p) => {
    const t = Date.parse(p.time);
    return Number.isFinite(t) && t >= cutoff;
  });

  return NextResponse.json({
    transect,
    start,
    end,
    count: trimmed.length,
    points: trimmed,
    source: "CDIP THREDDS NCSS MOP_alongshore",
  });
}
