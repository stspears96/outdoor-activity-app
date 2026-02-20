"use client";

import type { ActivityId } from "@/lib/types";
import type { BetaParams, AB } from "@/lib/learning/types";
import { BUCKET_DIMS } from "@/lib/learning/buckets";

const ACTIVITY_IDS: ActivityId[] = ["walk", "run", "hike", "bike", "mtb", "picnic", "cafe", "surf"];

const ACTIVITY_LABELS: Record<ActivityId, string> = {
  walk: "Walk",
  run: "Run",
  hike: "Hike",
  bike: "Bike",
  mtb: "MTB",
  picnic: "Picnic",
  cafe: "Café",
  surf: "Surf",
};

// Interpolate between red (0) → gray (0.5) → green (1)
function goodnessToColor(ab: AB): string {
  const g = ab.alpha / (ab.alpha + ab.beta);
  const concentration = ab.alpha + ab.beta;
  const opacity = Math.min(1, Math.max(0.15, (concentration - 10) / 20));

  let r: number, gr: number, b: number;
  if (g >= 0.5) {
    const t = (g - 0.5) * 2;
    r = Math.round(229 + (34 - 229) * t);
    gr = Math.round(231 + (197 - 231) * t);
    b = Math.round(235 + (94 - 235) * t);
  } else {
    const t = g * 2;
    r = Math.round(239 + (229 - 239) * t);
    gr = Math.round(68 + (231 - 68) * t);
    b = Math.round(68 + (235 - 68) * t);
  }

  return `rgba(${r},${gr},${b},${opacity})`;
}

// Average goodness across all buckets for a dimension
function dimAvgAB(varParams: Record<string, AB> | undefined): AB {
  if (!varParams) return { alpha: 5, beta: 5 };
  const entries = Object.values(varParams);
  if (entries.length === 0) return { alpha: 5, beta: 5 };
  const alpha = entries.reduce((s, ab) => s + ab.alpha, 0) / entries.length;
  const beta = entries.reduce((s, ab) => s + ab.beta, 0) / entries.length;
  return { alpha, beta };
}

type Props = {
  betaParams: BetaParams;
  onReset: () => void;
};

export function LearnedPrefsPanel({ betaParams, onReset }: Props) {
  return (
    <div
      style={{
        marginTop: 20,
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>Learned preferences</span>
        <button
          onClick={onReset}
          style={{
            padding: "5px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "white",
            fontSize: 12,
            color: "#666",
            cursor: "pointer",
          }}
        >
          Reset to defaults
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            minWidth: 600,
            fontSize: 12,
          }}
        >
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "8px 12px",
                  borderBottom: "1px solid #e5e7eb",
                  color: "#555",
                  fontWeight: 600,
                  minWidth: 110,
                }}
              >
                Dimension
              </th>
              {ACTIVITY_IDS.map(id => (
                <th
                  key={id}
                  style={{
                    textAlign: "center",
                    padding: "8px 8px",
                    borderBottom: "1px solid #e5e7eb",
                    color: "#555",
                    fontWeight: 600,
                    minWidth: 60,
                  }}
                >
                  {ACTIVITY_LABELS[id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BUCKET_DIMS.map(dim => (
              <tr key={dim.key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td
                  style={{
                    padding: "6px 12px",
                    color: "#444",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {dim.label}
                </td>
                {ACTIVITY_IDS.map(id => {
                  const actParams = betaParams[id] as Record<string, Record<string, AB>> | undefined;
                  const varParams = actParams?.[dim.key];
                  // Show a strip of all bucket values
                  return (
                    <td key={id} style={{ padding: "4px 6px" }}>
                      <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                        {dim.buckets.map(bucket => {
                          const ab = varParams?.[bucket] ?? { alpha: 5, beta: 5 };
                          const goodness = ab.alpha / (ab.alpha + ab.beta);
                          const bg = goodnessToColor(ab);
                          return (
                            <div
                              key={bucket}
                              title={`${dim.label} · ${bucket}: ${(goodness * 100).toFixed(0)}% (α=${ab.alpha.toFixed(1)}, β=${ab.beta.toFixed(1)})`}
                              style={{
                                width: 8,
                                height: 20,
                                borderRadius: 2,
                                background: bg,
                                cursor: "help",
                              }}
                            />
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "8px 16px", background: "#f9fafb", fontSize: 11, color: "#888", borderTop: "1px solid #e5e7eb" }}>
        Each strip shows buckets (left=low, right=high). Green = good conditions, red = bad.
        Color intensity grows with more feedback.
      </div>
    </div>
  );
}
