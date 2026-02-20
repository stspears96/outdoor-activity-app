import { NextResponse } from "next/server";

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

  const transect = (searchParams.get("transect") ?? "").trim();

  if (!/^[A-Z]{2}\d{3}$/.test(transect)) {
    return NextResponse.json({ error: "Invalid transect (expected like SF035)" }, { status: 400 });
  }

  const base =
    `https://thredds.cdip.ucsd.edu/thredds/ncss/point/cdip/model/MOP_alongshore/${transect}_forecast.nc`;

  const url =
    `${base}?` +
    `var=waveHs&var=waveTp&var=waveTa&var=waveDp&var=waveDm` +
    `&time=all` +
    `&accept=csv`;

  const res = await fetch(url, { next: { revalidate: 600 } });
  const text = await res.text();

  if (!res.ok) {
    return NextResponse.json(
      { error: "CDIP forecast request failed", status: res.status, body: text.slice(0, 300) },
      { status: 502 }
    );
  }

  const rows = parseCsv(text);

  const points = rows
    .map((r) => ({
      time: r.time ?? r["time"] ?? "",
      waveHs: r.waveHs ? Number(r.waveHs) : null,
      waveTp: r.waveTp ? Number(r.waveTp) : null,
      waveTa: r.waveTa ? Number(r.waveTa) : null,
      waveDp: r.waveDp ? Number(r.waveDp) : null,
      waveDm: r.waveDm ? Number(r.waveDm) : null,
    }))
    .filter((p) => p.time);

  return NextResponse.json({
    transect,
    count: points.length,
    points,
    source: "CDIP THREDDS NCSS MOP_alongshore forecast",
  });
}
