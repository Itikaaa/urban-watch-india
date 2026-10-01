import { handlingStage, isReportableHazard, metersBetween, teamForHazard } from "@/lib/handling";

export const ROUTE_CORRIDOR_METERS = 90;
export const STALE_REPORT_DAYS = 90;

export type RoutePoint = { lat: number; lng: number };

export type RouteHazard = {
  id: string;
  lat: number;
  lng: number;
  meters: number;
  hazard_type: string;
  severity: string;
  risk_score: number;
  confidence: number;
  summary: string;
  address: string | null;
};

export type RouteRiskScore = {
  uniqueCount: number;
  severeCount: number;
  weighted: number;
  hazards: RouteHazard[];
  crowded: boolean;
};

type AuthenticInput = {
  lat: number | null;
  lng: number | null;
  status: string;
  hazard_type: string;
  severity: string;
  risk_score: number;
  confidence: number;
  created_at: string;
  image_path?: string | null;
};

export function isAuthenticReport(report: AuthenticInput, now = Date.now()) {
  if (handlingStage(report.status) === "done") return false;
  if (!isReportableHazard(report.hazard_type)) return false;
  if (report.lat == null || report.lng == null) return false;
  if (!Number.isFinite(report.lat) || !Number.isFinite(report.lng)) return false;
  if (report.lat < 6.5 || report.lat > 37.6 || report.lng < 67.5 || report.lng > 97.5) return false;
  if (report.risk_score < 25) return false;
  if (report.confidence < 0.45 && !report.image_path) return false;
  const created = new Date(report.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  if (now - created > STALE_REPORT_DAYS * 24 * 60 * 60 * 1000) return false;
  return true;
}

function downsample(path: RoutePoint[], minGap = 40): RoutePoint[] {
  if (path.length <= 2) return path;
  const out: RoutePoint[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const last = out[out.length - 1]!;
    if (metersBetween(last, path[i]!) >= minGap) out.push(path[i]!);
  }
  const end = path[path.length - 1]!;
  if (out[out.length - 1] !== end) out.push(end);
  return out;
}

function metersToSegment(point: RoutePoint, a: RoutePoint, b: RoutePoint) {
  const latM = 111320;
  const lngM = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * lngM;
  const by = (b.lat - a.lat) * latM;
  const px = (point.lng - a.lng) * lngM;
  const py = (point.lat - a.lat) * latM;
  const ab2 = bx * bx + by * by;
  if (ab2 < 1) return Math.hypot(px - ax, py - ay);
  let t = (px * bx + py * by) / ab2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

export function metersToPath(point: RoutePoint, path: RoutePoint[]) {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return metersBetween(point, path[0]!);
  const sampled = downsample(path);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sampled.length; i++) {
    const d = metersToSegment(point, sampled[i - 1]!, sampled[i]!);
    if (d < best) best = d;
  }
  return best;
}

function weightFor(report: { severity: string; risk_score: number }) {
  if (report.severity === "critical" || report.risk_score >= 90) return 40;
  if (report.severity === "high" || report.risk_score >= 70) return 25;
  if (report.severity === "medium" || report.risk_score >= 40) return 12;
  return 5;
}

export function scorePathRisks<
  T extends AuthenticInput & {
    id: string;
    summary: string;
    address: string | null;
  },
>(path: RoutePoint[], reports: T[], corridor = ROUTE_CORRIDOR_METERS): RouteRiskScore {
  const hits: RouteHazard[] = [];
  for (const report of reports) {
    if (!isAuthenticReport(report)) continue;
    const lat = report.lat as number;
    const lng = report.lng as number;
    const meters = metersToPath({ lat, lng }, path);
    if (meters > corridor) continue;
    hits.push({
      id: report.id,
      lat,
      lng,
      meters: Math.round(meters),
      hazard_type: report.hazard_type,
      severity: report.severity,
      risk_score: report.risk_score,
      confidence: report.confidence,
      summary: report.summary,
      address: report.address,
    });
  }

  const unique: RouteHazard[] = [];
  for (const hit of hits.sort((a, b) => b.risk_score - a.risk_score)) {
    const family = teamForHazard(hit.hazard_type).id;
    const same = unique.some(
      (kept) =>
        teamForHazard(kept.hazard_type).id === family &&
        metersBetween(kept, hit) <= 70,
    );
    if (!same) unique.push(hit);
  }

  const severeCount = unique.filter(
    (item) => item.severity === "critical" || item.severity === "high" || item.risk_score >= 70,
  ).length;
  const weighted = unique.reduce((sum, item) => sum + weightFor(item), 0);
  return {
    uniqueCount: unique.length,
    severeCount,
    weighted,
    hazards: unique,
    crowded: unique.length >= 3 || severeCount >= 2 || weighted >= 150,
  };
}

export function isSafer(candidate: RouteRiskScore, current: RouteRiskScore) {
  if (candidate.uniqueCount < current.uniqueCount && candidate.weighted <= current.weighted) {
    return true;
  }
  if (candidate.weighted <= current.weighted * 0.75 && candidate.severeCount <= current.severeCount) {
    return true;
  }
  return candidate.severeCount < current.severeCount && candidate.weighted < current.weighted;
}
