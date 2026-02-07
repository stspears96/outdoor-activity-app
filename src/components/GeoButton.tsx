"use client";

import { useState } from "react";

export function GeoButton(props: { onLocation: (lat: number, lon: number) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function getLocation() {
    setError(null);
    setBusy(true);

    if (!("geolocation" in navigator)) {
      setError("Geolocation is not available in this browser.");
      setBusy(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        props.onLocation(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setBusy(false);
        setError(err.message || "Failed to get location.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button
        onClick={getLocation}
        disabled={busy}
        style={{
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #ddd",
          cursor: busy ? "not-allowed" : "pointer",
          background: "white",
        }}
      >
        {busy ? "Locating…" : "Use my location"}
      </button>
      {error ? <span style={{ color: "crimson" }}>{error}</span> : null}
    </div>
  );
}

