export type SightKind = "person" | "phone" | "vehicle" | "garbage" | "scene";

export type Sight = {
  kind: SightKind;
  label: string;
  score: number;
  box: { x: number; y: number; w: number; h: number };
};

const VEHICLES = new Set([
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "aeroplane",
  "bus",
  "train",
  "truck",
  "boat",
  "vehicle",
]);

const CLUTTER = new Set([
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
]);

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Clutter is garbage. People, phones, vehicles, and other objects keep their own names. */
export function classifySight(categoryName: string): { kind: SightKind; label: string } {
  const key = categoryName.trim().toLowerCase();
  if (key === "person") return { kind: "person", label: "Person" };
  if (key === "cell phone" || key === "phone" || key === "mobile phone")
    return { kind: "phone", label: "Phone" };
  if (VEHICLES.has(key))
    return { kind: "vehicle", label: titleCase(key === "aeroplane" ? "airplane" : key) };
  if (CLUTTER.has(key)) return { kind: "garbage", label: "Garbage" };
  return { kind: "scene", label: titleCase(key) };
}

export function sightColor(kind: SightKind) {
  switch (kind) {
    case "person":
      return "#38bdf8";
    case "phone":
      return "#facc15";
    case "vehicle":
      return "#fb923c";
    case "garbage":
      return "#ef4444";
    default:
      return "#e5e7eb";
  }
}

export type BoxFrame = { scale: number; offsetX: number; offsetY: number };

/** Map source-pixel boxes onto an object-contain frame. */
export function containFrame(
  containerW: number,
  containerH: number,
  sourceW: number,
  sourceH: number,
): BoxFrame {
  if (!containerW || !containerH || !sourceW || !sourceH) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(containerW / sourceW, containerH / sourceH);
  return {
    scale,
    offsetX: (containerW - sourceW * scale) / 2,
    offsetY: (containerH - sourceH * scale) / 2,
  };
}

export type SightGroup = { kind: SightKind; label: string; count: number };

const GROUP_ORDER: SightKind[] = ["person", "phone", "vehicle", "garbage", "scene"];

export function clutterRisk(count: number) {
  if (count <= 0) return 0;
  return Math.min(95, 12 + count * 9);
}

export function groupSights(sights: Sight[]): SightGroup[] {
  const groups = new Map<string, SightGroup>();
  for (const sight of sights) {
    const key = `${sight.kind}:${sight.label}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { kind: sight.kind, label: sight.label, count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label),
  );
}
