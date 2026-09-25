export type SightKind = "person" | "phone" | "garbage" | "scene";

export type Sight = {
  kind: SightKind;
  label: string;
  score: number;
  box: { x: number; y: number; w: number; h: number };
};

const CLUTTER = new Set([
  "backpack",
  "umbrella",
  "handbag",
  "suitcase",
  "frisbee",
  "sports ball",
  "kite",
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
  "book",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush",
  "remote",
]);

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Person and phone keep their names. Loose objects are clutter, reported as garbage. */
export function classifySight(categoryName: string): { kind: SightKind; label: string } {
  const key = categoryName.trim().toLowerCase();
  if (key === "person") return { kind: "person", label: "Person" };
  if (key === "cell phone" || key === "phone" || key === "mobile phone")
    return { kind: "phone", label: "Phone" };
  if (CLUTTER.has(key)) return { kind: "garbage", label: "Garbage" };
  return { kind: "scene", label: titleCase(key) };
}

export function sightColor(kind: SightKind) {
  switch (kind) {
    case "person":
      return "#38bdf8";
    case "phone":
      return "#facc15";
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

export function countSights(sights: Sight[]) {
  return {
    person: sights.filter((sight) => sight.kind === "person").length,
    phone: sights.filter((sight) => sight.kind === "phone").length,
    garbage: sights.filter((sight) => sight.kind === "garbage").length,
  };
}
