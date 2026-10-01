import { handlingStage, metersBetween } from "@/lib/handling";

export const RANGE_SCAN_METERS = 1000;

export type RangedReport = {
  id: string;
  lat: number;
  lng: number;
  meters: number;
  hazard_type: string;
  severity: string;
  risk_score: number;
  summary: string;
  address: string | null;
  status: string;
  created_at: string;
};

export function isSevereRisk(report: { severity: string; risk_score: number; status: string }) {
  if (handlingStage(report.status) === "done") return false;
  if (report.severity === "critical" || report.severity === "high") return true;
  return report.risk_score >= 70;
}

export function reportsInRange<
  T extends {
    id: string;
    lat: number | null;
    lng: number | null;
    hazard_type: string;
    severity: string;
    risk_score: number;
    summary: string;
    address: string | null;
    status: string;
    created_at: string;
  },
>(origin: { lat: number; lng: number }, reports: T[], meters = RANGE_SCAN_METERS): RangedReport[] {
  const found: RangedReport[] = [];
  for (const report of reports) {
    if (report.lat == null || report.lng == null) continue;
    if (handlingStage(report.status) === "done") continue;
    const dist = metersBetween(origin, { lat: report.lat, lng: report.lng });
    if (dist > meters) continue;
    found.push({
      id: report.id,
      lat: report.lat,
      lng: report.lng,
      meters: Math.round(dist),
      hazard_type: report.hazard_type,
      severity: report.severity,
      risk_score: report.risk_score,
      summary: report.summary,
      address: report.address,
      status: report.status,
      created_at: report.created_at,
    });
  }
  found.sort((a, b) => a.meters - b.meters);
  return found;
}

export function severeRisksInRange<T extends RangedReport>(nearby: T[]) {
  return nearby.filter((report) => isSevereRisk(report));
}

const ALERTED_KEY = "drishti-range-alerted";

export function loadAlertedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(ALERTED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export function saveAlertedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ALERTED_KEY, JSON.stringify([...ids]));
}
