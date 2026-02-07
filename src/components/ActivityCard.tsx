import type { ActivityScore } from "@/lib/types";

export function ActivityCard({ a }: { a: ActivityScore }) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 14,
        padding: 14,
        background: "white",
        boxShadow: "0 1px 8px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{a.name}</div>
          {a.bestHourISO ? (
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
              Best hour: {new Date(a.bestHourISO).toLocaleString()}
            </div>
          ) : null}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{a.score}</div>
      </div>

      <ul style={{ marginTop: 10, paddingLeft: 18, color: "#333" }}>
        {a.why.slice(0, 3).map((w, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.35 }}>
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}

