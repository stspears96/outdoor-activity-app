#!/usr/bin/env python3
"""
Download GPX files for popular Strava segments in Northern California.

Filters applied:
  - Region:        lat 36.2–42.0°N, lon -124.5–-119.5°W  (Big Sur → OR border)
  - Activity:      running + riding (both)
  - Min distance:  2.5 miles (4.023 km)
  - Min athletes:  40
  - Rate limit:    10 s between requests (~6 req/min, safely under 100/15 min)

Strategy:
  Phase 1 — Tile the bounding box (0.5° cells) and call /segments/explore for
             each tile × activity type. Saves all returned segments to the DB,
             including their encoded-polyline path. Tiles are checkpointed so
             the phase is safe to re-run.
  Phase 2 — Fetch /segments/{id} details for segments that pass the distance
             filter but haven't had their athlete_count checked yet. Marks
             rows as accepted or rejected.
  Phase 3 — Write GPX files for accepted segments, decoded from the polyline
             already stored in Phase 1. No extra API calls needed.

OAuth setup (one-time):
  1. Create a free Strava API app at https://www.strava.com/settings/api
       - "Authorization Callback Domain" must be: localhost
  2. Run:  python -m strava_segments.scrape --authorize \\
               --client-id YOUR_ID --client-secret YOUR_SECRET
  3. A URL is printed — open it in your browser, authorize the app, then copy
     the `code=` value from the redirect URL and paste it back.
  4. Tokens are saved to data/strava_tokens.json for all future runs.

Subsequent runs (no --authorize needed):
  python -m strava_segments.scrape --client-id ID --client-secret SECRET
  python -m strava_segments.scrape   # if tokens already saved
"""

import argparse
import json
import sqlite3
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import requests

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT        = Path(__file__).parents[2]
DB_PATH     = ROOT / "data" / "strava_segments.sqlite"
GPX_DIR     = ROOT / "data" / "gpx"
TOKENS_PATH = ROOT / "data" / "strava_tokens.json"

# ── Constants ─────────────────────────────────────────────────────────────────

BOUNDS = dict(min_lat=36.2, max_lat=42.0, min_lon=-124.5, max_lon=-119.5)
TILE_DEG      = 0.5          # degrees per tile side
MIN_DIST_M    = 4_023.0      # 2.5 miles in metres
MIN_ATHLETES  = 40
ACTIVITY_TYPES = ["running", "riding"]
REQUEST_DELAY = 10.0         # seconds between API calls

STRAVA_AUTH_URL  = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
API_BASE         = "https://www.strava.com/api/v3"

# ── Database ──────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS segments (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  activity_type TEXT,
  distance_m    REAL,
  avg_grade     REAL,
  athlete_count INTEGER,
  start_lat     REAL,
  start_lon     REAL,
  end_lat       REAL,
  end_lon       REAL,
  points        TEXT,       -- Google encoded polyline
  status        TEXT        -- 'pending_details' | 'accepted' | 'rejected'
);
CREATE TABLE IF NOT EXISTS explored_tiles (
  tile_key      TEXT,
  activity_type TEXT,
  explored_at   TEXT,
  PRIMARY KEY (tile_key, activity_type)
);
"""

def open_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# ── OAuth ─────────────────────────────────────────────────────────────────────

def load_tokens() -> dict | None:
    if TOKENS_PATH.exists():
        return json.loads(TOKENS_PATH.read_text())
    return None


def save_tokens(tokens: dict) -> None:
    TOKENS_PATH.write_text(json.dumps(tokens, indent=2))


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    resp = requests.post(STRAVA_TOKEN_URL, data={
        "client_id":     client_id,
        "client_secret": client_secret,
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def get_access_token(client_id: str, client_secret: str) -> str:
    """Return a valid access token, refreshing if necessary."""
    tokens = load_tokens()
    if not tokens:
        raise RuntimeError(
            "No saved tokens — run with --authorize first."
        )

    # Refresh if expired (with 60 s buffer)
    if tokens["expires_at"] < time.time() + 60:
        print("Access token expired, refreshing…")
        new_tokens = refresh_access_token(
            client_id, client_secret, tokens["refresh_token"]
        )
        tokens.update(new_tokens)
        save_tokens(tokens)

    return tokens["access_token"]


def authorize(client_id: str, client_secret: str) -> None:
    """Walk the user through the one-time OAuth flow."""
    url = (
        f"{STRAVA_AUTH_URL}?client_id={client_id}"
        "&response_type=code"
        "&redirect_uri=http://localhost/exchange_token"
        "&approval_prompt=force"
        "&scope=read,activity:read"
    )
    print("\n=== Strava Authorization ===")
    print("Open this URL in your browser:\n")
    print(f"  {url}\n")
    print("After authorizing, you'll be redirected to a URL like:")
    print("  http://localhost/exchange_token?state=&code=XXXX&scope=...\n")
    code = input("Paste the 'code' value from that URL here: ").strip()

    resp = requests.post(STRAVA_TOKEN_URL, data={
        "client_id":     client_id,
        "client_secret": client_secret,
        "code":          code,
        "grant_type":    "authorization_code",
    }, timeout=15)
    resp.raise_for_status()
    tokens = resp.json()
    save_tokens(tokens)
    print(f"\nAuthorized as: {tokens.get('athlete', {}).get('firstname', '?')} "
          f"{tokens.get('athlete', {}).get('lastname', '')}")
    print(f"Tokens saved to {TOKENS_PATH}")


# ── Strava API helpers ────────────────────────────────────────────────────────

class StravaClient:
    def __init__(self, client_id: str, client_secret: str) -> None:
        self.client_id     = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "strava-segment-scraper/1.0"})

    @property
    def token(self) -> str:
        if not self._token:
            self._token = get_access_token(self.client_id, self.client_secret)
        return self._token

    def get(self, path: str, **params) -> dict:
        """GET with rate-limit handling and automatic token refresh."""
        url = f"{API_BASE}{path}"
        headers = {"Authorization": f"Bearer {self.token}"}

        for attempt in range(3):
            resp = self._session.get(url, headers=headers, params=params, timeout=15)

            if resp.status_code == 401:
                # Token expired mid-run — refresh and retry
                print("  401 — refreshing token…")
                new_tokens = refresh_access_token(
                    self.client_id, self.client_secret, load_tokens()["refresh_token"]
                )
                load_tokens_dict = load_tokens()
                load_tokens_dict.update(new_tokens)
                save_tokens(load_tokens_dict)
                self._token = new_tokens["access_token"]
                headers["Authorization"] = f"Bearer {self._token}"
                continue

            if resp.status_code == 429:
                wait = int(resp.headers.get("X-RateLimit-Reset", 900))
                print(f"  429 rate limit — sleeping {wait} s…")
                time.sleep(wait)
                continue

            resp.raise_for_status()
            return resp.json()

        raise RuntimeError(f"Failed after 3 attempts: {path}")


# ── Polyline decoder ──────────────────────────────────────────────────────────

def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    """Decode a Google encoded polyline to a list of (lat, lon) tuples."""
    coords: list[tuple[float, float]] = []
    index = 0
    lat = 0
    lng = 0
    while index < len(encoded):
        result = shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lat += (~(result >> 1) if result & 1 else result >> 1)

        result = shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lng += (~(result >> 1) if result & 1 else result >> 1)

        coords.append((lat / 1e5, lng / 1e5))
    return coords


# ── GPX writer ────────────────────────────────────────────────────────────────

def write_gpx(path: Path, name: str, coords: list[tuple[float, float]]) -> None:
    root = ET.Element("gpx", {
        "version": "1.1",
        "creator": "strava-segment-scraper",
        "xmlns":   "http://www.topografix.com/GPX/1/1",
    })
    trk  = ET.SubElement(root, "trk")
    ET.SubElement(trk, "name").text = name
    seg  = ET.SubElement(trk, "trkseg")
    for lat, lon in coords:
        ET.SubElement(seg, "trkpt", {"lat": str(lat), "lon": str(lon)})
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    path.write_bytes(b'<?xml version="1.0" encoding="UTF-8"?>\n' +
                     ET.tostring(root, encoding="unicode").encode())


# ── Tile generator ────────────────────────────────────────────────────────────

def generate_tiles() -> list[tuple[float, float, float, float]]:
    """Return list of (sw_lat, sw_lon, ne_lat, ne_lon) tiles covering Northern CA."""
    tiles = []
    lat = BOUNDS["min_lat"]
    while lat < BOUNDS["max_lat"]:
        lon = BOUNDS["min_lon"]
        while lon < BOUNDS["max_lon"]:
            ne_lat = min(lat + TILE_DEG, BOUNDS["max_lat"])
            ne_lon = min(lon + TILE_DEG, BOUNDS["max_lon"])
            tiles.append((lat, lon, ne_lat, ne_lon))
            lon += TILE_DEG
        lat += TILE_DEG
    return tiles


# ── Phase 1: Explore ──────────────────────────────────────────────────────────

def phase1_explore(client: StravaClient, conn: sqlite3.Connection, delay: float = REQUEST_DELAY) -> None:
    tiles  = generate_tiles()
    combos = [(t, a) for t in tiles for a in ACTIVITY_TYPES]

    # Count already-done tiles
    done = {
        (row["tile_key"], row["activity_type"])
        for row in conn.execute("SELECT tile_key, activity_type FROM explored_tiles")
    }
    remaining = [(t, a) for t, a in combos if (f"{t[0]:.2f},{t[1]:.2f}", a) not in done]

    total     = len(combos)
    completed = total - len(remaining)
    print(f"\nPhase 1 — Explore segments")
    print(f"  {total} tile×activity combos total, {completed} already done, {len(remaining)} to go")

    new_segments = 0
    for i, ((sw_lat, sw_lon, ne_lat, ne_lon), activity) in enumerate(remaining, 1):
        tile_key = f"{sw_lat:.2f},{sw_lon:.2f}"
        bounds   = f"{sw_lat},{sw_lon},{ne_lat},{ne_lon}"

        print(f"  [{completed+i}/{total}] tile {tile_key} {activity} … ", end="", flush=True)

        data = client.get("/segments/explore", bounds=bounds, activity_type=activity)
        segments = data.get("segments", [])
        print(f"{len(segments)} segments")

        for seg in segments:
            dist = seg.get("distance", 0)
            if dist < MIN_DIST_M:
                continue  # skip short segments early

            start = seg.get("start_latlng", [None, None])
            end   = seg.get("end_latlng",   [None, None])

            conn.execute("""
                INSERT OR IGNORE INTO segments
                  (id, name, activity_type, distance_m, avg_grade,
                   start_lat, start_lon, end_lat, end_lon, points, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_details')
            """, (
                seg["id"],
                seg.get("name"),
                activity,
                dist,
                seg.get("avg_grade"),
                start[0] if start else None,
                start[1] if start else None,
                end[0] if end else None,
                end[1] if end else None,
                seg.get("points"),
            ))
            if conn.execute("SELECT changes()").fetchone()[0]:
                new_segments += 1

        conn.execute(
            "INSERT OR REPLACE INTO explored_tiles (tile_key, activity_type, explored_at) VALUES (?, ?, ?)",
            (tile_key, activity, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()

        if i < len(remaining):
            time.sleep(delay)

    print(f"\nPhase 1 complete — {new_segments} new segments added (distance ≥ {MIN_DIST_M/1000:.1f} km)")


# ── Phase 2: Fetch details ────────────────────────────────────────────────────

def phase2_details(client: StravaClient, conn: sqlite3.Connection, delay: float = REQUEST_DELAY) -> None:
    rows = conn.execute(
        "SELECT id, name FROM segments WHERE status = 'pending_details' ORDER BY id"
    ).fetchall()

    print(f"\nPhase 2 — Fetch segment details")
    print(f"  {len(rows)} segments to check")

    accepted = rejected = 0
    for i, row in enumerate(rows, 1):
        seg_id = row["id"]
        print(f"  [{i}/{len(rows)}] #{seg_id} {row['name']!r} … ", end="", flush=True)

        detail = client.get(f"/segments/{seg_id}")
        athlete_count = detail.get("athlete_count", 0)

        if athlete_count >= MIN_ATHLETES:
            conn.execute(
                "UPDATE segments SET status='accepted', athlete_count=? WHERE id=?",
                (athlete_count, seg_id),
            )
            accepted += 1
            print(f"✓ {athlete_count} athletes")
        else:
            conn.execute(
                "UPDATE segments SET status='rejected', athlete_count=? WHERE id=?",
                (athlete_count, seg_id),
            )
            rejected += 1
            print(f"✗ {athlete_count} athletes (below {MIN_ATHLETES})")

        conn.commit()

        if i < len(rows):
            time.sleep(delay)

    print(f"\nPhase 2 complete — {accepted} accepted, {rejected} rejected")


# ── Phase 3: Write GPX files ──────────────────────────────────────────────────

def phase3_gpx(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT id, name, points FROM segments WHERE status = 'accepted' AND points IS NOT NULL"
    ).fetchall()

    GPX_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nPhase 3 — Write GPX files")
    print(f"  {len(rows)} accepted segments")

    written = skipped = failed = 0
    for row in rows:
        dest = GPX_DIR / f"strava_{row['id']}.gpx"
        if dest.exists():
            skipped += 1
            continue
        try:
            coords = decode_polyline(row["points"])
            if not coords:
                failed += 1
                print(f"  #{row['id']} — empty polyline, skipping")
                continue
            write_gpx(dest, row["name"] or f"Segment {row['id']}", coords)
            written += 1
            print(f"  strava_{row['id']}.gpx  ({len(coords)} points)")
        except Exception as e:
            failed += 1
            print(f"  #{row['id']} ERROR: {e}")

    print(f"\nPhase 3 complete — {written} written, {skipped} already existed, {failed} failed")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape Strava segment GPX files for Northern California."
    )
    parser.add_argument("--client-id",     default="", help="Strava app client ID")
    parser.add_argument("--client-secret", default="", help="Strava app client secret")
    parser.add_argument("--authorize",     action="store_true",
                        help="Run the one-time OAuth authorization flow")
    parser.add_argument("--phase", type=int, choices=[1, 2, 3], default=0,
                        help="Run only one phase (default: all three)")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY,
                        help=f"Seconds between API calls (default: {REQUEST_DELAY})")
    args = parser.parse_args()

    delay = args.delay

    if args.authorize:
        if not args.client_id or not args.client_secret:
            parser.error("--authorize requires --client-id and --client-secret")
        authorize(args.client_id, args.client_secret)
        return

    if not load_tokens():
        if not args.client_id or not args.client_secret:
            parser.error("No saved tokens — run with --authorize first, or supply --client-id and --client-secret")
        authorize(args.client_id, args.client_secret)

    client = StravaClient(
        args.client_id or "unused",
        args.client_secret or "unused",
    )
    conn = open_db()

    run = args.phase or 0
    try:
        if run in (0, 1):
            phase1_explore(client, conn, delay)
        if run in (0, 2):
            phase2_details(client, conn, delay)
        if run in (0, 3):
            phase3_gpx(conn)
    finally:
        conn.close()

    print("\nDone.")


if __name__ == "__main__":
    main()
