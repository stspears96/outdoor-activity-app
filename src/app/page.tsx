"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RecommendationsResponse,
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
import { LearnedPrefsPanel } from "@/components/LearnedPrefsPanel";
import type { LearningState } from "@/lib/learning/types";
import type { Conditions } from "@/lib/types";
import { loadState, saveState, addObservation } from "@/lib/learning/store";
import { circularCenter, angularDist } from "@/lib/learning/buckets";

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
  const [forecastSpot, setForecastSpot] = useState<any | null>(null);

  // ---- Learning / rating ----
  const [learningState, setLearningState] = useState<LearningState | null>(null);
  const [showLearnedPrefs, setShowLearnedPrefs] = useState(false);
  const [rateTarget, setRateTarget] = useState<{
    activityId: ActivityId;
    name: string;
    lat: number;
    lon: number;
  } | null>(null);
  const [rateConditions, setRateConditions] = useState<Conditions | null>(null);
  const [rateConditionsBusy, setRateConditionsBusy] = useState(false);
  const [rateValue, setRateValue] = useState(70);

  // Load learning state once on mount
  useEffect(() => { setLearningState(loadState()); }, []);

  const canFetch = useMemo(
    () => typeof lat === "number" && typeof lon === "number",
    [lat, lon]
  );

  const fetchRecs = useCallback(async () => {
    if (!canFetch) return;
    setBusy(true);
    setError(null);
    setData(null);
    try {
      let url = `/api/individual-recommendations?lat=${lat}&lon=${lon}&windowHours=${windowHours}`;
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
  }, [canFetch, lat, lon, windowHours, activityTypeFilter]);

  // Fetch recommendations when we first get a location and when windowHours or activityTypeFilter changes
  useEffect(() => {
    if (canFetch) fetchRecs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, windowHours, activityTypeFilter]);

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
      setUsfsLines(new Map());

      try {
        if (activityTypeFilter !== "all") {
          const dbRes = await fetch(`/api/activities-db?lat=${lat}&lon=${lon}&activityType=${activityTypeFilter}&radiusKm=16`);
          if (!dbRes.ok) throw new Error(`${activityTypeFilter} spots request failed: ${dbRes.status}`);
          const json = await dbRes.json();
          setTrailItems(json.items ?? []);
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
            const lineMap = new Map<string, TrailLine>();
            for (const ln of (json.lines ?? []) as TrailLine[]) {
              lineMap.set(ln.id, ln);
            }
            setUsfsLines(lineMap);
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

  async function loadGpxTrack(trackId: number, label: string) {
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

  // Use pre-computed conditions from activity if available, otherwise fetch
  async function handleRateClick(activity: any) {
    setRateTarget({ activityId: activity.id, name: activity.name, lat: activity.lat, lon: activity.lon });
    setRateValue(70);
    
    if (activity.bestHourConditions) {
        setRateConditions(activity.bestHourConditions);
        setRateConditionsBusy(false);
    } else {
        setRateConditions(null);
        setRateConditionsBusy(true);
        try {
          const res = await fetch(`/api/conditions?lat=${activity.lat}&lon=${activity.lon}&windowHours=${windowHours}`);
          if (res.ok) {
            const json = await res.json();
            setRateConditions(json.conditions ?? null);
          }
        } catch { /* leave rateConditions null */ } finally {
          setRateConditionsBusy(false);
        }
    }
  }

  // Surf-specific: augments base conditions with swell + offshore angle from the spot
  async function handleSurfRateClick(spot: any) {
    setRateTarget({ activityId: "surf", name: spot.name, lat: spot.lat, lon: spot.lon });
    setRateConditions(null);
    setRateConditionsBusy(true);
    setRateValue(70);
    try {
      const res = await fetch(`/api/conditions?lat=${spot.lat}&lon=${spot.lon}&windowHours=${windowHours}`);
      if (res.ok) {
        const json = await res.json();
        const baseCond: Conditions | null = json.conditions ?? null;
        if (baseCond) {
          const sc = spot.conditions ?? {};
          // Compute wind-vs-offshore angle using the spot's window geometry
          let windOffshoreAngleDeg: number | undefined;
          if (
            typeof sc.windDirDeg === "number" &&
            spot.wind_offshore_min_deg != null &&
            spot.wind_offshore_max_deg != null
          ) {
            const center = circularCenter(spot.wind_offshore_min_deg, spot.wind_offshore_max_deg);
            windOffshoreAngleDeg = angularDist(sc.windDirDeg, center);
          }
          setRateConditions({
            ...baseCond,
            swellHeightM: sc.swellHeightM ?? undefined,
            swellPeakPeriodS: sc.swellPeakPeriodS ?? undefined,
            swellAvgPeriodS: sc.swellAvgPeriodS ?? undefined,
            swellPeriodDiffS: sc.swellPeriodDiffS ?? undefined,
            windOffshoreAngleDeg,
            tideHeightFt: sc.tideHeightFt ?? undefined,
            tideState: sc.tideState ?? undefined,
          });
        }
      }
    } catch { /* leave null */ } finally {
      setRateConditionsBusy(false);
    }
  }

  function submitRating() {
    if (!rateTarget || !rateConditions || !learningState) return;
    const updated = addObservation(learningState, rateTarget.activityId, rateConditions, rateValue, { name: rateTarget.name, lat: rateTarget.lat, lon: rateTarget.lon });
    saveState(updated);
    setLearningState(updated);
    setRateTarget(null);
    setRateConditions(null);
  }

  function cancelRating() {
    setRateTarget(null);
    setRateConditions(null);
  }

  function conditionsSummary(c: Conditions): string {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const sector = Math.round(((c.windDirDeg % 360) + 360) % 360 / 45) % 8;
    const parts = [
      `${Math.round(c.tempF)}°F`,
      `${Math.round(c.windMph)} mph ${dirs[sector]}`,
      `${Math.round(c.precipProb)}% rain`,
    ];
    if (c.aqi !== null) parts.push(`AQI ${Math.round(c.aqi)}`);
    if (c.swellHeightM != null) parts.push(`${c.swellHeightM.toFixed(1)}m swell`);
    if (c.swellPeakPeriodS != null) parts.push(`${Math.round(c.swellPeakPeriodS)}s peak`);
    if (c.tideHeightFt != null) parts.push(`Tide ${c.tideHeightFt.toFixed(1)}ft${c.tideState ? ` (${c.tideState})` : ''}`);
    if (c.windOffshoreAngleDeg != null) parts.push(`${Math.round(c.windOffshoreAngleDeg)}° from offshore`);
    if (c.timeISO) {
        const time = new Date(c.timeISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        parts.push(`at ${time}`);
    }
    return parts.join(" · ");
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
                onClick={() => { setActivityTypeFilter("all"); setMode("trails"); }}
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
                    ? surfSpots.slice(0, 10).flatMap((s: any) => {
                        const isRating = rateTarget?.name === s.name && rateTarget?.lat === s.lat;
                        return [
                          <tr key={s.id ?? s.name}>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>
                                <button
                                    onClick={() => setMapCenter([s.lat, s.lon])}
                                    style={{ background: 'none', border: 'none', padding: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}
                                >
                                    {s.name}
                                </button>
                            </td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>Now</td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>{s.score ?? "—"}</td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2", fontSize: 12, color: "#555" }}>
                              {(s.reasons ?? []).slice(0, 3).join(", ")}
                            </td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {learningState && (
                                        <button
                                        onClick={() => isRating ? cancelRating() : handleSurfRateClick(s)}
                                        style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer", background: isRating ? "#fee2e2" : "white" }}
                                        >
                                        {isRating ? "Cancel" : "Rate"}
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
                          </tr>,
                          ...(isRating ? [
                            <tr key={`${s.name}-rating`}>
                              <td colSpan={5} style={{ padding: "10px 14px", borderBottom: "1px solid #f2f2f2", background: "#f8faff" }}>
                                <RatingRow
                                  name={s.name}
                                  busy={rateConditionsBusy}
                                  conditions={rateConditions}
                                  value={rateValue}
                                  onValueChange={setRateValue}
                                  onSubmit={submitRating}
                                  onCancel={cancelRating}
                                  conditionsSummary={conditionsSummary}
                                />
                              </td>
                            </tr>
                          ] : []),
                        ];
                      })
                    : data.activities.slice(0, 10).flatMap((a: any) => {
                        const isRating = rateTarget?.name === a.name && rateTarget?.lat === a.lat;
                        return [
                          <tr key={a.name}>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>
                                <button
                                    onClick={() => setMapCenter([a.lat, a.lon])}
                                    style={{ background: 'none', border: 'none', padding: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', textAlign: 'left', fontWeight: 600 }}
                                >
                                    {a.name}
                                </button>
                            </td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>
                                {formatBestHour(a.bestHourISO)}
                            </td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>{a.score}</td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2", fontSize: 12, color: "#555" }}>
                              {a.why.join(", ")}
                            </td>
                            <td style={{ padding: 10, borderBottom: isRating ? "none" : "1px solid #f2f2f2" }}>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {learningState && (a.lat != null && a.lon != null) && (
                                        <button
                                            onClick={() => isRating ? cancelRating() : handleRateClick(a)}
                                            style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", cursor: "pointer", background: isRating ? "#fee2e2" : "white" }}
                                        >
                                            {isRating ? "Cancel" : "Rate"}
                                        </button>
                                    )}
                                </div>
                            </td>
                          </tr>,
                          ...(isRating ? [
                            <tr key={`${a.name}-rating`}>
                              <td colSpan={5} style={{ padding: "10px 14px", borderBottom: "1px solid #f2f2f2", background: "#f8faff" }}>
                                <RatingRow
                                  name={a.name}
                                  busy={rateConditionsBusy}
                                  conditions={rateConditions}
                                  value={rateValue}
                                  onValueChange={setRateValue}
                                  onSubmit={submitRating}
                                  onCancel={cancelRating}
                                  conditionsSummary={conditionsSummary}
                                />
                              </td>
                            </tr>
                          ] : []),
                        ];
                      })}
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

// ─── Inline rating row ─────────────────────────────────────────────────────────

function RatingRow({
  name,
  busy,
  conditions,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  conditionsSummary,
}: {
  name: string;
  busy: boolean;
  conditions: import("@/lib/types").Conditions | null;
  value: number;
  onValueChange: (v: number) => void;
  onSubmit: () => void;
  onCancel: () => void;
  conditionsSummary: (c: import("@/lib/types").Conditions) => string;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
        {busy
          ? `Fetching conditions at ${name} location…`
          : conditions
          ? `Conditions at site: ${conditionsSummary(conditions)}`
          : "Could not fetch site conditions"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          disabled={busy || !conditions}
          onChange={e => onValueChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: "#3b82f6" }}
        />
        <span style={{ fontWeight: 700, width: 28, textAlign: "right" }}>{value}</span>
        <button
          onClick={onSubmit}
          disabled={busy || !conditions}
          style={{
            padding: "5px 12px",
            borderRadius: 7,
            border: "none",
            background: busy || !conditions ? "#cbd5e1" : "#3b82f6",
            color: "white",
            fontWeight: 600,
            fontSize: 13,
            cursor: busy || !conditions ? "not-allowed" : "pointer",
          }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #ddd", background: "white", fontSize: 13, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginTop: 2 }}>
        <span>Terrible (0)</span>
        <span>Amazing (100)</span>
      </div>
    </div>
  );
}
