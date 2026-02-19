#!/usr/bin/env python3
"""
Scrape GPX track IDs from theoutbound.com activity pages and download GPX files.

Two-phase operation:
  Phase 1 – Fetch each activity page, extract gpx_track_id, write to DB.
             Safe to re-run; already-scraped rows are skipped.
  Phase 2 – Download GPX files for rows that have a gpx_track_id.
             Safe to re-run; already-downloaded files are skipped.

Usage:
  python -m activities_db.scrape_gpx --cookie "_outbound_session=abc123..."
  python -m activities_db.scrape_gpx --cookie "..." --phase 1   # scrape only
  python -m activities_db.scrape_gpx --cookie "..." --phase 2   # download only

Getting your session cookie:
  1. Log in at theoutbound.com in Chrome/Firefox
  2. Open DevTools → Application → Cookies → theoutbound.com
  3. Copy the full cookie header string (all cookies, comma-separated), or
     just the _outbound_session value and pass as: --cookie "_outbound_session=VALUE"
"""

import argparse
import os
import re
import sqlite3
import time
from pathlib import Path

import requests

DB_PATH = Path(__file__).parents[2] / "data" / "activities.db"
GPX_DIR = Path(__file__).parents[2] / "data" / "gpx"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.theoutbound.com/",
}

GPX_TRACK_ID_RE = re.compile(r'"gpx_track_id"\s*:\s*(\d+)')


def ensure_column(conn: sqlite3.Connection) -> None:
    cols = [row[1] for row in conn.execute("PRAGMA table_info(activities)")]
    if "gpx_track_id" not in cols:
        conn.execute("ALTER TABLE activities ADD COLUMN gpx_track_id INTEGER")
        conn.commit()
        print("Added gpx_track_id column to activities table.")


def phase1_scrape(conn: sqlite3.Connection, delay: float) -> None:
    """Fetch each page that doesn't yet have a gpx_track_id and extract it."""
    rows = conn.execute(
        "SELECT id, url FROM activities WHERE gpx_track_id IS NULL ORDER BY id"
    ).fetchall()

    print(f"Phase 1: {len(rows)} rows need scraping.")

    session = requests.Session()
    session.headers.update(HEADERS)

    for i, (row_id, url) in enumerate(rows, 1):
        try:
            resp = session.get(url, timeout=15)
            resp.raise_for_status()
            m = GPX_TRACK_ID_RE.search(resp.text)
            if m:
                track_id = int(m.group(1))
                conn.execute(
                    "UPDATE activities SET gpx_track_id = ? WHERE id = ?",
                    (track_id, row_id),
                )
                conn.commit()
                print(f"  [{i}/{len(rows)}] #{row_id} → gpx_track_id={track_id}")
            else:
                # Mark as 0 so we don't re-scrape (no GPX for this activity)
                conn.execute(
                    "UPDATE activities SET gpx_track_id = 0 WHERE id = ?",
                    (row_id,),
                )
                conn.commit()
                print(f"  [{i}/{len(rows)}] #{row_id} — no GPX track found")
        except requests.RequestException as e:
            print(f"  [{i}/{len(rows)}] #{row_id} ERROR: {e}")

        if i < len(rows):
            time.sleep(delay)

    print("Phase 1 complete.\n")


def phase2_download(conn: sqlite3.Connection, cookie: str, delay: float) -> None:
    """Download GPX files for rows that have a non-zero gpx_track_id."""
    GPX_DIR.mkdir(parents=True, exist_ok=True)

    rows = conn.execute(
        "SELECT id, title, gpx_track_id FROM activities WHERE gpx_track_id > 0 ORDER BY id"
    ).fetchall()

    print(f"Phase 2: {len(rows)} rows have GPX track IDs.")

    session = requests.Session()
    session.headers.update(HEADERS)
    session.headers["Cookie"] = cookie

    downloaded = 0
    skipped = 0
    failed = 0

    for i, (row_id, title, track_id) in enumerate(rows, 1):
        dest = GPX_DIR / f"{track_id}.gpx"
        if dest.exists():
            skipped += 1
            continue

        url = f"https://www.theoutbound.com/api/gpx_tracks/{track_id}/download.gpx"
        try:
            resp = session.get(url, timeout=20)
            if resp.status_code == 401:
                print(f"  [{i}/{len(rows)}] 401 Unauthorized — check your cookie and re-run.")
                failed += 1
                break
            resp.raise_for_status()
            dest.write_bytes(resp.content)
            downloaded += 1
            print(f"  [{i}/{len(rows)}] #{row_id} track {track_id} → {dest.name}  ({len(resp.content):,} bytes)")
        except requests.RequestException as e:
            print(f"  [{i}/{len(rows)}] #{row_id} track {track_id} ERROR: {e}")
            failed += 1

        if i < len(rows):
            time.sleep(delay)

    print(f"\nPhase 2 complete: {downloaded} downloaded, {skipped} already existed, {failed} failed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Outbound GPX track IDs and download GPX files.")
    parser.add_argument("--cookie", default=os.environ.get("OUTBOUND_COOKIE", ""),
                        help="Full Cookie header string for theoutbound.com (or set OUTBOUND_COOKIE env var)")
    parser.add_argument("--phase", type=int, choices=[1, 2], default=0,
                        help="Run only phase 1 (scrape) or phase 2 (download). Default: both.")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds between requests (default: 1.0)")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)
    ensure_column(conn)

    run_phase1 = args.phase in (0, 1)
    run_phase2 = args.phase in (0, 2)

    if run_phase1:
        phase1_scrape(conn, args.delay)

    if run_phase2:
        if not args.cookie:
            print("ERROR: --cookie is required for phase 2 (GPX download).")
            print("  Log in at theoutbound.com, copy the Cookie header from DevTools, and pass it as --cookie.")
            raise SystemExit(1)
        phase2_download(conn, args.cookie, args.delay)

    conn.close()


if __name__ == "__main__":
    main()
