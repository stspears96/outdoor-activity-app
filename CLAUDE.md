# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint (flat config, ESLint 9+)
npm run seed         # Seed surfspots SQLite database from CSV (uses tsx)
```

No test framework is configured.

## Architecture

**Next.js 16 App Router** application (TypeScript, React 19) that recommends outdoor activities based on weather and location. React Compiler is enabled. No CSS framework—uses inline styles.

### Core Data Flow

1. Client-side `page.tsx` gets user geolocation via browser API
2. Fetches weather-based activity scores from `/api/recommendations`
3. Depending on mode (places/trails/surf), fetches location data displayed on a Leaflet map

### Key Modules

- **`src/lib/scoring.ts`** — Activity scoring algorithm. Band-score function rates activities (walk, run, hike, bike, picnic, cafe, surf) 0-100 based on hourly weather (temperature bands, wind/rain penalties). Tracks "best hour" per activity.
- **`src/lib/cdip.ts`** — CDIP THREDDS swell forecast API wrapper for surf conditions.
- **`src/lib/types.ts`** — All shared TypeScript types.
- **`src/components/MapViewDynamic.tsx`** — Dynamic import wrapper for Leaflet map (client-only to avoid SSR hydration issues).

### API Routes (`src/app/api/`)

All external APIs are **free/public with no auth keys required**:

| Route | Data Source | Purpose |
|-------|-------------|---------|
| `/api/weather` | Open-Meteo | Weather forecasts |
| `/api/recommendations` | Internal scoring | Activity scores from weather |
| `/api/places` | Overpass (OSM) | Nearby parks, cafes, viewpoints |
| `/api/trails` | Overpass (OSM) | Trailheads & hiking routes |
| `/api/trail-lines-for` | Overpass (OSM) | Trail geometry for selected trail |
| `/api/surf` | SQLite + Open-Meteo + CDIP | Surf spot conditions & scoring |
| `/api/cdip/alongshore` | CDIP THREDDS | Swell forecasts (SF Bay area) |

### Surf Subsystem

Surf spots are stored in a local SQLite database (`data/surfspots.sqlite`, seeded from `data/surfspots.csv`). The surf API scores spots using wind direction (offshore preference), swell height/period/direction, with a CDIP cache (10-min TTL). Fallback chain: CDIP swell → Open-Meteo swell → Open-Meteo wave.

### Path Aliases

`@/*` maps to `./src/*` (configured in tsconfig.json).

## Environment Variables

Optional only:
- `NEXT_PUBLIC_BASE_URL` — Base URL for internal API calls (defaults to `http://localhost:3000` or Vercel URL)
