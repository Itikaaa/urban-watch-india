import { HAZARD_LABELS } from "@/lib/authorities";
import { assignedTeamFor, handlingStage } from "@/lib/handling";
import { hazardLabel, teamFocusLabel, teamNameLabel } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";

export function IssueProgress({
  hazardType,
  status,
  assignedTeam,
  authorityName,
  etaHours,
  dueAt,
  summary,
  address,
  verifySummary,
}: {
  hazardType: string;
  status: string;
  assignedTeam?: string | null;
  authorityName?: string | null;
  etaHours?: number | null;
  dueAt?: string | null;
  summary?: string | null;
  address?: string | null;
  verifySummary?: string | null;
}) {
  const { t, locale } = useT();
  const assigned = assignedTeamFor({
    assigned_team: assignedTeam ?? null,
    authority_name: authorityName ?? null,
    status,
    hazard_type: hazardType,
  });
  const stage = handlingStage(status);
  const hasTime = etaHours != null || Boolean(dueAt);
  const dueLabel = dueAt
    ? new Date(dueAt).toLocaleString(locale === "hi" ? "hi-IN" : "en-IN")
    : null;
  const hours = etaHours ?? 0;
  const duration =
    hours <= 72 ? t("nHours", { n: hours }) : t("nDays", { n: Math.round((hours / 24) * 10) / 10 });
  const steps: { title: string; detail?: string | null }[] = [{ title: t("reportedSuccessfully") }];
  if (assigned) {
    steps.push({
      title: t("assignedTo", { name: teamNameLabel(assigned.id, locale) }),
      detail: teamFocusLabel(assigned.id, locale),
    });
  }
  if (hasTime) {
    steps.push({
      title: t("completesIn", { duration }),
      detail: dueLabel,
    });
  }
  if (stage === "done") {
    steps.push({
      title: t("doneClosed"),
      detail: verifySummary ?? t("doneDefault"),
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">
          {hazardLabel(hazardType, locale) || HAZARD_LABELS[hazardType] || hazardType}
        </div>
        {address ? <div className="text-xs text-muted-foreground">{address}</div> : null}
        {summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}
      </div>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={`${index}-${step.title}`} className="flex gap-2 text-sm">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
              {index + 1}
            </span>
            <span>
              <span className="font-medium">{step.title}</span>
              {step.detail ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{step.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {steps.length === 1 ? (
        <p className="text-xs text-muted-foreground">{t("waitingAuthority")}</p>
      ) : null}
    </div>
  );
}
