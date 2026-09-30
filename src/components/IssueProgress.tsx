import { HAZARD_LABELS } from "@/lib/authorities";
import { assignedTeamFor, formatResolution, handlingStage } from "@/lib/handling";

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
  const assigned = assignedTeamFor({
    assigned_team: assignedTeam,
    authority_name: authorityName,
    status,
    hazard_type: hazardType,
  });
  const stage = handlingStage(status);
  const hasTime = etaHours != null || Boolean(dueAt);
  const dueLabel = dueAt ? new Date(dueAt).toLocaleString() : null;
  const steps: { title: string; detail?: string | null }[] = [{ title: "Reported successfully" }];
  if (assigned) {
    steps.push({
      title: `Assigned to ${assigned.name}`,
      detail: assigned.focus,
    });
  }
  if (hasTime) {
    steps.push({
      title: `Completes in ${formatResolution(etaHours ?? 0)}`,
      detail: dueLabel,
    });
  }
  if (stage === "done") {
    steps.push({
      title: "Done and closed",
      detail: verifySummary ?? "AI confirmed the street no longer shows the reported issue.",
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">{HAZARD_LABELS[hazardType] ?? hazardType}</div>
        {address ? <div className="text-xs text-muted-foreground">{address}</div> : null}
        {summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}
      </div>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-2 text-sm">
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
        <p className="text-xs text-muted-foreground">
          Team assignment, time, and completion will show here only after the municipal authority
          updates this report.
        </p>
      ) : null}
    </div>
  );
}
