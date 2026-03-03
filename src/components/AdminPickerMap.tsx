"use client";

import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";

const PinIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

type Props = {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
  height?: number;
};

function ClickCapture({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function AdminPickerMap({ lat, lon, onPick, height = 400 }: Props) {
  const center: [number, number] = lat !== null && lon !== null ? [lat, lon] : [37.76, -122.44];

  return (
    <MapContainer
      center={center}
      zoom={11}
      style={{ height, width: "100%", cursor: "crosshair" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <ClickCapture onPick={onPick} />
      {lat !== null && lon !== null && (
        <Marker position={[lat, lon]} icon={PinIcon} />
      )}
    </MapContainer>
  );
}
