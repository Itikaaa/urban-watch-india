import { analysisFromStoredItems, type DepthClass, type HazardSceneAnalysis } from "@/lib/hazard-analysis";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";

const CLASS_KEYS: Record<DepthClass, MessageKey> = {
  none: "depthClassNone",
  surface: "depthClassSurface",
  shallow: "depthClassShallow",
  moderate: "depthClassModerate",
  deep: "depthClassDeep",
  severe: "depthClassSevere",
};

export function HazardAnalysisPanel({
  analysis,
  items,
}: {
  analysis?: HazardSceneAnalysis | null;
  items?: unknown;
}) {
  const { t } = useT();
  const scene = analysis ?? analysisFromStoredItems(items);
  if (!scene) return null;

  const hasDepth = scene.depthCm != null || scene.depthClass !== "none";
  const hasWater = scene.waterPresent || scene.waterDepthCm != null;
  const hasSpan = scene.widthCm != null;
  if (!hasDepth && !hasWater && !hasSpan && !scene.assessment) return null;

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-muted/30 p-3 text-sm">
      <div className="font-medium">{t("analysisTitle")}</div>
      {hasDepth ? (
        <div>
          <div className="text-xs text-muted-foreground">{t("depthEstimate")}</div>
          <div className="font-medium">
            {scene.depthCm != null
              ? t("depthAbout", { n: scene.depthCm })
              : t(CLASS_KEYS[scene.depthClass])}
            {scene.depthClass !== "none" ? ` · ${t(CLASS_KEYS[scene.depthClass])}` : ""}
          </div>
          {scene.depthCmMin != null && scene.depthCmMax != null ? (
            <div className="text-xs text-muted-foreground">
              {t("depthRange", { min: scene.depthCmMin, max: scene.depthCmMax })}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasSpan ? (
        <div>
          <div className="text-xs text-muted-foreground">{t("spanEstimate")}</div>
          <div>
            {scene.lengthCm != null
              ? t("spanAbout", { w: scene.widthCm ?? 0, l: scene.lengthCm })
              : t("widthOnly", { w: scene.widthCm ?? 0 })}
          </div>
        </div>
      ) : null}
      {hasWater ? (
        <div>
          <div className="text-xs text-muted-foreground">{t("standingWater")}</div>
          <div>
            {scene.waterDepthCm != null
              ? t("waterDepthAbout", { n: scene.waterDepthCm })
              : t(CLASS_KEYS[scene.waterDepthClass])}
          </div>
          {scene.waterObscuresBottom ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("waterFloorHidden")}</p>
          ) : null}
        </div>
      ) : null}
      {scene.assessment ? <p>{scene.assessment}</p> : null}
      {scene.cues ? (
        <p className="text-xs text-muted-foreground">
          {t("analysisCues")}: {scene.cues}
        </p>
      ) : null}
      {scene.caveats ? (
        <p className="text-xs text-muted-foreground">
          {t("analysisCaveats")}: {scene.caveats}
        </p>
      ) : null}
    </div>
  );
}
