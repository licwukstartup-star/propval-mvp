"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";

export interface MapPin {
  lat: number;
  lng: number;
  label: string;
}

interface MiniMapProps {
  pins: MapPin[];
  height?: number;
}

export default function MiniMapInner({ pins, height = 220 }: MiniMapProps) {
  const bounds = useMemo(() => {
    if (pins.length === 0) return undefined;
    const latlngs = pins.map((p) => [p.lat, p.lng] as [number, number]);
    return L.latLngBounds(latlngs).pad(0.3);
  }, [pins]);

  if (pins.length === 0) return null;

  return (
    <MapContainer
      bounds={bounds}
      scrollWheelZoom={false}
      dragging={true}
      zoomControl={false}
      attributionControl={false}
      style={{ height, width: "100%", borderRadius: 12 }}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" />
      {pins.map((pin, i) => (
        <CircleMarker
          key={i}
          center={[pin.lat, pin.lng]}
          radius={6}
          pathOptions={{ color: "var(--color-accent, #00F0FF)", fillColor: "#00F0FF", fillOpacity: 0.8, weight: 2 }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <span style={{ fontSize: 11 }}>{pin.label}</span>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
