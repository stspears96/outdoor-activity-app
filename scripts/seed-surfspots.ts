import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type Row = Record<string, string>;

function parseCsv(csvText: string): Row[] {
  // Minimal CSV parser (handles commas inside quotes).
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = parseLine(lines[0]);
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length === 0) continue;
    const row: Row = {};
    headers.forEach((h, idx) => (row[h] = cols[idx] ?? ""));
    rows.push(row);
  }
  return rows;
}

function num(v: string, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${field}: "${v}"`);
  return n;
}

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, "data", "surfspots.csv");
const DB_PATH = path.join(ROOT, "data", "surfspots.sqlite");

if (!fs.existsSync(CSV_PATH)) {
  console.error(`Missing ${CSV_PATH}`);
  process.exit(1);
}

const csv = fs.readFileSync(CSV_PATH, "utf8");
const rows = parseCsv(csv);

console.log(`Read ${rows.length} rows from CSV`);

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log(`Deleted existing ${DB_PATH}`);
}

const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE surf_spots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    region TEXT,
    break_type TEXT,
    difficulty TEXT,
    coast_orientation_deg INTEGER,
    swell_min_deg INTEGER,
    swell_max_deg INTEGER,
    wind_offshore_min_deg INTEGER,
    wind_offshore_max_deg INTEGER,
    tide_preference TEXT
  );

  CREATE INDEX idx_surf_spots_lat ON surf_spots(lat);
  CREATE INDEX idx_surf_spots_lon ON surf_spots(lon);
  CREATE INDEX idx_surf_spots_region ON surf_spots(region);
  CREATE INDEX idx_surf_spots_break_type ON surf_spots(break_type);
`);

const insert = db.prepare(`
  INSERT INTO surf_spots (
    id, name, lat, lon, region, break_type, difficulty,
    coast_orientation_deg, swell_min_deg, swell_max_deg,
    wind_offshore_min_deg, wind_offshore_max_deg, tide_preference
  ) VALUES (
    @id, @name, @lat, @lon, @region, @break_type, @difficulty,
    @coast_orientation_deg, @swell_min_deg, @swell_max_deg,
    @wind_offshore_min_deg, @wind_offshore_max_deg, @tide_preference
  )
`);

const tx = db.transaction(() => {
  for (const r of rows) {
    insert.run({
      id: r.id,
      name: r.name,
      lat: num(r.lat, "lat"),
      lon: num(r.lon, "lon"),
      region: r.region || null,
      break_type: r.break_type || null,
      difficulty: r.difficulty || null,
      coast_orientation_deg: r.coast_orientation_deg ? num(r.coast_orientation_deg, "coast_orientation_deg") : null,
      swell_min_deg: r.swell_min_deg ? num(r.swell_min_deg, "swell_min_deg") : null,
      swell_max_deg: r.swell_max_deg ? num(r.swell_max_deg, "swell_max_deg") : null,
      wind_offshore_min_deg: r.wind_offshore_min_deg ? num(r.wind_offshore_min_deg, "wind_offshore_min_deg") : null,
      wind_offshore_max_deg: r.wind_offshore_max_deg ? num(r.wind_offshore_max_deg, "wind_offshore_max_deg") : null,
      tide_preference: r.tide_preference || null,
    });
  }
});

tx();

db.close();
console.log(`Seeded ${rows.length} surf spots → ${DB_PATH}`);

