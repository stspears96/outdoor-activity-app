"use client";

import { useEffect, useRef, useState } from "react";

type GeocodeResult = {
  lat: number;
  lon: number;
  displayName: string;
};

export function LocationSearch(props: {
  onLocation: (lat: number, lon: number, displayName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [noResults, setNoResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function select(r: GeocodeResult) {
    props.onLocation(r.lat, r.lon, r.displayName);
    setQuery("");
    setResults(null);
    setNoResults(false);
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setResults(null);
    setNoResults(false);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("Geocode request failed");
      const json = await res.json();
      const hits: GeocodeResult[] = json.results ?? [];
      if (hits.length === 0) {
        setNoResults(true);
      } else if (hits.length === 1) {
        select(hits[0]);
      } else {
        setResults(hits);
      }
    } catch {
      setNoResults(true);
    } finally {
      setBusy(false);
    }
  }

  // Close dropdown on Escape or click outside
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setResults(null);
        setNoResults(false);
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setResults(null);
        setNoResults(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "white",
    fontSize: 14,
    width: 200,
    outline: "none",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    cursor: busy ? "not-allowed" : "pointer",
    background: "white",
    whiteSpace: "nowrap",
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", gap: 6 }}>
      <input
        type="text"
        placeholder="Search a location…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") search(); }}
        style={inputStyle}
        aria-label="Location search"
      />
      <button onClick={search} disabled={busy} style={buttonStyle}>
        {busy ? "Searching…" : "Search"}
      </button>

      {/* Dropdown */}
      {(results || noResults) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 10,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          {noResults ? (
            <div style={{ padding: "10px 12px", color: "#666", fontSize: 13 }}>
              No results found
            </div>
          ) : (
            results!.map((r, i) => (
              <button
                key={i}
                onClick={() => select(r)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "white",
                  cursor: "pointer",
                  fontSize: 13,
                  borderTop: i > 0 ? "1px solid #f0f0f0" : "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
              >
                {r.displayName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
