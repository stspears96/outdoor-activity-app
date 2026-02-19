"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  RecommendationsResponse,
  Place,
  PlaceType,
  TrailItem,
  TrailLine,
} from "@/lib/types";
import { GeoButton } from "@/components/GeoButton";
import { LocationSearch } from "@/components/LocationSearch";
import { ActivityCard } from "@/components/ActivityCard";
import MapViewDynamic from "@/components/MapViewDynamic";
import SwellForecastModal from "@/components/SwellForecastModal";

export default function Page() {
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [locationLabel, setLocationLabel] = useState("You are here");
  const [windowHours, setWindowHours] = useState(6);

  // Recommendations (weather-based activity scores)
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map mode: either show generic places (parks/cafes/etc.) or hiking markers
  const [mode, setMode] = useState<"places" | "trails" | "surf">("places");
  const [trailActivityType, setTrailActivityType] = useState<"hike" | "run" | "mtb">("hike");

  // ----- Places (OSM Overpass /api/places) -----
  const [selectedPlaceType, setSelectedPlaceType] = useState<PlaceType>("park");
  const [places, setPlaces] = useState<Place[]>([]);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const radiusMiles = 2;

  // ----- Trails markers (OSM Overpass /api/trails + USFS /api/trails-usfs) -----
  const [trailItems, setTrailItems] = useState<TrailItem[]>([]);
  const [trailsBusy, setTrailsBusy] = useState(false);
  const [trailsError, setTrailsError] = useState<string | null>(null);
  const trailsRadiusMiles = 6;

  // Pre-loaded USFS trail geometries (keyed by trail id, no second fetch needed)
  const [usfsLines, setUsfsLines] = useState<Map<string, TrailLine>>(new Map());

  // ----- Selected trail lines (on-demand via /api/trail-lines-for, or pre-loaded for USFS) -----
  const [selectedTrailLines, setSelectedTrailLines] = useState<TrailLine[]>([]);
  const [selectedTrailLabel, setSelectedTrailLabel] = useState<string | null>(null);
  const [selectedTrailBusy, setSelectedTrailBusy] = useState(false);
  const [selectedTrailError, setSelectedTrailError] = useState<string | null>(null);
  
  // ---- Surf spots ----
  const [surfSpots, setSurfSpots] = useState<any[]>([]);
  const [surfBusy, setSurfBusy] = useState(false);
  const [surfError, setSurfError] = useState<string | null>(null);

  // ---- Swell forecast modal ----
  const [forecastSpot, setForecastSpot] = useState<{ name: string; transectId: string } | null>(null);

  const canFetch = useMemo(
    () => typeof lat === "number" && typeof lon === "number",
    [lat, lon]
  );

  function placeTypeForActivity(activityId: string): PlaceType {
    switch (activityId) {
      case "picnic":
        return "park";
      case "hike":
        return "trail";
      case "run":
        return "trail";
      case "bike":
        return "trail";
      case "cafe":
        return "cafe";
      case "surf":
        return "park"; // unreachable — surf sets mode directly
      case "walk":
      default:
        return "park";
    }
  }

  async function fetchRecs() {
    if (!canFetch) return;
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(
        `/api/recommendations?lat=${lat}&lon=${lon}&windowHours=${windowHours}`
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as RecommendationsResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load recommendations.");
    } finally {
      setBusy(false);
    }
  }

  // Fetch recommendations when we first get a location and when windowHours changes
  useEffect(() => {
    if (canFetch) fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, windowHours]);

  // Fetch places when in "places" mode
  useEffect(() => {
    async function fetchPlaces() {
      if (!canFetch || mode !== "places") return;
      setPlacesBusy(true);
      setPlacesError(null);

      try {
        const res = await fetch(
          `/api/places?lat=${lat}&lon=${lon}&type=${selectedPlaceType}&radiusMiles=${radiusMiles}&limit=50`
        );
        if (!res.ok) throw new Error(`Places request failed: ${res.status}`);
        const json = await res.json();
        setPlaces(json.places ?? []);
      } catch (e: any) {
        setPlacesError(e?.message ?? "Failed to load places.");
        setPlaces([]);
      } finally {
        setPlacesBusy(false);
      }
    }
    fetchPlaces();
  }, [canFetch, lat, lon, mode, selectedPlaceType]);

  useEffect(() => {
    async function fetchSurf() {
      if (!canFetch || mode !== "surf") return;

      setSurfBusy(true);
      setSurfError(null);

      try {
        const res = await fetch(`/api/surf?lat=${lat}&lon=${lon}&radiusKm=60`);
        if (!res.ok) throw new Error(`Surf request failed: ${res.status}`);
        const json = await res.json();
        const spots = (json.spots ?? []).map((s: any) => ({
          ...s,
          cdipTransectId: s.cdip_transect_id ?? null,
        }));
        setSurfSpots(spots);
      } catch (e: any) {
        setSurfError(e?.message ?? "Failed to load surf spots.");
        setSurfSpots([]);
      } finally {
        setSurfBusy(false);
      }
    }

    fetchSurf();
  }, [canFetch, mode, lat, lon]);


  // Fetch trail markers when in "trails" mode (OSM + USFS + Outbound for hike; Outbound only for run)
  useEffect(() => {
    async function fetchTrails() {
      if (!canFetch || mode !== "trails") return;
      setTrailsBusy(true);
      setTrailsError(null);

      // Clear previous selected lines whenever we re-enter trails mode / refetch markers
      setSelectedTrailLines([]);
      setSelectedTrailLabel(null);
      setSelectedTrailError(null);
      setUsfsLines(new Map());

      try {
        if (trailActivityType === "run" || trailActivityType === "mtb") {
          const activityType = trailActivityType === "run" ? "running" : "mtb";
          const dbRes = await fetch(`/api/activities-db?lat=${lat}&lon=${lon}&activityType=${activityType}&radiusKm=40`);
          if (!dbRes.ok) throw new Error(`${activityType} spots request failed: ${dbRes.status}`);
          const json = await dbRes.json();
          setTrailItems(json.items ?? []);
        } else {
          const [osmRes, usfsRes, dbRes] = await Promise.allSettled([
            fetch(`/api/trails?lat=${lat}&lon=${lon}&radiusMiles=${trailsRadiusMiles}&limitItems=180`),
            fetch(`/api/trails-usfs?lat=${lat}&lon=${lon}&radiusMiles=30`),
            fetch(`/api/activities-db?lat=${lat}&lon=${lon}&activityType=hiking&radiusKm=40`),
          ]);

          let osmItems: TrailItem[] = [];
          if (osmRes.status === "fulfilled" && osmRes.value.ok) {
            const json = await osmRes.value.json();
            osmItems = json.items ?? [];
          } else if (osmRes.status === "rejected" || (osmRes.status === "fulfilled" && !osmRes.value.ok)) {
            setTrailsError("Failed to load OSM trails.");
          }

          let usfsItems: TrailItem[] = [];
          if (usfsRes.status === "fulfilled" && usfsRes.value.ok) {
            const json = await usfsRes.value.json();
            usfsItems = json.items ?? [];
            // Pre-load USFS geometries into a map for instant line display on click
            const lineMap = new Map<string, TrailLine>();
            for (const ln of (json.lines ?? []) as TrailLine[]) {
              lineMap.set(ln.id, ln);
            }
            setUsfsLines(lineMap);
          }
          // USFS failure is best-effort — silently skip

          let dbItems: TrailItem[] = [];
          if (dbRes.status === "fulfilled" && dbRes.value.ok) {
            const json = await dbRes.value.json();
            dbItems = json.items ?? [];
          }
          // Outbound failure is best-effort — silently skip

          setTrailItems([...osmItems, ...usfsItems, ...dbItems]);
        }
      } catch (e: any) {
        setTrailsError(e?.message ?? "Failed to load trails.");
        setTrailItems([]);
      } finally {
        setTrailsBusy(false);
      }
    }

    fetchTrails();
  }, [canFetch, lat, lon, mode, trailActivityType]);

  async function loadLinesFor(
    refType: "relation" | "way" | "usfs",
    id: number | string,
    label: string
  ) {
    if (!canFetch) return;

    setSelectedTrailLabel(label);
    setSelectedTrailError(null);

    // USFS trails have pre-loaded geometry — no API call needed
    if (refType === "usfs") {
      const usfsId = String(id);
      const preloaded = usfsLines.get(usfsId);
      if (preloaded) {
        setSelectedTrailLines([preloaded]);
      } else {
        setSelectedTrailLines([]);
      }
      return;
    }

    setSelectedTrailBusy(true);

    try {
      const res = await fetch(
        `/api/trail-lines-for?refType=${refType}&id=${id}&wayGeomLimit=140&simplifyEveryN=2`
      );
      if (!res.ok) throw new Error(`Trail line request failed: ${res.status}`);
      const json = await res.json();
      setSelectedTrailLines(json.lines ?? []);
    } catch (e: any) {
      setSelectedTrailError(e?.message ?? "Failed to load trail line.");
      setSelectedTrailLines([]);
    } finally {
      setSelectedTrailBusy(false);
    }
  }

  const mapSubtitle =
    mode === "trails"
      ? trailActivityType === "run"
        ? "Running spots: click a marker for details"
        : trailActivityType === "mtb"
        ? "Mountain biking spots: click a marker for details"
        : `Hiking: click a trail marker, then "Load trail line" (within ${trailsRadiusMiles} mi)`
      : `Places: ${selectedPlaceType} (within ${radiusMiles} mi)`;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 18 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        Outdoor activity suggester
      </h1>
      <p style={{ color: "#444", marginTop: 0 }}>
        Picks activities based on the next few hours of weather near you, then
        shows nearby spots on a map.
      </p>

      <section
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
          margin: "14px 0",
        }}
      >
        <GeoButton
          onLocation={(la, lo) => {
            setLat(la);
            setLon(lo);
            setLocationLabel("You are here");
          }}
        />

        <LocationSearch
          onLocation={(la, lo, name) => {
            setLat(la);
            setLon(lo);
            setLocationLabel(name);
          }}
        />

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#444" }}>Window</span>
          <select
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            style={{
              padding: "9px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
            }}
          >
            {[3, 6, 9, 12, 24].map((h) => (
              <option key={h} value={h}>
                next {h} hours
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={fetchRecs}
          disabled={!canFetch || busy}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: !canFetch || busy ? "not-allowed" : "pointer",
            background: "white",
          }}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </section>

      {!canFetch ? (
        <div
          style={{
            padding: 14,
            border: "1px dashed #ccc",
            borderRadius: 14,
            color: "#555",
          }}
        >
          Click <b>Use my location</b> or search a destination to get recommendations.
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            padding: 14,
            border: "1px solid #ffcccc",
            background: "#fff5f5",
            borderRadius: 14,
            color: "#7a1f1f",
            marginTop: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {canFetch ? (
        <section style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 8, color: "#444", fontSize: 13 }}>
            {mapSubtitle}
          </div>

	  {mode === "surf" ? (
	    <div style={{ marginBottom: 8, fontSize: 12, color: "#444" }}>
	      surfSpots count: {surfSpots.length}
	    </div>
	  ) : null}

          <MapViewDynamic
            lat={lat!}
            lon={lon!}
            label={locationLabel}
            places={mode === "places" ? places : []}
            trailItems={mode === "trails" ? trailItems : []}
            trailLines={mode === "trails" ? selectedTrailLines : []}
            surfSpots={mode === "surf" ? surfSpots : []}
	    onLoadTrailLine={loadLinesFor}
	    onViewForecast={(name, transectId) => setForecastSpot({ name, transectId })}
          />

          {/* Places status */}
          {mode === "places" && placesBusy ? (
            <div style={{ marginTop: 8, color: "#555" }}>
              Loading nearby places…
            </div>
          ) : null}
          {mode === "places" && placesError ? (
            <div style={{ marginTop: 8, color: "crimson" }}>{placesError}</div>
          ) : null}

          {/* Trails markers status */}
          {mode === "trails" && trailsBusy ? (
            <div style={{ marginTop: 8, color: "#555" }}>Loading trails…</div>
          ) : null}
          {mode === "trails" && trailsError ? (
            <div style={{ marginTop: 8, color: "crimson" }}>{trailsError}</div>
          ) : null}

          {/* Selected trail line status */}
          {mode === "trails" ? (
            <div style={{ marginTop: 8, color: "#444", fontSize: 13 }}>
              {selectedTrailBusy ? "Loading selected trail line…" : null}
              {!selectedTrailBusy && selectedTrailLabel
                ? `Selected: ${selectedTrailLabel}`
                : null}
              {selectedTrailError ? (
                <div style={{ color: "crimson" }}>{selectedTrailError}</div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {data ? (
        <>
          <div style={{ marginTop: 18, color: "#444", fontSize: 13 }}>
            Generated: {new Date(data.generatedAtISO).toLocaleString()} · (
            {data.lat.toFixed(4)}, {data.lon.toFixed(4)})
          </div>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
              marginTop: 12,
            }}
          >
            {data.activities.filter((a) => a.id !== "walk").slice(0, 6).map((a) => (
              <div
                key={a.id}
                onClick={() => {
		  if (a.id === "hike") {
		    setTrailActivityType("hike");
		    setMode("trails");
		    return;
		  }

		  if (a.id === "run") {
		    setTrailActivityType("run");
		    setMode("trails");
		    return;
		  }

		  if (a.id === "mtb") {
		    setTrailActivityType("mtb");
		    setMode("trails");
		    return;
		  }

		  if (a.id === "surf") {
		    setMode("surf");
		    return;
		  }

		  setMode("places");
		  setSelectedPlaceType(placeTypeForActivity(a.id));
		}}
                style={{ cursor: "pointer" }}
                title={
                  a.id === "hike"
                    ? "Click to show nearby hiking trail markers"
                    : "Click to show matching places on the map"
                }
              >
                <ActivityCard a={a} />
              </div>
            ))}
          </section>

          <section style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
              Next hours preview
            </h2>
            <div
              style={{
                overflowX: "auto",
                border: "1px solid #e5e5e5",
                borderRadius: 14,
              }}
            >
              <table
                style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}
              >
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      Time
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      Feels like (°F)
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      Rain chance
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      Wind (mph)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.hourlyPreview.map((h) => (
                    <tr key={h.timeISO}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                        {new Date(h.timeISO).toLocaleString()}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                        {typeof h.tempF === "number" ? Math.round(h.tempF) : "—"}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                        {typeof h.precipProb === "number"
                          ? `${Math.round(h.precipProb)}%`
                          : "—"}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                        {typeof h.windMph === "number" ? Math.round(h.windMph) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : busy ? (
        <div style={{ marginTop: 18, color: "#444" }}>Loading recommendations…</div>
      ) : null}

      {forecastSpot && (
        <SwellForecastModal
          name={forecastSpot.name}
          transectId={forecastSpot.transectId}
          onClose={() => setForecastSpot(null)}
        />
      )}
    </main>
  );
}

