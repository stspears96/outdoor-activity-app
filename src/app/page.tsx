"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RecommendationsResponse,
  BestTimeResponse,
  Place,
  PlaceType,
  TrailItem,
  TrailLine,
  ActivityId,
} from "@/lib/types";
import { ACTIVITY_CATALOG } from "@/lib/activities";
import { GeoButton } from "@/components/GeoButton";
import { LocationSearch } from "@/components/LocationSearch";
import MapViewDynamic from "@/components/MapViewDynamic";
import SwellForecastModal from "@/components/SwellForecastModal";
import LogSessionModal from "@/components/LogSessionModal";
import { LearnedPrefsPanel } from "@/components/LearnedPrefsPanel";
import { BestTimePanel } from "@/components/BestTimePanel";
import type { LearningState } from "@/lib/learning/types";
import { loadState, saveState, addObservation } from "@/lib/learning/store";

export default function Page() {
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [locationLabel, setLocationLabel] = useState("You are here");
  const defaultWindowHours = 3;
  const [selectedDate, setSelectedDate] = useState<string>("");

  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const next7Days = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const value = `${y}-${m}-${day}`;
      const label = i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      out.push({ value, label });
    }
    return out;
  }, []);

  // Recommendations (weather-based activity scores)
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map mode: either show generic places (parks/cafes/etc.) or hiking markers
  const [mode, setMode] = useState<"places" | "trails" | "surf">("trails");
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>("all");

  // Map centering state
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

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

  // ----- Selected trail lines (on-demand via /api/trail-lines-for or /api/usfs-trail-line) -----
  const [selectedTrailLines, setSelectedTrailLines] = useState<TrailLine[]>([]);
  const [selectedTrailLabel, setSelectedTrailLabel] = useState<string | null>(null);
  const [selectedTrailBusy, setSelectedTrailBusy] = useState(false);
  const [selectedTrailError, setSelectedTrailError] = useState<string | null>(null);

  // ---- Surf spots ----
  const [surfSpots, setSurfSpots] = useState<any[]>([]);
  const [surfBusy, setSurfBusy] = useState(false);
  const [surfError, setSurfError] = useState<string | null>(null);

  // ---- Swell forecast modal ----
  const [forecastSpot, setForecastSpot] = useState<any | null>(null);

  // ---- Log session modal ----
  const [logTarget, setLogTarget] = useState<{
    activityType: string;
    spotId?: string | null;
    spotName: string;
    lat: number;
    lon: number;
  } | null>(null);

  // ---- Learning ----
  const [learningState, setLearningState] = useState<LearningState | null>(null);
  const [showLearnedPrefs, setShowLearnedPrefs] = useState(false);

  // Load learning state once on mount
  useEffect(() => { setLearningState(loadState()); }, []);

  // ---- Best time this week ----
  const [bestTimeData, setBestTimeData] = useState<BestTimeResponse | null>(null);
  const [bestTimeBusy, setBestTimeBusy] = useState(false);
  const [bestTimeError, setBestTimeError] = useState<string | null>(null);
  const [showBestTime, setShowBestTime] = useState(false);

  const canFetch = useMemo(
    () => typeof lat === "number" && typeof lon === "number",
    [lat, lon]
  );

  const fetchBestTime = useCallback(async (activity: string) => {
    if (!canFetch) return;
    setBestTimeBusy(true);
    setBestTimeData(null);
    setBestTimeError(null);
    try {
      const res = await fetch(`/api/best-time-for?lat=${lat}&lon=${lon}&activity=${activity}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = await res.json();
      console.log("[best-time-for] days:", json.days?.length, json.days?.[0]);
      setBestTimeData(json);
    } catch (e: any) {
      setBestTimeError(e?.message ?? "Failed to load weekly forecast.");
    } finally {
      setBestTimeBusy(false);
    }
  }, [canFetch, lat, lon]);

  const fetchRecs = useCallback(async () => {
    if (!canFetch) return;
    setBusy(true);
    setError(null);
    setData(null);
    try {
      let url = `/api/individual-recommendations?lat=${lat}&lon=${lon}&windowHours=${defaultWindowHours}`;
      if (selectedDate) {
        url += `&date=${encodeURIComponent(selectedDate)}`;
      }
      if (activityTypeFilter !== "all") {
        url += `&activityType=${activityTypeFilter}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as RecommendationsResponse;
      setData(json);

    } catch (e: any) {
      setError(e?.message ?? "Failed to load recommendations.");
    } finally {
      setBusy(false);
    }
  }, [canFetch, lat, lon, defaultWindowHours, activityTypeFilter, selectedDate]);

  // Fetch recommendations when we first get a location and when filters or date change.
  // Also reset the best-time panel when location or activity changes.
  useEffect(() => {
    if (canFetch) fetchRecs();
    setShowBestTime(false);
    setBestTimeData(null);
    setBestTimeError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, defaultWindowHours, activityTypeFilter, selectedDate]);

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
        const dateParam = selectedDate ? `&date=${encodeURIComponent(selectedDate)}` : "";
        const res = await fetch(`/api/surf?lat=${lat}&lon=${lon}&radiusKm=60${dateParam}`);
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
  }, [canFetch, mode, lat, lon, selectedDate]);


  // Fetch trail markers when in "trails" mode
  useEffect(() => {
    async function fetchTrails() {
      if (!canFetch || mode !== "trails") return;
      setTrailsBusy(true);
      setTrailsError(null);

      // Clear previous selected lines whenever we re-enter trails mode / refetch markers
      setSelectedTrailLines([]);
      setSelectedTrailLabel(null);
      setSelectedTrailError(null);

      try {
        if (activityTypeFilter !== "all") {
          const fetches: Promise<Response | null>[] = [
            fetch(`/api/activities-db?lat=${lat}&lon=${lon}&activityType=${activityTypeFilter}&radiusKm=16`),
            // USFS trails are all hiking routes — include them for the hike filter
            activityTypeFilter === "hike"
              ? fetch(`/api/trails-usfs?lat=${lat}&lon=${lon}&radiusMiles=30`)
              : Promise.resolve(null),
          ];
          const [dbRes, usfsRes] = await Promise.allSettled(fetches);

          let items: TrailItem[] = [];
          if (dbRes.status === "fulfilled" && dbRes.value?.ok) {
            const json = await dbRes.value.json();
            items = items.concat(json.items ?? []);
          } else if (dbRes.status === "fulfilled" && dbRes.value && !dbRes.value.ok) {
            throw new Error(`${activityTypeFilter} spots request failed: ${dbRes.value.status}`);
          }
          if (usfsRes.status === "fulfilled" && usfsRes.value?.ok) {
            const json = await usfsRes.value.json();
            items = items.concat(json.items ?? []);
          }
          setTrailItems(items);
        } else {
          const [osmRes, usfsRes, dbRes] = await Promise.allSettled([
            fetch(`/api/trails?lat=${lat}&lon=${lon}&radiusMiles=${trailsRadiusMiles}&limitItems=180`),
            fetch(`/api/trails-usfs?lat=${lat}&lon=${lon}&radiusMiles=30`),
            fetch(`/api/activities-db?lat=${lat}&lon=${lon}&radiusKm=16`),
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
          }

          let dbItems: TrailItem[] = [];
          if (dbRes.status === "fulfilled" && dbRes.value.ok) {
            const json = await dbRes.value.json();
            dbItems = json.items ?? [];
          }

          setTrailItems([...osmItems, ...usfsItems, ...dbItems]);
        }
      } catch (e: any) {
        setTrailsError(e?.message ?? "Failed to load trails.");
        setTrailItems([]);
      } finally {
        setTrailsBusy(false);
      }
    }

    if (mode === "trails") {
        fetchTrails();
    }
  }, [canFetch, lat, lon, mode, activityTypeFilter]);

  async function loadLinesFor(
    refType: "relation" | "way" | "usfs",
    id: number | string,
    label: string
  ) {
    if (!canFetch) return;

    setSelectedTrailLabel(label);
    setSelectedTrailError(null);

    if (refType === "usfs") {
      // id is "usfs:TRAIL_NO" — strip the prefix to get the trail number
      const trailNo = String(id).replace(/^usfs:/, "");
      setSelectedTrailBusy(true);
      try {
        const res = await fetch(`/api/usfs-trail-line?trailNo=${encodeURIComponent(trailNo)}`);
        if (!res.ok) throw new Error(`USFS line request failed: ${res.status}`);
        const json = await res.json();
        setSelectedTrailLines(json.lines ?? []);
      } catch (e: any) {
        setSelectedTrailError(e?.message ?? "Failed to load USFS trail line.");
        setSelectedTrailLines([]);
      } finally {
        setSelectedTrailBusy(false);
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

  async function loadGpxTrack(trackId: string | number, label: string) {
    if (!canFetch) return;

    setSelectedTrailLabel(label);
    setSelectedTrailError(null);
    setSelectedTrailBusy(true);

    try {
      const res = await fetch(
        `/api/gpx-track?trackId=${trackId}`
      );
      if (!res.ok) throw new Error(`GPX track request failed: ${res.status}`);
      const json = await res.json();
      setSelectedTrailLines(json.lines ?? []);
    } catch (e: any) {
      setSelectedTrailError(e?.message ?? "Failed to load GPX trail.");
      setSelectedTrailLines([]);
    } finally {
      setSelectedTrailBusy(false);
    }
  }

  const formatBestHour = (iso?: string) => {
    if (!iso) return "Now";
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const day = isToday ? "Today" : d.toLocaleDateString(undefined, { weekday: 'short' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day} ${time}`;
  };

  const mapSubtitle =
    mode === "trails"
      ? `Showing ${activityTypeFilter} spots`
      : `Places: ${selectedPlaceType} (within ${radiusMiles} mi)`;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
          Outdoor activity suggester
        </h1>
        <a href="/sessions" style={{ fontSize: 13, color: "#3b82f6" }}>Sessions</a>
      </div>
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
            setMapCenter([la, lo]);
          }}
        />

        <LocationSearch
          onLocation={(la, lo, name) => {
            setLat(la);
            setLon(lo);
            setLocationLabel(name);
            setMapCenter([la, lo]);
          }}
        />

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#444" }}>Date</span>
          {next7Days.map((d) => {
            const isSelected = (selectedDate || todayStr) === d.value;
            return (
              <button
                key={d.value}
                onClick={() => setSelectedDate(d.value === todayStr ? "" : d.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: isSelected ? "#e0e7ff" : "white",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>

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

        {learningState && (
          <button
            onClick={() => setShowLearnedPrefs(v => !v)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              cursor: "pointer",
              background: showLearnedPrefs ? "#f0f9ff" : "white",
              fontSize: 13,
            }}
          >
            {showLearnedPrefs ? "Hide preferences" : "Learned preferences"}
            {learningState.observations.length > 0 && (
              <span style={{ marginLeft: 6, color: "#3b82f6", fontWeight: 700 }}>
                ({learningState.observations.length})
              </span>
            )}
          </button>
        )}
      </section>

      {canFetch ? (
        <section style={{ marginTop: 14 }}>
           <div style={{ marginBottom: 8 }}>
            <span style={{ marginRight: 8, fontSize: 13, color: "#444" }}>Filter by:</span>
            <button
                key="all"
                onClick={() => { setActivityTypeFilter("all"); setMode("trails"); setSelectedPlaceType("park"); }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: activityTypeFilter === "all" ? "#e0e7ff" : "white",
                  cursor: "pointer",
                  marginRight: 6,
                  fontSize: 13,
                }}
              >
                All
              </button>
            {ACTIVITY_CATALOG.map(activity => (
              <button
                key={activity.id}
                onClick={() => {
                  if (activity.id === 'surf') {
                    setMode('surf');
                    setActivityTypeFilter('surf');
                  } else if (activity.id === 'picnic') {
                    setMode('places');
                    setSelectedPlaceType('park');
                    setActivityTypeFilter('picnic');
                  } else {
                    setMode('trails');
                    setActivityTypeFilter(activity.id);
                  }
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: activityTypeFilter === activity.id ? "#e0e7ff" : "white",
                  cursor: "pointer",
                  marginRight: 6,
                  fontSize: 13,
                }}
              >
                {activity.name}
              </button>
            ))}
          </div>
          {activityTypeFilter !== "all" && (
            <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  if (!showBestTime) {
                    setShowBestTime(true);
                    fetchBestTime(activityTypeFilter);
                  } else {
                    setShowBestTime(false);
                  }
                }}
                disabled={bestTimeBusy}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid #a5b4fc",
                  background: showBestTime ? "#e0e7ff" : "white",
                  cursor: bestTimeBusy ? "wait" : "pointer",
                  fontSize: 13,
                  color: "#4338ca",
                }}
              >
                {bestTimeBusy ? "Loading…" : showBestTime ? "Hide weekly plan" : "Best time this week →"}
              </button>
              {bestTimeError && (
                <span style={{ fontSize: 12, color: "#dc2626" }}>{bestTimeError}</span>
              )}
            </div>
          )}
          <div style={{ marginBottom: 8, color: "#444", fontSize: 13 }}>
            {mapSubtitle}
          </div>

          <MapViewDynamic
            lat={mapCenter?.[0] ?? lat!}
            lon={mapCenter?.[1] ?? lon!}
            label={locationLabel}
            places={mode === "places" ? places : []}
            trailItems={mode === "trails" ? trailItems : []}
            trailLines={mode === "trails" ? selectedTrailLines : []}
            surfSpots={mode === "surf" ? surfSpots : []}
	    onLoadTrailLine={loadLinesFor}
	    onLoadGpxTrack={loadGpxTrack}
	    onViewForecast={(name, transectId, la, lo) => {
            const spot = surfSpots.find(s => s.cdip_transect_id === transectId && s.lat === la);
            setForecastSpot(spot ?? { name, cdip_transect_id: transectId, lat: la, lon: lo });
        }}
            onLogSession={(spotId, spotName, sLat, sLon) => setLogTarget({ activityType: "surf", spotId, spotName, lat: sLat, lon: sLon })}
          />

        </section>
      ) : null}

      {data ? (
        <>
          <div style={{ marginTop: 18, color: "#444", fontSize: 13 }}>
            Generated: {new Date(data.generatedAtISO).toLocaleString()} · (
            {data.lat.toFixed(4)}, {data.lon.toFixed(4)})
          </div>

          <section style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
              Top Activities
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
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                      Activity
                    </th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                      Time
                    </th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                      Score
                    </th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                      Reasoning
                    </th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: 120 }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mode === "surf"
                    ? surfSpots.slice(0, 10).map((s: any) => (
                        <tr key={s.id ?? s.name}>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                            <button
                              onClick={() => setMapCenter([s.lat, s.lon])}
                              style={{ background: 'none', border: 'none', padding: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}
                            >
                              {s.name}
                            </button>
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{formatBestHour(s.bestHourISO)}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{s.score ?? "—"}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontSize: 12, color: "#555" }}>
                            {(s.reasons ?? []).slice(0, 3).join(", ")}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {learningState && (
                                <button
                                  onClick={() => setLogTarget({ activityType: "surf", spotId: s.id, spotName: s.name, lat: s.lat, lon: s.lon })}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
                                >
                                  Log
                                </button>
                              )}
                              {s.cdip_transect_id && (
                                <button
                                  onClick={() => setForecastSpot(s)}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
                                >
                                  Forecast
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    : data.activities.slice(0, 10).map((a: any) => (
                        <tr key={a.name}>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                            <button
                              onClick={() => setMapCenter([a.lat, a.lon])}
                              style={{ background: 'none', border: 'none', padding: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}
                            >
                              {a.name}
                            </button>
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                            {formatBestHour(a.bestHourISO)}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>{a.score}</td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontSize: 12, color: "#555" }}>
                            {a.why.join(", ")}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {learningState && (a.lat != null && a.lon != null) && (
                                <button
                                  onClick={() => setLogTarget({ activityType: a.id, spotName: a.name, lat: a.lat, lon: a.lon })}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer", background: "white" }}
                                >
                                  Log
                                </button>
                              )}
                            </div>
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

      {showBestTime && bestTimeData && (
        <BestTimePanel data={bestTimeData} onClose={() => setShowBestTime(false)} />
      )}

      {forecastSpot && (
        <SwellForecastModal
          name={forecastSpot.name}
          transectId={forecastSpot.cdip_transect_id}
          lat={forecastSpot.lat}
          lon={forecastSpot.lon}
          wind_offshore_min_deg={forecastSpot.wind_offshore_min_deg}
          wind_offshore_max_deg={forecastSpot.wind_offshore_max_deg}
          swell_min_deg={forecastSpot.swell_min_deg}
          swell_max_deg={forecastSpot.swell_max_deg}
          tide_preference={forecastSpot.tide_preference}
          onClose={() => setForecastSpot(null)}
        />
      )}

      {logTarget && learningState && (
        <LogSessionModal
          {...logTarget}
          onClose={() => setLogTarget(null)}
          onSuccess={({ conditions, model_score, rating }) => {
            const updated = addObservation(
              learningState,
              logTarget.activityType as ActivityId,
              conditions,
              rating,
              { name: logTarget.spotName, lat: logTarget.lat, lon: logTarget.lon }
            );
            saveState(updated);
            setLearningState(updated);
            setLogTarget(null);
          }}
        />
      )}

      {showLearnedPrefs && learningState && (
        <LearnedPrefsPanel
          betaParams={learningState.betaParams}
          onExport={() => {
            const json = JSON.stringify(learningState, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "outdoor-learning.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          onReset={() => {
            const { defaultState } = require("@/lib/learning/store");
            const s = defaultState();
            saveState(s);
            setLearningState(s);
          }}
        />
      )}

    </main>
  );
}
