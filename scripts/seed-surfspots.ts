import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type Row = Record<string, string>;

function parseCsv(csvText: string): Row[] {
  // Minimal CSV parser with quoted-field support.
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // handle escaped quotes ("")
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
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function num(v: string, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${field}: "${v}"`);
  return n;
}

function optNum(v: string, field: string): number | null {
  const s = (v ?? "").trim();
  if (s.length === 0) return null;
  return num(s, field);
}

function optText(v: string): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

function requiredText(v: string, field: string): string {
  const s = (v ?? "").trim();
  if (!s) throw new Error(`Missing required field "${field}"`);
  return s;
}

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, "data", "surfspots.csv");
const DB_PATH = path.join(ROOT, "data", "surfspots.sqlite");

if (!fs.existsSync(CSV_PATH)) {
  console.error(`Missing CSV: ${CSV_PATH}`);
  process.exit(1);
}

const csv = fs.readFileSync(CSV_PATH, "utf8");
const rows = parseCsv(csv);

console.log(`Read ${rows.length} rows from CSV`);

if (rows.length === 0) {
  console.error("CSV has no data rows. Aborting.");
  process.exit(1);
}

// Recreate DB
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log(`Deleted existing ${DB_PATH}`);
}

const db = new Database(DB_PATH);

// Schema
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
    tide_preference TEXT,
    cdip_transect_id TEXT
  );

  CREATE INDEX idx_surf_spots_lat ON surf_spots(lat);
  CREATE INDEX idx_surf_spots_lon ON surf_spots(lon);
  CREATE INDEX idx_surf_spots_region ON surf_spots(region);
  CREATE INDEX idx_surf_spots_break_type ON surf_spots(break_type);
  CREATE INDEX idx_surf_spots_cdip_transect_id ON surf_spots(cdip_transect_id);
`);

const insert = db.prepare(`
  INSERT INTO surf_spots (
    id, name, lat, lon,
    region, break_type, difficulty,
    coast_orientation_deg,
    swell_min_deg, swell_max_deg,
    wind_offshore_min_deg, wind_offshore_max_deg,
    tide_preference,
    cdip_transect_id
  ) VALUES (
    @id, @name, @lat, @lon,
    @region, @break_type, @difficulty,
    @coast_orientation_deg,
    @swell_min_deg, @swell_max_deg,
    @wind_offshore_min_deg, @wind_offshore_max_deg,
    @tide_preference,
    @cdip_transect_id
  )
`);

const tx = db.transaction(() => {
  for (const r of rows) {
    // Required
    const id = requiredText(r.id, "id");
    const name = requiredText(r.name, "name");
    const lat = num(r.lat, "lat");
    const lon = num(r.lon, "lon");

    // Optional
    const region = optText(r.region);
    const break_type = optText(r.break_type);
    const difficulty = optText(r.difficulty);

    const coast_orientation_deg = optNum(r.coast_orientation_deg, "coast_orientation_deg");
    const swell_min_deg = optNum(r.swell_min_deg, "swell_min_deg");
    const swell_max_deg = optNum(r.swell_max_deg, "swell_max_deg");
    const wind_offshore_min_deg = optNum(r.wind_offshore_min_deg, "wind_offshore_min_deg");
    const wind_offshore_max_deg = optNum(r.wind_offshore_max_deg, "wind_offshore_max_deg");
    const tide_preference = optText(r.tide_preference);

    const cdip_transect_id = optText(r.cdip_transect_id);

    insert.run({
      id,
      name,
      lat,
      lon,
      region,
      break_type,
      difficulty,
      coast_orientation_deg,
      swell_min_deg,
      swell_max_deg,
      wind_offshore_min_deg,
      wind_offshore_max_deg,
      tide_preference,
      cdip_transect_id,
    });
  }
});

try {
  tx();
} catch (e: any) {
  console.error("Seeding failed:", e?.message ?? e);
  db.close();
  process.exit(1);
}

// sanity count
const count = db.prepare(`SELECT COUNT(*) as n FROM surf_spots`).get() as { n: number };
const sample = db
  .prepare(`SELECT id, name, region, cdip_transect_id FROM surf_spots ORDER BY id LIMIT 5`)
  .all() as Array<any>;

db.close();

console.log(`Seeded ${count.n} surf spots → ${DB_PATH}`);
console.log("Sample rows:", sample);

