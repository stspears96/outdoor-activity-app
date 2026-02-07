"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import type { Place, TrailItem, TrailLine } from "@/lib/types";

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export function MapView(props: {
  lat: number;
  lon: number;
  height?: number;
  label?: string;
  places?: Place[];
  trailItems?: TrailItem[];
  trailLines?: TrailLine[];
  onLoadTrailLine?: (refType: "relation" | "way", id: number, label: string) => void;
}) {
  const {
    lat,
    lon,
    height = 360,
    label = "You are here",
    places = [],
    trailItems = [],
    trailLines = [],
  } = props;

  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, overflow: "hidden" }}>
      <MapContainer center={[lat, lon]} zoom={13} scrollWheelZoom={true} style={{ height, width: "100%" }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Polylines first (so markers sit on top) */}
        {trailLines.map((ln) => (
          <Polyline key={ln.id} positions={ln.latlngs}>
            <Popup>
              <div style={{ fontWeight: 700 }}>{ln.name ?? "Trail segment"}</div>
              {ln.osmUrl ? (
                <a href={ln.osmUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                  View on OpenStreetMap
                </a>
              ) : null}
            </Popup>
          </Polyline>
        ))}

        {/* Your location marker */}
        <Marker position={[lat, lon]}>
          <Popup>{label}</Popup>
        </Marker>

        {/* Generic place markers (parks/cafes/etc.) */}
        {places.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon]}>
            <Popup>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "#555" }}>{p.type}</div>
              {p.osmUrl ? (
                <a href={p.osmUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                  View on OpenStreetMap
                </a>
              ) : null}
            </Popup>
          </Marker>
        ))}

        {/* Hiking markers (trailheads/routes) */}
        {trailItems.map((t) => (
	  <Marker key={t.id} position={[t.lat, t.lon]}>
	    <Popup>
	      <div style={{ fontWeight: 700 }}>{t.name}</div>
	      <div style={{ fontSize: 12, color: "#555" }}>
		{t.itemType}
		{t.difficulty ? ` · ${t.difficulty}` : ""}
		{t.surface ? ` · ${t.surface}` : ""}
		{t.symbol ? ` · ${t.symbol}` : ""}
	      </div>

	      {t.osmUrl ? (
		<a href={t.osmUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, display: "inline-block", marginTop: 6 }}>
		  View on OpenStreetMap
		</a>
	      ) : null}

	      {t.refType && t.refId && (t.refType === "relation" || t.refType === "way") ? (
		<button
		  onClick={() => props.onLoadTrailLine?.(t.refType, t.refId!, t.name)}
		  style={{
		    marginTop: 8,
		    padding: "6px 8px",
		    borderRadius: 10,
		    border: "1px solid #ddd",
		    background: "white",
		    cursor: "pointer",
		    fontSize: 12,
		  }}
		>
		  Load trail line
		</button>
	      ) : null}
	    </Popup>
	  </Marker>
	))}
	</MapContainer>
    </div>
  );
}

