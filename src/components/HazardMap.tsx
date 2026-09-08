import { useEffect, useRef } from "react";
import L from "leaflet";
import { HAZARD_LABELS, severityColor } from "@/lib/authorities";

export type MapReport = {
  id: string;
  lat: number | null;
  lng: number | null;
  hazard_type: string;
  severity: string;
  risk_score: number;
  summary: string;
  address: string | null;
  created_at: string;
};

export default function HazardMap({
  reports,
  height = 420,
  focus,
}: {
  reports: MapReport[];
  height?: number;
  focus?: { lat: number; lng: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView([22.9734, 78.6569], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    const points: [number, number][] = [];
    for (const r of reports) {
      if (r.lat == null || r.lng == null) continue;
      const color = severityColor(r.severity);
      points.push([r.lat, r.lng]);
      L.circleMarker([r.lat, r.lng], {
        radius: 7 + Math.round(r.risk_score / 18),
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.55,
      })
        .bindPopup(
          `<strong>${HAZARD_LABELS[r.hazard_type] ?? r.hazard_type}</strong><br/>` +
            `<span style="text-transform:capitalize">${r.severity} risk · ${r.risk_score}/100</span><br/>` +
            `${r.address ? `<em>${r.address}</em><br/>` : ""}` +
            `${r.summary ?? ""}`,
        )
        .addTo(layer);
    }

    if (focus) {
      map.setView([focus.lat, focus.lng], 16);
    } else if (points.length === 1) {
      map.setView(points[0]!, 15);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.25));
    }
  }, [reports, focus]);

  return <div ref={containerRef} style={{ height }} className="w-full rounded-xl border border-border" />;
}
