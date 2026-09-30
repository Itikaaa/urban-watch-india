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

export function handlingStage(status: string) {
  if (status === "done" || status === "closed") return "done" as const;
  if (status === "assigned") return "assigned" as const;
  return "reported" as const;
}
