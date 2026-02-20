"use client";

import { useEffect, useRef, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import type { WeatherResponse } from "@/lib/types";
import { scoreSurfSpot, SurfConditions, qualityToColor } from "@/lib/surfScoring";

type CdipPoint = {
  time: string;
  waveHs: number | null;
  waveTp: number | null;
  waveTa: number | null;
  waveDp: number | null;
  waveDm: number | null;
};

type ChartRow = {
  time: number; // epoch ms
  label: string; // formatted time
  nowcastHs: number | null; // observed swell height (ft)
  forecastHs: number | null; // forecast swell height (ft)
  tp: number | null; // peak period (s)
  ta: number | null; // average period (s)
  dp: number | null; // peak direction (deg)
  windDir: number | null; // wind direction (deg)
  windSpeed: number | null; // wind speed (kts)
  score: number | null;
  color: string | null;
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
  const d = b - a;
  const delta = ((d + 180) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

const CustomLegend = (props: any) => {
  const { payload } = props;
  
  // Custom sorting: Observed Hs, Forecast Hs, Peak Period, Avg Period
  const order = ["Observed Hs (ft)", "Forecast Hs (ft)", "Peak Period (s)", "Avg Period (s)"];
  const sortedPayload = [...payload].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));

  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px', margin: 0, padding: '8px 0', fontSize: '12px' }}>
      {sortedPayload.map((entry: any, index: number) => {
        return (
          <li key={`item-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="24" height="12" style={{ display: 'block' }}>
              {entry.type === 'area' ? (
                <>
                  <rect x="0" y="0" width="24" height="12" fill={entry.color} fillOpacity="0.2" />
                  <line x1="0" y1="0" x2="24" y2="0" stroke={entry.color} strokeWidth="4" />
                </>
              ) : (
                <line 
                  x1="0" y1="6" x2="24" y2="6" 
                  stroke={entry.color} 
                  strokeWidth="2" 
                  strokeDasharray={entry.payload?.strokeDasharray}
                />
              )}
            </svg>
            <span style={{ color: '#333' }}>{entry.value}</span>
          </li>
        );
      })}
    </ul>
  );
};

const QUALITY_LEVELS = [
  { label: "Poor", color: "#ef4444" },
  { label: "Fair", color: "#f59e0b" },
  { label: "Good", color: "#10b981" },
  { label: "Excellent", color: "#059669" },
];

export default function SwellForecastModal(props: {
  name: string;
  transectId: string;
  lat: number;
  lon: number;
  wind_offshore_min_deg?: number | null;
  wind_offshore_max_deg?: number | null;
  swell_min_deg?: number | null;
  swell_max_deg?: number | null;
  onClose: () => void;
}) {
  const { name, transectId, lat, lon, onClose, wind_offshore_min_deg, wind_offshore_max_deg, swell_min_deg, swell_max_deg } = props;
  const [data, setData] = useState<ChartRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const currentTime = Date.now();
      setNowMs(currentTime);

      try {
        const [nowcastRes, forecastRes, weatherRes] = await Promise.all([
          fetch(`/api/cdip/alongshore?transect=${encodeURIComponent(transectId)}&hours=72`),
          fetch(`/api/cdip/forecast?transect=${encodeURIComponent(transectId)}`),
          fetch(`/api/weather?lat=${lat}&lon=${lon}`),
        ]);

        if (!nowcastRes.ok) throw new Error(`Nowcast request failed: ${nowcastRes.status}`);

        const nowcastJson = await nowcastRes.json();
        const nowcastPoints: CdipPoint[] = (nowcastJson.points ?? []).sort((a: any, b: any) => Date.parse(a.time) - Date.parse(b.time));

        let forecastPoints: CdipPoint[] = [];
        if (forecastRes.ok) {
          const forecastJson = await forecastRes.json();
          forecastPoints = (forecastJson.points ?? []).sort((a: any, b: any) => Date.parse(a.time) - Date.parse(b.time));
        }

        let weather: WeatherResponse | null = null;
        if (weatherRes.ok) {
          weather = await weatherRes.json();
        }

        if (cancelled) return;

        const startMs = currentTime - 24 * 3600 * 1000;
        const endMs = currentTime + 72 * 3600 * 1000;
        const windowStart = new Date(startMs);
        windowStart.setMinutes(0, 0, 0);
        
        const rows: ChartRow[] = [];
        const hourStep = 3600 * 1000;

        for (let t = windowStart.getTime(); t <= endMs; t += hourStep) {
            rows.push({
                time: t,
                label: formatTime(t),
                nowcastHs: null,
                forecastHs: null,
                tp: null,
                ta: null,
                dp: null,
                windDir: null,
                windSpeed: null,
                score: null,
                color: null,
            });
        }

        const getInterpolated = (pts: CdipPoint[], targetMs: number) => {
            if (pts.length === 0) return null;
            const tFirst = Date.parse(pts[0].time);
            const tLast = Date.parse(pts[pts.length - 1].time);
            if (targetMs < tFirst || targetMs > tLast) return null;
            let i = 0;
            while (i < pts.length && Date.parse(pts[i].time) < targetMs) i++;
            if (i === 0) return pts[0];
            if (i === pts.length) return pts[pts.length - 1];
            const p0 = pts[i-1];
            const p1 = pts[i];
            const t0 = Date.parse(p0.time);
            const t1 = Date.parse(p1.time);
            const range = t1 - t0;
            if (range === 0) return p0;
            const t = (targetMs - t0) / range;
            if (range > 12 * 3600 * 1000) return null;
            return {
                time: new Date(targetMs).toISOString(),
                waveHs: p0.waveHs !== null && p1.waveHs !== null ? lerp(p0.waveHs, p1.waveHs, t) : (p0.waveHs ?? p1.waveHs),
                waveTp: p0.waveTp !== null && p1.waveTp !== null ? lerp(p0.waveTp, p1.waveTp, t) : (p0.waveTp ?? p1.waveTp),
                waveTa: p0.waveTa !== null && p1.waveTa !== null ? lerp(p0.waveTa, p1.waveTa, t) : (p0.waveTa ?? p1.waveTa),
                waveDp: p0.waveDp !== null && p1.waveDp !== null ? lerpAngle(p0.waveDp, p1.waveDp, t) : (p0.waveDp ?? p1.waveDp),
                waveDm: p0.waveDm !== null && p1.waveDm !== null ? lerpAngle(p0.waveDm, p1.waveDm, t) : (p0.waveDm ?? p1.waveDm),
            };
        };

        for (const row of rows) {
            const isFuture = row.time > currentTime;
            const cNow = getInterpolated(nowcastPoints, row.time);
            const cFore = getInterpolated(forecastPoints, row.time);
            if (cNow) row.nowcastHs = cNow.waveHs != null ? cNow.waveHs * 3.281 : null;
            if (cFore) row.forecastHs = cFore.waveHs != null ? cFore.waveHs * 3.281 : null;
            const best = isFuture ? (cFore ?? cNow) : (cNow ?? cFore);
            if (best) {
                row.tp = best.waveTp;
                row.ta = best.waveTa;
                row.dp = best.waveDm ?? best.waveDp;
            }
            if (weather && weather.hourly) {
                const wTime = weather.hourly.time;
                const wDir = weather.hourly.winddirection_10m;
                const wSpeed = weather.hourly.windspeed_10m;
                if (wTime) {
                    const idx = wTime.findIndex(s => Date.parse(s) === row.time);
                    if (idx !== -1) {
                        if (wDir) row.windDir = wDir[idx] ?? null;
                        if (wSpeed) row.windSpeed = wSpeed[idx] ?? null;
                    }
                }
            }
            if (row.tp != null && row.windDir != null) {
                const cond: SurfConditions = {
                    windSpeedKts: row.windSpeed != null ? row.windSpeed * 0.868976 : undefined,
                    windDirDeg: row.windDir,
                    swellHeightM: (row.forecastHs ?? row.nowcastHs ?? 0) / 3.281,
                    swellPeakPeriodS: row.tp,
                    swellAvgPeriodS: row.ta ?? undefined,
                    swellPeriodDiffS: (row.tp != null && row.ta != null) ? (row.tp - row.ta) : undefined,
                    swellDirDeg: row.dp ?? undefined,
                };
                const { score, quality } = scoreSurfSpot({
                    wind_offshore_min_deg,
                    wind_offshore_max_deg,
                    swell_min_deg,
                    swell_max_deg
                }, cond);
                row.score = score;
                row.color = qualityToColor(quality);
            }
        }
        setData(rows);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load forecast");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [transectId, lat, lon, wind_offshore_min_deg, wind_offshore_max_deg, swell_min_deg, swell_max_deg]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  function timeTick(rows: ChartRow[]) {
    const step = Math.max(1, Math.floor(rows.length / 8));
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
          Forecast: {name}
        </h2>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
          CDIP transect {transectId} · 24h past to 72h future
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
            No forecast data available for this location.
          </div>
        )}

        {!loading && !error && data && data.length > 0 && (
          <>
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
                  (_, i) => i % Math.max(1, Math.floor(data.length / 24)) === 0
                )
                .map((r) =>
                  r.windDir != null ? (
                    <span
                      key={r.time}
                      title={`Wind: ${r.windSpeed?.toFixed(0)} mph from ${r.windDir.toFixed(0)}° at ${r.label}`}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        fontSize: 24,
                        color: "#0b5",
                        transform: `rotate(${r.windDir}deg)`, 
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
                    const day = d.toLocaleDateString(undefined, { weekday: "short" });
                    const hr = d.getHours();
                    return `${day} ${hr}:00`;
                  }}
                  tick={{ fontSize: 10 }}
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
                    if (name.includes("Hs")) return [v.toFixed(1) + " ft", name];
                    if (name.includes("Period")) return [v.toFixed(1) + " s", name];
                    return [value, name];
                  }}
                />
                <Legend content={<CustomLegend />} />
                
                <Area
                  yAxisId="hs"
                  type="monotone"
                  dataKey="nowcastHs"
                  name="Observed Hs (ft)"
                  stroke="#0077cc"
                  fill="#0077cc22"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  yAxisId="hs"
                  type="monotone"
                  dataKey="forecastHs"
                  name="Forecast Hs (ft)"
                  stroke="#e05530"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  connectNulls
                />
                <Line
                  yAxisId="tp"
                  type="monotone"
                  dataKey="tp"
                  name="Peak Period (s)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  yAxisId="tp"
                  type="monotone"
                  dataKey="ta"
                  name="Avg Period (s)"
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls
                />
                <ReferenceLine 
                    x={nowMs} 
                    stroke="red" 
                    strokeWidth={2}
                    strokeDasharray="3 3" 
                    label={{ value: "NOW", position: "top", fontSize: 12, fill: "red", fontWeight: 'bold' }} 
                />
              </ComposedChart>
            </ResponsiveContainer>

            <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#666', marginBottom: 4, textAlign: 'center' }}>
                    Surf Quality Forecast
                </div>
                <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', marginLeft: 60, marginRight: 40 }}>
                    {data.map((r, i) => (
                        <div 
                            key={i} 
                            title={`${r.label}: Score ${r.score ?? '—'}`}
                            style={{ 
                                flex: 1, 
                                background: r.color ?? '#eee',
                                borderRight: '1px solid rgba(255,255,255,0.1)'
                            }} 
                        />
                    ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: 6 }}>
                    {QUALITY_LEVELS.map(lvl => (
                        <div key={lvl.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ width: 10, height: 10, borderRadius: '2px', background: lvl.color }} />
                            <span style={{ fontSize: '10px', color: '#666' }}>{lvl.label}</span>
                        </div>
                    ))}
                </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
