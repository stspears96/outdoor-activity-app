"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import AdminPickerMapDynamic from "@/components/AdminPickerMapDynamic";

type UserActivity = {
  id: number;
  title: string;
  latitude: number;
  longitude: number;
  activities: string;
  gpx_track_id: number;
};

const ACTIVITY_OPTIONS = [
  { value: "hike", label: "Hike" },
  { value: "run", label: "Run" },
  { value: "bike", label: "Cycling" },
  { value: "mtb", label: "Mountain Bike" },
  { value: "picnic", label: "Picnic" },
];

export default function AdminPage() {
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("hike");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const gpxRef = useRef<HTMLInputElement>(null);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/user-activities");
      const data = await res.json();
      setActivities(data.items ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handlePick = useCallback((pickedLat: number, pickedLon: number) => {
    setLat(pickedLat);
    setLon(pickedLon);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!title.trim()) {
      setError("Activity name is required.");
      return;
    }
    if (lat === null || lon === null) {
      setError("Click the map to set coordinates.");
      return;
    }

    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("activityType", activityType);
    fd.append("lat", String(lat));
    fd.append("lon", String(lon));

    const gpxFile = gpxRef.current?.files?.[0];
    if (gpxFile) {
      fd.append("gpx", gpxFile);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/user-activities", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save activity.");
      } else {
        setSuccess(`Activity saved (id=${data.id}).`);
        setTitle("");
        setLat(null);
        setLon(null);
        if (gpxRef.current) gpxRef.current.value = "";
        await fetchActivities();
      }
    } catch {
      setError("Network error — could not save activity.");
    } finally {
      setSubmitting(false);
    }
  }

  function parseActivities(raw: string): string {
    try {
      const arr = JSON.parse(raw) as string[];
      return arr.join(", ");
    } catch {
      return raw;
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      <style>{`
        .admin-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          align-items: start;
        }
        @media (max-width: 700px) {
          .admin-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <h1 style={{ marginTop: 0, marginBottom: 24, fontSize: 22 }}>Add custom activity</h1>

      <div className="admin-grid">
        {/* Map column */}
        <div>
          <p style={{ margin: "0 0 8px", color: "#555", fontSize: 14 }}>
            Click on the map to set the activity location.
          </p>
          <AdminPickerMapDynamic lat={lat} lon={lon} onPick={handlePick} height={420} />
        </div>

        {/* Form column */}
        <div>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Activity name
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Marin Headlands loop"
                style={{ width: "100%", padding: "8px 10px", fontSize: 15, boxSizing: "border-box", border: "1px solid #ccc", borderRadius: 6 }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Activity type
              </label>
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", fontSize: 15, border: "1px solid #ccc", borderRadius: 6 }}
              >
                {ACTIVITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Coordinates
              </label>
              <div style={{ fontFamily: "monospace", fontSize: 14, padding: "8px 10px", background: "#f5f5f5", borderRadius: 6, border: "1px solid #ddd", color: lat !== null ? "#111" : "#999" }}>
                {lat !== null && lon !== null
                  ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
                  : "Click the map to pick a location"}
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                GPX track <span style={{ fontWeight: 400, color: "#888" }}>(optional)</span>
              </label>
              <input
                type="file"
                accept=".gpx"
                ref={gpxRef}
                style={{ fontSize: 14 }}
              />
            </div>

            {error && (
              <div style={{ background: "#fff0f0", border: "1px solid #f99", color: "#c00", borderRadius: 6, padding: "10px 14px", fontSize: 14 }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ background: "#f0fff4", border: "1px solid #9c9", color: "#060", borderRadius: 6, padding: "10px 14px", fontSize: 14 }}>
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{ padding: "10px 20px", fontSize: 15, fontWeight: 600, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Saving…" : "Save activity"}
            </button>
          </form>
        </div>
      </div>

      {/* Saved activities list */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your custom activities</h2>
        {activities.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>No custom activities yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", border: "1px solid #ddd" }}>ID</th>
                <th style={{ textAlign: "left", padding: "8px 12px", border: "1px solid #ddd" }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 12px", border: "1px solid #ddd" }}>Type</th>
                <th style={{ textAlign: "left", padding: "8px 12px", border: "1px solid #ddd" }}>Lat, Lon</th>
                <th style={{ textAlign: "left", padding: "8px 12px", border: "1px solid #ddd" }}>GPX</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  <td style={{ padding: "8px 12px", border: "1px solid #ddd", color: "#666" }}>{a.id}</td>
                  <td style={{ padding: "8px 12px", border: "1px solid #ddd" }}>{a.title}</td>
                  <td style={{ padding: "8px 12px", border: "1px solid #ddd" }}>{parseActivities(a.activities)}</td>
                  <td style={{ padding: "8px 12px", border: "1px solid #ddd", fontFamily: "monospace", fontSize: 12 }}>
                    {a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}
                  </td>
                  <td style={{ padding: "8px 12px", border: "1px solid #ddd" }}>
                    {a.gpx_track_id ? "✓" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
