"use client";

import dynamic from "next/dynamic";

// Load the real MapView only on the client
export const MapViewDynamic = dynamic(
  () => import("./MapView").then(mod => mod.MapView),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 360,
          border: "1px solid #e5e5e5",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
          background: "#fafafa",
        }}
      >
        Loading map…
      </div>
    ),
  }
);

