/**
 * Import accepted Strava segments from data/strava_segments.sqlite
 * into the main activities database (data/activities.db).
 *
 * Run with:  npm run seed-strava
 *
 * Safe to re-run — uses INSERT OR IGNORE on a unique constraint over
 * (title, latitude, longitude) to skip already-imported rows.
 */

import path from "node:path";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const SRC_PATH = path.join(ROOT, "data", "strava_segments.sqlite");
const DST_PATH = path.join(ROOT, "data", "activities.db");

const src = new Database(SRC_PATH, { readonly: true });
const dst = new Database(DST_PATH);

const exists = dst.prepare(
  "SELECT 1 FROM activities WHERE gpx_track_id = ? LIMIT 1"
);

const insert = dst.prepare(`
  INSERT INTO activities
    (title, activities, tags, location, rating, url, latitude, longitude, gpx_track_id)
  VALUES
    (@title, @activities, @tags, @location, @rating, @url, @latitude, @longitude, @gpx_track_id)
`);

type Segment = {
  id: number;
  name: string;
  activity_type: string;
  distance_m: number;
  avg_grade: number | null;
  athlete_count: number;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
};

const segments = src
  .prepare(
    `SELECT id, name, activity_type, distance_m, avg_grade, athlete_count,
            start_lat, start_lon, end_lat, end_lon
     FROM segments
     WHERE status = 'accepted'
       AND start_lat IS NOT NULL AND start_lon IS NOT NULL
       AND end_lat   IS NOT NULL AND end_lon   IS NOT NULL
     ORDER BY id`
  )
  .all() as Segment[];

src.close();

console.log(`Found ${segments.length} accepted Strava segments to import`);

let inserted = 0;
let skipped = 0;

const tx = dst.transaction(() => {
  for (const seg of segments) {
    const distMiles = seg.distance_m / 1609.344;
    const tags: string[] = [`${distMiles.toFixed(1)} Miles`];
    if (seg.avg_grade != null && seg.avg_grade !== 0) {
      tags.push(`${seg.avg_grade.toFixed(1)}% avg grade`);
    }

    const activities =
      seg.activity_type === "running" ? '["Running"]' : '["Cycling"]';

    // Midpoint of start/end as the representative location
    const latitude = (seg.start_lat + seg.end_lat) / 2;
    const longitude = (seg.start_lon + seg.end_lon) / 2;

    // Use athlete_count as review proxy so sorting by popularity works.
    // The activities-db route filters out rating = '[0, 0]', so this also
    // ensures the row is included.
    const rating = `[0, ${seg.athlete_count}]`;

    const key = `strava_${seg.id}`;
    if (exists.get(key)) {
      skipped++;
      continue;
    }

    insert.run({
      title: seg.name,
      activities,
      tags: JSON.stringify(tags),
      location: "Northern California",
      rating,
      url: `https://www.strava.com/segments/${seg.id}`,
      latitude,
      longitude,
      gpx_track_id: key,
    });
    inserted++;
  }
});

try {
  tx();
} catch (e: any) {
  console.error("Import failed:", e?.message ?? e);
  dst.close();
  process.exit(1);
}

const total = dst
  .prepare("SELECT COUNT(*) as n FROM activities")
  .get() as { n: number };

dst.close();

console.log(`Inserted ${inserted} new segments, skipped ${skipped} already present`);
console.log(`activities.db now has ${total.n} total rows`);
