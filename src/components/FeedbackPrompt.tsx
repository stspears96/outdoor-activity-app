"use client";

import { useState } from "react";
import type { ActivityId } from "@/lib/types";
import type { PendingSession } from "@/lib/learning/types";
import { getWindDirBucket } from "@/lib/learning/buckets";

const ACTIVITY_NAMES: Record<ActivityId, string> = {
  walk: "Walk",
  run: "Run",
  hike: "Hike",
  bike: "Bike",
  mtb: "Mountain Bike",
  picnic: "Picnic",
  cafe: "Outdoor café",
  surf: "Surf",
};

function formatConditionsSummary(cond: PendingSession["conditions"]): string {
  const windDir = getWindDirBucket(cond.windDirDeg);
  const parts = [
    `${Math.round(cond.tempF)}°F`,
    `${Math.round(cond.windMph)} mph ${windDir}`,
    `${Math.round(cond.precipProb)}% rain`,
    `${Math.round(cond.cloudCover)}% cloud`,
  ];
  if (cond.aqi !== null) parts.push(`AQI ${Math.round(cond.aqi)}`);
  return parts.join(" · ");
}

type RatedActivity = { activityId: ActivityId; rating: number };

type Props = {
  pendingSession: PendingSession;
  onSubmit: (ratings: RatedActivity[]) => void;
  onSkip: () => void;
};

export function FeedbackPrompt({ pendingSession, onSubmit, onSkip }: Props) {
  const top3 = pendingSession.top3Activities;

  const [ratings, setRatings] = useState<Record<string, number>>(
    Object.fromEntries(top3.map(id => [id, 70]))
  );
  const [skipped, setSkipped] = useState<Record<string, boolean>>(
    Object.fromEntries(top3.map(id => [id, false]))
  );

  function handleSubmit() {
    const rated = top3
      .filter(id => !skipped[id])
      .map(id => ({ activityId: id, rating: ratings[id] }));
    onSubmit(rated);
  }

  const summary = formatConditionsSummary(pendingSession.conditions);
  const sessionDate = new Date(pendingSession.timestamp).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 18,
          padding: 28,
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 0, marginBottom: 6 }}>
          How did it go?
        </h2>
        <p style={{ margin: "0 0 4px", color: "#555", fontSize: 13 }}>
          {sessionDate}
        </p>
        <p style={{ margin: "0 0 20px", color: "#444", fontSize: 13, fontStyle: "italic" }}>
          {summary}
        </p>

        {top3.map(id => (
          <div key={id} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
                {ACTIVITY_NAMES[id] ?? id}
              </span>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  color: "#888",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={skipped[id] ?? false}
                  onChange={e =>
                    setSkipped(s => ({ ...s, [id]: e.target.checked }))
                  }
                />
                Skip
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={0}
                max={100}
                value={ratings[id] ?? 70}
                disabled={skipped[id]}
                onChange={e =>
                  setRatings(r => ({ ...r, [id]: Number(e.target.value) }))
                }
                style={{
                  flex: 1,
                  accentColor: skipped[id] ? "#ccc" : "#3b82f6",
                  cursor: skipped[id] ? "not-allowed" : "pointer",
                }}
              />
              <span
                style={{
                  width: 32,
                  textAlign: "right",
                  fontWeight: 700,
                  fontSize: 15,
                  color: skipped[id] ? "#ccc" : "#222",
                }}
              >
                {skipped[id] ? "—" : ratings[id]}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#aaa",
                marginTop: 2,
              }}
            >
              <span>Terrible</span>
              <span>Amazing</span>
            </div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={handleSubmit}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 10,
              border: "none",
              background: "#3b82f6",
              color: "white",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Save ratings
          </button>
          <button
            onClick={onSkip}
            style={{
              padding: "11px 16px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              color: "#555",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Skip all
          </button>
        </div>
      </div>
    </div>
  );
}
