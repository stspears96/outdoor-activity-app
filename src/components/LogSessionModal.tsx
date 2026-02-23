"use client";

import { useState } from "react";
import type { Conditions } from "@/lib/types";

type Props = {
  activityType: string;
  spotId?: string | null;
  spotName: string;
  lat: number;
  lon: number;
  onClose: () => void;
  onSuccess: (result: { conditions: Conditions; model_score: number | null; rating: number }) => void;
};

type Status = "idle" | "loading" | "success" | "error";

function toLocalDateTimeValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LogSessionModal({ activityType, spotId, spotName, lat, lon, onClose, onSuccess }: Props) {
  const [sessionTime, setSessionTime] = useState(() => toLocalDateTimeValue(Date.now()));
  const [rating, setRating] = useState(70);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [modelScore, setModelScore] = useState<number | null>(null);

  async function handleSubmit() {
    setStatus("loading");
    setErrorMsg("");

    const sessionTimeISO = new Date(sessionTime).toISOString();

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_type: activityType,
          spot_id: spotId ?? null,
          spot_name: spotName,
          spot_lat: lat,
          spot_lon: lon,
          session_time: sessionTimeISO,
          rating,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(json.error ?? "Failed to save session.");
        return;
      }

      setModelScore(json.model_score ?? null);
      setStatus("success");
      onSuccess({ conditions: json.conditions, model_score: json.model_score ?? null, rating });
      setTimeout(() => onClose(), 1500);
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message ?? "Network error.");
    }
  }

  const busy = status === "loading" || status === "success";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "white",
        borderRadius: 16,
        padding: 28,
        width: 360,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      }}>
        <h2 style={{ margin: "0 0 18px", fontSize: 18, fontWeight: 800 }}>
          Log a Session: {spotName}
        </h2>

        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 4 }}>Date/time</div>
          <input
            type="datetime-local"
            value={sessionTime}
            onChange={e => setSessionTime(e.target.value)}
            disabled={busy}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </label>

        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#444", marginBottom: 4 }}>
            <span>Rating</span>
            <span style={{ fontWeight: 700 }}>{rating}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={rating}
            onChange={e => setRating(Number(e.target.value))}
            disabled={busy}
            style={{ width: "100%", accentColor: "#3b82f6" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa" }}>
            <span>terrible (0)</span>
            <span>amazing (100)</span>
          </div>
        </div>

        {status === "success" && (
          <div style={{ marginBottom: 14, padding: "8px 12px", background: "#f0fdf4", borderRadius: 8, color: "#166534", fontSize: 13 }}>
            Session logged{modelScore != null ? ` · model predicted: ${modelScore}` : ""}
          </div>
        )}

        {status === "error" && (
          <div style={{ marginBottom: 14, padding: "8px 12px", background: "#fef2f2", borderRadius: 8, color: "#991b1b", fontSize: 13 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={status === "loading"}
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: "1px solid #ddd",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              background: "white",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              background: busy ? "#93c5fd" : "#3b82f6",
              color: "white",
            }}
          >
            {status === "loading" ? "Saving…" : "Save Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
