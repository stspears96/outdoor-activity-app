"use client";

import { useEffect, useRef, useState } from "react";
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type CdipPoint = {
  time: string;
  waveHs: number | null;
  waveTp: number | null;
  waveDp: number | null;
  waveDm: number | null;
};

type ChartRow = {
  time: number; // epoch ms
  label: string; // formatted time
  hs: number | null; // swell height (ft)
  tp: number | null; // peak period (s)
  dp: number | null; // peak direction (deg)
};

function formatTime(epoch: number): string {
  const d = new Date(epoch);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const hour = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} ${hour}`;
}

/** Small arrow glyph rotated to indicate swell direction */
function DirectionTick(props: {
  x?: number;
  y?: number;
  payload?: { value: number };
  data: ChartRow[];
}) {
  const { x, y, payload, data } = props;
  if (x == null || y == null || !payload) return null;

  const row = data.find((r) => r.time === payload.value);
  if (!row || row.dp == null) return null;

  // CSS rotation: 0deg = up/north, clockwise
  const rotation = row.dp;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: 12,
          fill: "#06c",
          transformOrigin: "center",
          transform: `rotate(${rotation}deg)`,
        }}
      >
        ↓
      </text>
    </g>
  );
}

export default function SwellForecastModal(props: {
  name: string;
  transectId: string;
  onClose: () => void;
}) {
  const { name, transectId, onClose } = props;
  const [data, setData] = useState<ChartRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/cdip/alongshore?transect=${encodeURIComponent(transectId)}&hours=72`
        );
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = await res.json();
        const points: CdipPoint[] = json.points ?? [];

        if (cancelled) return;

        const rows: ChartRow[] = points
          .map((p) => {
            const t = Date.parse(p.time);
            if (!Number.isFinite(t)) return null;
            return {
              time: t,
              label: formatTime(t),
              hs: p.waveHs != null ? p.waveHs * 3.281 : null,
              tp: p.waveTp,
              dp: p.waveDp,
            };
          })
          .filter((r): r is ChartRow => r !== null)
          .sort((a, b) => a.time - b.time);

        // Trim to most recent 72 hours
        if (rows.length > 0) {
          const newest = rows[rows.length - 1].time;
          const cutoff = newest - 72 * 3600 * 1000;
          const trimmed = rows.filter((r) => r.time >= cutoff);
          setData(trimmed);
        } else {
          setData([]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load forecast");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [transectId]);

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  // Downsample tick labels so they don't overlap
  function timeTick(rows: ChartRow[]) {
    // Show roughly 8-12 labels
    const step = Math.max(1, Math.floor(rows.length / 10));
    return rows.filter((_, i) => i % step === 0).map((r) => r.time);
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 820,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 14,
            background: "none",
            border: "none",
            fontSize: 22,
            cursor: "pointer",
            lineHeight: 1,
            color: "#666",
          }}
          aria-label="Close"
        >
          ×
        </button>

        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800 }}>
          Swell Forecast: {name}
        </h2>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
          CDIP transect {transectId} · 72-hour window
        </div>

        {loading && (
          <div style={{ padding: 32, textAlign: "center", color: "#555" }}>
            Loading forecast data…
          </div>
        )}

        {error && (
          <div
            style={{
              padding: 14,
              border: "1px solid #ffcccc",
              background: "#fff5f5",
              borderRadius: 10,
              color: "#7a1f1f",
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && data && data.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "#888" }}>
            No forecast data available for this transect.
          </div>
        )}

        {!loading && !error && data && data.length > 0 && (
          <>
            {/* Direction indicator strip */}
            <div
              style={{
                display: "flex",
                gap: 0,
                marginBottom: 4,
                paddingLeft: 60,
                paddingRight: 40,
                overflow: "hidden",
              }}
            >
              {data
                .filter(
                  (_, i) => i % Math.max(1, Math.floor(data.length / 30)) === 0
                )
                .map((r) =>
                  r.dp != null ? (
                    <span
                      key={r.time}
                      title={`Direction: ${r.dp.toFixed(0)}°`}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        fontSize: 26,
                        color: "#06c",
                        transform: `rotate(${r.dp}deg)`,
                        display: "inline-block",
                      }}
                    >
                      ↓
                    </span>
                  ) : (
                    <span key={r.time} style={{ flex: 1 }} />
                  )
                )}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#999",
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              ↓ Swell direction arrows above chart
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  ticks={timeTick(data)}
                  tickFormatter={(v: number) => {
                    const d = new Date(v);
                    return `${d.toLocaleDateString(undefined, {
                      weekday: "short",
                    })} ${d.getHours()}:00`;
                  }}
                  tick={{ fontSize: 11 }}
                  scale="time"
                />
                <YAxis
                  yAxisId="hs"
                  label={{
                    value: "Height (ft)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11 },
                  }}
                  tick={{ fontSize: 11 }}
                  domain={[0, "auto"]}
                />
                <YAxis
                  yAxisId="tp"
                  orientation="right"
                  label={{
                    value: "Period (s)",
                    angle: 90,
                    position: "insideRight",
                    style: { fontSize: 11 },
                  }}
                  tick={{ fontSize: 11 }}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  labelFormatter={(v) => formatTime(Number(v))}
                  formatter={(value, name) => {
                    const v = Number(value);
                    if (name === "Height (ft)")
                      return [v.toFixed(1) + " ft", name];
                    if (name === "Period (s)")
                      return [v.toFixed(1) + " s", name];
                    return [value, name];
                  }}
                />
                <Legend />
                <Area
                  yAxisId="hs"
                  type="monotone"
                  dataKey="hs"
                  name="Height (ft)"
                  stroke="#0077cc"
                  fill="#0077cc22"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Bar
                  yAxisId="tp"
                  dataKey="tp"
                  name="Period (s)"
                  fill="#f59e0b88"
                  barSize={4}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
}
