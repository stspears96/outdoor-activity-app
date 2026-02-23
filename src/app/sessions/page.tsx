"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Session = {
  id: number;
  activity_type: string;
  spot_id: string | null;
  spot_name: string;
  spot_lat: number;
  spot_lon: number;
  session_time: string;
  logged_at: string;
  rating: number;
  conditions_json: string;
  model_score: number | null;
  model_version: string;
};

function conditionsSummary(jsonStr: string): string {
  try {
    const c = JSON.parse(jsonStr);
    const parts: string[] = [];
    if (c.weather?.windSpeedMs != null) {
      parts.push(`Wind ${c.weather.windSpeedMs.toFixed(1)} m/s @ ${Math.round(c.weather.windDirDeg ?? 0)}°`);
    }
    if (c.cdip?.waveHs != null) {
      parts.push(`Swell ${c.cdip.waveHs.toFixed(1)}m @ ${c.cdip.waveTp?.toFixed(0) ?? "?"}s`);
    } else if (c.marine?.waveHeightM != null) {
      parts.push(`Waves ${c.marine.waveHeightM.toFixed(1)}m @ ${c.marine.wavePeriodS?.toFixed(0) ?? "?"}s`);
    }
    if (c.tide?.heightFt != null) {
      parts.push(`Tide ${c.tide.heightFt.toFixed(1)}ft (${c.tide.state})`);
    }
    if (c.weather?.tempC != null) {
      const tempF = Math.round(c.weather.tempC * 9 / 5 + 32);
      parts.push(`${tempF}°F`);
    }
    return parts.join(" · ") || "—";
  } catch {
    return "—";
  }
}

function ratingColor(r: number): string {
  if (r >= 75) return "#059669";
  if (r >= 50) return "#f59e0b";
  return "#ef4444";
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then(r => r.json())
      .then(j => { setSessions(j.sessions ?? []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Activity Sessions</h1>
        <Link href="/" style={{ fontSize: 13, color: "#3b82f6" }}>← Back to map</Link>
      </div>

      {loading && <div style={{ color: "#444" }}>Loading sessions…</div>}
      {error && <div style={{ color: "#ef4444" }}>Error: {error}</div>}

      {!loading && !error && sessions.length === 0 && (
        <div style={{ color: "#666", padding: "20px 0" }}>
          No sessions logged yet. Click &ldquo;Log&rdquo; on any activity or surf spot to record a session.
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #e5e5e5", borderRadius: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Activity</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Name</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Date</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>Rating</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>Predicted</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Conditions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => {
                const color = ratingColor(s.rating);
                return (
                  <tr key={s.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontSize: 13, color: "#555", textTransform: "capitalize" }}>
                      {s.activity_type}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontWeight: 600, fontSize: 14 }}>
                      {s.spot_name}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontSize: 13 }}>
                      {new Date(s.session_time).toLocaleString()}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", textAlign: "center" }}>
                      <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <span style={{ fontWeight: 700, color }}>{s.rating}</span>
                        <div style={{ width: 48, height: 4, background: "#e5e5e5", borderRadius: 2 }}>
                          <div style={{ width: `${s.rating}%`, height: "100%", background: color, borderRadius: 2 }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", textAlign: "center", color: "#666", fontSize: 13 }}>
                      {s.model_score ?? "—"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontSize: 12, color: "#555" }}>
                      {conditionsSummary(s.conditions_json)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
