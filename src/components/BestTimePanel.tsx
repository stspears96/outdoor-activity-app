"use client";

import type { BestTimeResponse } from "@/lib/types";

interface Props {
  data: BestTimeResponse;
  onClose: () => void;
}

function formatDay(dateStr: string, bestHourISO?: string): string {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (dateStr === todayStr) return "Today";
  const d = bestHourISO ? new Date(bestHourISO) : new Date(`${dateStr}T12:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function scoreColor(score: number): string {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#ca8a04";
  return "#dc2626";
}

export function BestTimePanel({ data, onClose }: Props) {
  return (
    <section
      style={{
        marginTop: 24,
        border: "1px solid #e5e5e5",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "#fafafa",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #e5e5e5",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
          Best times to {data.activityName.toLowerCase()} this week
        </h2>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: "#888",
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>Day</th>
            <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>Best time</th>
            <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>Score</th>
            <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", fontWeight: 600, fontSize: 13 }}>Conditions</th>
          </tr>
        </thead>
        <tbody>
          {data.days.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 14, color: "#888", fontStyle: "italic", textAlign: "center" }}>
                No forecast data available for this location.
              </td>
            </tr>
          )}
          {data.days.map((day, i) => (
            <tr
              key={day.dateStr}
              style={{ background: i === 0 ? "#f0fdf4" : "white" }}
            >
              <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontWeight: i === 0 ? 700 : 400 }}>
                {i === 0 && (
                  <span style={{ color: "#16a34a", marginRight: 5, fontSize: 12 }}>★</span>
                )}
                {formatDay(day.dateStr, day.bestHourISO)}
              </td>
              <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2" }}>
                {formatTime(day.bestHourISO)}
              </td>
              <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontWeight: 700, color: scoreColor(day.score) }}>
                {day.score}
              </td>
              <td style={{ padding: 10, borderBottom: "1px solid #f2f2f2", fontSize: 12, color: "#555" }}>
                {day.why.join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.days.length > 0 && data.days.length < 7 && (
        <p style={{ margin: 0, padding: "8px 14px", fontSize: 12, color: "#888", borderTop: "1px solid #f2f2f2", background: "#fafafa" }}>
          Extended forecast unavailable — showing {data.days.length} of 7 days.
        </p>
      )}
    </section>
  );
}
