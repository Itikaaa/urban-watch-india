import { useEffect, useRef } from "react";
import L from "leaflet";
import { HAZARD_LABELS, riskColor } from "@/lib/authorities";
import { hazardLabel, severityLabel } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";

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

export type MapRouteLine = {
  path: { lat: number; lng: number }[];
  color: string;
  weight?: number;
  dashed?: boolean;
};

export default function HazardMap({
  reports,
  height = 420,
  focus,
  origin,
  rangeMeters,
  routes,
}: {
  reports: MapReport[];
  height?: number;
  focus?: { lat: number; lng: number } | null;
  origin?: { lat: number; lng: number } | null;
  rangeMeters?: number;
  routes?: MapRouteLine[];
}) {
  const { locale, t } = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(
      [22.9734, 78.6569],
      5,
    );
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
      const color = riskColor(r.risk_score);
      points.push([r.lat, r.lng]);
      L.circleMarker([r.lat, r.lng], {
        radius: 7 + Math.round(r.risk_score / 18),
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.55,
      })
        .bindPopup(
          `<strong>${hazardLabel(r.hazard_type, locale) || HAZARD_LABELS[r.hazard_type] || r.hazard_type}</strong><br/>` +
            `<span>${t("riskBadge", { severity: severityLabel(r.severity, locale), score: r.risk_score })}</span><br/>` +
            `${r.address ? `<em>${r.address}</em><br/>` : ""}` +
            `${r.summary ?? ""}`,
        )
        .addTo(layer);
    }

    for (const line of routes ?? []) {
      if (line.path.length < 2) continue;
      const latlngs = line.path.map((point) => [point.lat, point.lng] as [number, number]);
      L.polyline(latlngs, {
        color: line.color,
        weight: line.weight ?? 5,
        opacity: 0.9,
        dashArray: line.dashed ? "8 8" : undefined,
      }).addTo(layer);
      for (const point of latlngs) points.push(point);
    }

    let rangeCircle: L.Circle | null = null;
    if (origin && rangeMeters) {
      rangeCircle = L.circle([origin.lat, origin.lng], {
        radius: rangeMeters,
        color: "#38bdf8",
        weight: 2,
        fillColor: "#38bdf8",
        fillOpacity: 0.08,
      }).addTo(layer);
    }
    if (origin) {
      L.circleMarker([origin.lat, origin.lng], {
        radius: 8,
        color: "#0ea5e9",
        weight: 2,
        fillColor: "#38bdf8",
        fillOpacity: 1,
      })
        .bindPopup(`<strong>${t("youAreHere")}</strong>`)
        .addTo(layer);
      points.push([origin.lat, origin.lng]);
    }

    if (rangeCircle) {
      map.fitBounds(rangeCircle.getBounds().pad(0.08));
    } else if (focus) {
      map.setView([focus.lat, focus.lng], 16);
    } else if (points.length === 1) {
      map.setView(points[0]!, 15);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.25));
    }
  }, [reports, focus, origin, rangeMeters, routes, locale, t]);

  return (
    <div ref={containerRef} style={{ height }} className="w-full rounded-xl border border-border" />
  );
}
