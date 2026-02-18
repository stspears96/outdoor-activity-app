import { NextResponse } from "next/server";

function isoNowPlusHours(hours: number) {
  const now = new Date();
  const end = new Date(now.getTime() + hours * 3600 * 1000);
  return { start: now.toISOString(), end: end.toISOString() };
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\[.*\]$/, ""));

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
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

  // Use time=all to avoid "No features..." when now is past the dataset's latest timestamp.
  // NCSS supports time=all for point datasets. :contentReference[oaicite:1]{index=1}
  const url =
    `${base}?` +
    `var=waveHs&var=waveTp&var=waveDp&var=waveDm&var=waveFlagPrimary` +
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
      return {
        time: r.time ?? r["time"] ?? "",
        waveHs: r.waveHs ? Number(r.waveHs) : null,
        waveTp: r.waveTp ? Number(r.waveTp) : null,
        waveDp: r.waveDp ? Number(r.waveDp) : null,
        waveDm: r.waveDm ? Number(r.waveDm) : null,
        waveFlagPrimary: Number.isFinite(flag) ? flag : null,
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
    count: points.length,
    points,
    source: "CDIP THREDDS NCSS MOP_alongshore",
  });
}

