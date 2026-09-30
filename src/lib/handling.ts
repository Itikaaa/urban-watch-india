export type Team = {
  id: string;
  name: string;
  focus: string;
};

export const TEAMS = {
  garbage: { id: "team-1", name: "Team 1", focus: "Garbage accumulation" },
  pothole: { id: "team-2", name: "Team 2", focus: "Potholes" },
  streetlight: { id: "team-3", name: "Team 3", focus: "Broken streetlights" },
  water: { id: "team-4", name: "Team 4", focus: "Water accumulation" },
} as const satisfies Record<string, Team>;

const FASTEST_HOURS = 65;
const SLOWEST_HOURS = 5 * 24;

const REPORTABLE = new Set([
  "garbage",
  "debris",
  "pothole",
  "damaged_road",
  "broken_footpath",
  "open_manhole",
  "waterlogging",
  "stagnant_water",
  "streetlight",
  "broken_streetlight",
  "traffic_hazard",
]);

export function teamForHazard(type: string): Team {
  const key = type.toLowerCase();
  if (key === "waterlogging" || key === "stagnant_water") return TEAMS.water;
  if (key === "streetlight" || key === "broken_streetlight") return TEAMS.streetlight;
  if (key === "garbage" || key === "debris") return TEAMS.garbage;
  return TEAMS.pothole;
}

export function teamById(id: string | null | undefined): Team | null {
  if (!id) return null;
  const match = Object.values(TEAMS).find((team) => team.id === id || team.name === id);
  return match ?? null;
}

export function assignedTeamFor(report: {
  assigned_team?: string | null;
  authority_name?: string | null;
  status: string;
  hazard_type: string;
}): Team | null {
  const stored = teamById(report.assigned_team);
  if (stored) return stored;
  const legacy = teamById(report.authority_name);
  if (legacy && handlingStage(report.status) !== "reported") return legacy;
  return null;
}

export function repairIsClear(detection: {
  hazardDetected: boolean;
  primaryType: string;
  items: { type: string; count: number }[];
}) {
  return (
    !detection.hazardDetected &&
    !shouldAutoReport(detection.primaryType, detection.hazardDetected, detection.items)
  );
}

export function isReportableHazard(type: string) {
  return REPORTABLE.has(type.toLowerCase());
}

export function shouldAutoReport(
  primaryType: string,
  hazardDetected: boolean,
  items: { type: string; count: number }[],
) {
  if (items.some((item) => isReportableHazard(item.type) && item.count > 0)) return true;
  return hazardDetected && isReportableHazard(primaryType);
}

/** Higher risk finishes sooner, from 5 days down to 65 hours. */
export function resolutionHours(riskScore: number) {
  const risk = Math.max(0, Math.min(100, riskScore)) / 100;
  return Math.round(SLOWEST_HOURS - risk * (SLOWEST_HOURS - FASTEST_HOURS));
}

export function formatResolution(hours: number) {
  if (hours <= 72) return `${hours} hours`;
  const days = Math.round((hours / 24) * 10) / 10;
  return Number.isInteger(days) ? `${days} days` : `${days} days`;
}

export function dueDate(createdAt: string, riskScore: number) {
  return new Date(new Date(createdAt).getTime() + resolutionHours(riskScore) * 60 * 60 * 1000);
}

export function dueFromEta(from: string, hours: number) {
  return new Date(new Date(from).getTime() + hours * 60 * 60 * 1000);
}

export function handlingStage(status: string) {
  if (status === "done" || status === "closed") return "done" as const;
  if (status === "assigned") return "assigned" as const;
  return "reported" as const;
}

/** Same-issue reports within this distance are treated as duplicates. */
export const DUPLICATE_METERS = 100;

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function findOpenDuplicate<
  T extends {
    lat: number | null;
    lng: number | null;
    hazard_type: string;
    status: string;
  },
>(reports: T[], lat: number, lng: number, hazardType: string): T | null {
  const family = teamForHazard(hazardType).id;
  for (const report of reports) {
    if (handlingStage(report.status) === "done") continue;
    if (report.lat == null || report.lng == null) continue;
    if (teamForHazard(report.hazard_type).id !== family) continue;
    if (metersBetween({ lat, lng }, { lat: report.lat, lng: report.lng }) <= DUPLICATE_METERS) {
      return report;
    }
  }
  return null;
}
