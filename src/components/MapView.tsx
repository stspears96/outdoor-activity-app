"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import type { Place, TrailItem, TrailLine } from "@/lib/types";
import type { SurfSpotMarker } from "./MapViewDynamic"; // or define it in types.ts and import from there

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function degToRotationStyle(deg?: number) {
  const d = typeof deg === "number" ? deg : 0;
  return `rotate(${d}deg)`;
}

function makeArrowDivIcon(opts: {
  kind: "wind" | "swell";
  deg?: number;
  label?: string;
}) {
  const { kind, deg, label } = opts;

  // Emojis: wind arrow vs wave arrow
  const glyph = kind === "wind" ? "➤" : "➤";
  const title = kind === "wind" ? "Wind" : "Swell";

  // Small, readable, rotates via inline style
  const html = `
    <div style="
      display:flex;
      flex-direction:column;
      align-items:center;
      transform:${degToRotationStyle(deg)};
      transform-origin:center;
      filter: drop-shadow(0 1px 1px rgba(0,0,0,0.25));
      ">
      <div style="
        font-size:18px;
        line-height:18px;
        font-weight:800;
        color:${kind === "wind" ? "#0b5" : "#06c"};
        ">
        ${glyph}
      </div>
    </div>
  `;

  return L.divIcon({
    className: "", // prevent default leaflet styles
    html,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10],
  });
}

function normalizeDeg(d?: number) {
  if (typeof d !== "number") return undefined;
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}

function flipDeg180(d?: number) {
  const x = normalizeDeg(d);
  return typeof x === "number" ? (x + 180) % 360 : undefined;
}

// Convert meteorological degrees (0=N) to CSS rotation for an arrow that points EAST at 0deg.
function meteoToCssRotation(meteoDeg?: number) {
  const d = normalizeDeg(meteoDeg);
  return typeof d === "number" ? (d - 90 + 360) % 360 : undefined;
}

// If API gives "wind FROM" degrees, convert to direction the wind is blowing TO.
function windFromToWindTo(windFromDeg?: number) {
  const d = normalizeDeg(windFromDeg);
  return typeof d === "number" ? (d + 180) % 360 : undefined;
}

export default function MapView(props: {
  lat: number;
  lon: number;
  height?: number;
  label?: string;
  places?: Place[];
  trailItems?: TrailItem[];
  trailLines?: TrailLine[];
  surfSpots?: SurfSpotMarker[];
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
    surfSpots = [],
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

	{surfSpots.map((s) => {
	  const windDir = s.conditions?.windDirDeg;
	  const windKts = s.conditions?.windSpeedKts;

	  // Prefer swell; fall back to wave
	  const swellH = s.conditions?.swellHeightM ?? s.conditions?.waveHeightM;
	  const swellP = s.conditions?.swellPeriodS ?? s.conditions?.wavePeriodS;
	  const windFrom = s.conditions?.windDirDeg;          // e.g. 53 means FROM NE
	  const windTo = windFromToWindTo(windFrom);          // 233 means blowing toward SW
	  const windArrowCssDeg = meteoToCssRotation(windTo); // convert to CSS rotation

	  // If arrows look backwards in practice, flip these (common tweak):
	  const windArrowDeg = flipDeg180(windDir);   // wind: "from" -> arrow "towards"

	  const swellDir = s.conditions?.swellDirDeg ?? s.conditions?.waveDirDeg;
	  const swellArrowDeg = normalizeDeg(swellDir); // swell often already "towards"; flip if needed
	  // For swell, Open-Meteo directions are typically "to" (direction waves travel).
	  // If yours looks reversed, we’ll flip later, but start with this:
	  const swellArrowCssDeg = windFromToWindTo(meteoToCssRotation(swellDir));

	  // Offset a tiny bit so arrows don't sit directly on the pin
	  const dLat = 0.0012; // ~130m (depends on latitude; fine for UI)
	  const dLon = 0.0012;

	  return (
	    <div key={s.id}>
	      {/* Main marker pin */}
	      <Marker position={[s.lat, s.lon]}>
		<Popup>
		  <div style={{ fontWeight: 800 }}>🏄 {s.name}</div>

		  {s.quality ? (
		    <div style={{ marginTop: 4 }}>
		      <strong>{String(s.quality).toUpperCase()}</strong>
		      {typeof s.score === "number" ? ` · ${s.score}/100` : ""}
		    </div>
		  ) : null}

		  <div style={{ marginTop: 6, fontSize: 12, color: "#444" }}>
		    {typeof windKts === "number"
		      ? `Wind: ${windKts.toFixed(0)} kt @ ${normalizeDeg(windDir)?.toFixed(0)}°`
		      : "Wind: —"}
		    <br />
		    {typeof swellH === "number" && typeof swellP === "number"
		      ? `Swell: ${swellH.toFixed(1)} m @ ${swellP.toFixed(0)}s @ ${normalizeDeg(swellDir)?.toFixed(0)}°`
		      : "Swell: —"}
		  </div>

		  {Array.isArray(s.reasons) && s.reasons.length ? (
		    <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
		      {s.reasons.slice(0, 4).map((r, idx) => (
			<li key={idx} style={{ fontSize: 12 }}>{r}</li>
		      ))}
		    </ul>
		  ) : null}
		</Popup>
	      </Marker>
	      {typeof windArrowCssDeg === "number" ? (
	        <Marker
	          position={[s.lat + dLat, s.lon + dLon]}
	          icon={makeArrowDivIcon({ kind: "wind", deg: windArrowCssDeg })}
	          interactive={false}
	        />
	      ) : null}

	      {typeof swellArrowCssDeg === "number" ? (
	        <Marker
	          position={[s.lat + dLat, s.lon - dLon]}
	          icon={makeArrowDivIcon({ kind: "swell", deg: swellArrowCssDeg })}
	          interactive={false}
	        />
	      ) : null}

  	      </div>
	  );
	})}


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

