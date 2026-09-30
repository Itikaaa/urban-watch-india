export const ANALYSIS_ITEM_TYPE = "scene_analysis";

export const DEPTH_CLASSES = [
  "none",
  "surface",
  "shallow",
  "moderate",
  "deep",
  "severe",
] as const;

export type DepthClass = (typeof DEPTH_CLASSES)[number];

export type HazardSceneAnalysis = {
  assessment: string;
  depthClass: DepthClass;
  depthCm: number | null;
  depthCmMin: number | null;
  depthCmMax: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  waterPresent: boolean;
  waterDepthCm: number | null;
  waterDepthClass: DepthClass;
  waterObscuresBottom: boolean;
  cues: string;
  caveats: string;
};

export type AnalysisItemFields = {
  type: string;
  label: string;
  count: number;
  severity: number;
  confidence: number;
  note: string;
};

function clampClass(value: unknown): DepthClass {
  const key = String(value ?? "none").toLowerCase();
  return (DEPTH_CLASSES as readonly string[]).includes(key) ? (key as DepthClass) : "none";
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export function emptyAnalysis(): HazardSceneAnalysis {
  return {
    assessment: "",
    depthClass: "none",
    depthCm: null,
    depthCmMin: null,
    depthCmMax: null,
    widthCm: null,
    lengthCm: null,
    waterPresent: false,
    waterDepthCm: null,
    waterDepthClass: "none",
    waterObscuresBottom: false,
    cues: "",
    caveats: "",
  };
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] != null) return row[key];
  }
  return undefined;
}

export function parseAnalysis(raw: unknown): HazardSceneAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const assessment = String(pick(row, ["assessment", "analysis"]) ?? "").trim();
  const cues = String(pick(row, ["cues"]) ?? "").trim();
  const caveats = String(pick(row, ["caveats"]) ?? "").trim();
  const waterPresent = Boolean(pick(row, ["waterPresent", "water_present"]));
  const parsed: HazardSceneAnalysis = {
    assessment,
    depthClass: clampClass(pick(row, ["depthClass", "depth_class"])),
    depthCm: num(pick(row, ["depthCm", "depth_cm"])),
    depthCmMin: num(pick(row, ["depthCmMin", "depth_cm_min"])),
    depthCmMax: num(pick(row, ["depthCmMax", "depth_cm_max"])),
    widthCm: num(pick(row, ["widthCm", "width_cm"])),
    lengthCm: num(pick(row, ["lengthCm", "length_cm"])),
    waterPresent,
    waterDepthCm: num(pick(row, ["waterDepthCm", "water_depth_cm"])),
    waterDepthClass: clampClass(pick(row, ["waterDepthClass", "water_depth_class"])),
    waterObscuresBottom: Boolean(pick(row, ["waterObscuresBottom", "water_obscures_bottom"])),
    cues,
    caveats,
  };
  if (
    !parsed.assessment &&
    parsed.depthCm == null &&
    parsed.waterDepthCm == null &&
    !parsed.waterPresent &&
    parsed.depthClass === "none"
  ) {
    return null;
  }
  if (parsed.depthCm != null && parsed.depthClass === "none") {
    parsed.depthClass = classFromCm(parsed.depthCm);
  }
  if (parsed.waterDepthCm != null && parsed.waterDepthClass === "none") {
    parsed.waterDepthClass = classFromCm(parsed.waterDepthCm);
  }
  return parsed;
}

export function classFromCm(cm: number): DepthClass {
  if (cm < 2) return "surface";
  if (cm < 5) return "shallow";
  if (cm < 15) return "moderate";
  if (cm < 30) return "deep";
  return "severe";
}

export function encodeAnalysisItem(analysis: HazardSceneAnalysis): AnalysisItemFields {
  return {
    type: ANALYSIS_ITEM_TYPE,
    label: "Scene analysis",
    count: 1,
    severity: 1,
    confidence: 1,
    note: JSON.stringify(analysis),
  };
}

export function analysisFromStoredItems(items: unknown): HazardSceneAnalysis | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (String(row["type"]) !== ANALYSIS_ITEM_TYPE) continue;
    const fromNote = parseAnalysis(safeParseJson(String(row["note"] ?? "")));
    if (fromNote) return fromNote;
    return parseAnalysis(row);
  }
  return null;
}

export function withoutAnalysisItems<T extends { type: string }>(items: T[]): T[] {
  return items.filter((item) => item.type !== ANALYSIS_ITEM_TYPE);
}

export function withStoredAnalysis<T extends AnalysisItemFields>(
  items: T[],
  analysis: HazardSceneAnalysis | null,
): T[] {
  const visible = withoutAnalysisItems(items);
  if (!analysis) return visible;
  return [...visible, encodeAnalysisItem(analysis) as T];
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function composeSummary(summary: string, analysis: HazardSceneAnalysis | null): string {
  const base = summary.trim();
  if (!analysis) return base;
  const extra: string[] = [];
  if (analysis.depthCm != null) {
    const range =
      analysis.depthCmMin != null && analysis.depthCmMax != null
        ? ` (${analysis.depthCmMin}–${analysis.depthCmMax} cm)`
        : "";
    extra.push(`Pothole / cavity depth about ${analysis.depthCm} cm${range}.`);
  }
  if (analysis.waterPresent) {
    const water =
      analysis.waterDepthCm != null ? ` about ${analysis.waterDepthCm} cm` : "";
    extra.push(
      `Standing water${water}${
        analysis.waterObscuresBottom
          ? "; floor hidden so the cavity may be deeper than the water surface"
          : ""
      }.`,
    );
  }
  if (analysis.widthCm != null) {
    extra.push(
      analysis.lengthCm != null
        ? `Span about ${analysis.widthCm} × ${analysis.lengthCm} cm.`
        : `About ${analysis.widthCm} cm across.`,
    );
  }
  if (analysis.assessment && !base.includes(analysis.assessment)) extra.push(analysis.assessment);
  const joined = extra.join(" ").trim();
  if (!joined) return base;
  if (!base) return joined;
  if (base.includes(joined.slice(0, 24))) return base;
  return `${base} ${joined}`;
}
