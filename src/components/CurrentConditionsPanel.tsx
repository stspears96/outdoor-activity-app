"use client";

import { useMemo } from "react";
import type { ActivityScore, Conditions, ActivityId } from "@/lib/types";
import type { LearningState } from "@/lib/learning/types";
import { predictBeta } from "@/lib/learning/betaModel";
import { predictLinear } from "@/lib/learning/linearModel";
import { predictGp } from "@/lib/learning/gpModel";

function circularMidDeg(a: number, b: number): number {
  const s = (Math.sin((a * Math.PI) / 180) + Math.sin((b * Math.PI) / 180)) / 2;
  const c = (Math.cos((a * Math.PI) / 180) + Math.cos((b * Math.PI) / 180)) / 2;
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
}

function angDistDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: "#bbb", fontSize: 12 }}>—</span>;
  const bg =
    score >= 78 ? "#059669" :
    score >= 60 ? "#10b981" :
    score >= 42 ? "#f59e0b" :
    "#ef4444";
  return (
    <span style={{
      background: bg, color: "white",
      borderRadius: 6, padding: "2px 8px",
      fontSize: 12, fontWeight: 700,
      display: "inline-block", minWidth: 32, textAlign: "center",
    }}>
      {score}
    </span>
  );
}

function conditionsSummary(c: Conditions): string {
  const parts: string[] = [];
  parts.push(`${Math.round(c.tempF)}°F`);
  if (c.windMph > 2) parts.push(`${Math.round(c.windMph)} mph wind`);
  if (c.precipProb > 20) parts.push(`${Math.round(c.precipProb)}% rain`);
  if (c.swellHeightM != null) parts.push(`${(c.swellHeightM * 3.281).toFixed(1)}ft swell`);
  if (c.swellPeakPeriodS != null) parts.push(`${Math.round(c.swellPeakPeriodS)}s`);
  return parts.join(" · ");
}

export function CurrentConditionsPanel({
  activities,
  learningState,
}: {
  activities: ActivityScore[];
  learningState: LearningState | null;
}) {
  const rows = useMemo(() => {
    // Deduplicate by activity id — keep best-scoring row per id (already sorted desc).
    const seen = new Set<ActivityId>();
    const unique = activities.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    return unique.slice(0, 6).map(a => {
      const rawCond = a.bestHourConditions;

      let betaScore: number | null = null;
      let linearScore: number | null = null;
      let gpScore: number | null = null;

      if (learningState && rawCond) {
        // For surf: ensure windOffshoreAngleDeg is set (the API doesn't always populate it).
        let cond: Conditions = rawCond;
        if (a.isSurf && !cond.windOffshoreAngleDeg && cond.windDirDeg != null
            && a.wind_offshore_min_deg != null && a.wind_offshore_max_deg != null) {
          const offCenter = circularMidDeg(a.wind_offshore_min_deg, a.wind_offshore_max_deg);
          cond = { ...cond, windOffshoreAngleDeg: angDistDeg(cond.windDirDeg, offCenter) };
        }

        betaScore = Math.round(predictBeta(learningState.betaParams, a.id, cond) * 100);

        const lp = learningState.linearParams?.[a.id];
        if (lp && lp.updateCount > 0) {
          linearScore = Math.round(Math.max(0, Math.min(1, predictLinear(lp, cond))) * 100);
        }

        const obsCount = learningState.gpConfig?.observations
          ?.filter(o => o.activityId === a.id).length ?? 0;
        if (obsCount > 0) {
          gpScore = Math.round(Math.max(0, Math.min(1, predictGp(learningState.gpConfig, a.id, cond))) * 100);
        }
      }

      return { activity: a, betaScore, linearScore, gpScore };
    });
  }, [activities, learningState]);

  const hasLinear = rows.some(r => r.linearScore != null);
  const hasGp = rows.some(r => r.gpScore != null);

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Current Conditions</h2>
      <div style={{ overflowX: "auto", border: "1px solid #e5e5e5", borderRadius: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 700 }}>Activity</th>
              <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 700 }}>Rule-based</th>
              <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 700 }}>Bayesian</th>
              {hasLinear && <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 700 }}>Linear</th>}
              {hasGp && <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 700 }}>GP</th>}
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 12, fontWeight: 700 }}>Conditions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ activity: a, betaScore, linearScore, gpScore }) => (
              <tr key={a.id}>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f4f4f4", fontWeight: 600, fontSize: 13 }}>{a.name}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f4f4f4", textAlign: "center" }}>
                  <ScoreBadge score={a.score} />
                </td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f4f4f4", textAlign: "center" }}>
                  <ScoreBadge score={betaScore} />
                </td>
                {hasLinear && (
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f4f4f4", textAlign: "center" }}>
                    <ScoreBadge score={linearScore} />
                  </td>
                )}
                {hasGp && (
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f4f4f4", textAlign: "center" }}>
                    <ScoreBadge score={gpScore} />
                  </td>
                )}
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f4f4f4", fontSize: 11, color: "#666" }}>
                  {a.bestHourConditions ? conditionsSummary(a.bestHourConditions) : (a.why.slice(0, 2).join(" · "))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasLinear && !hasGp && (
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
          Linear and GP columns appear after logging activity sessions.
        </div>
      )}
    </section>
  );
}
