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
  const steps = [
    { title: "Reported successfully", done: true },
    {
      title: assigned ? `Assigned to ${assigned.name}` : "Waiting for municipal assignment",
      detail: assigned ? assigned.focus : "The authority dashboard assigns a field team.",
      done: Boolean(assigned),
    },
    {
      title: hasTime
        ? `Completes in ${formatResolution(etaHours ?? 0)}`
        : "Waiting for time allocation",
      detail: hasTime ? dueLabel : "The authority sets how long the repair should take.",
      done: hasTime || stage === "done",
    },
    {
      title: stage === "done" ? "Done and closed" : "Waiting for verified repair photo",
      detail:
        stage === "done"
          ? (verifySummary ?? "AI confirmed the street no longer shows the reported issue.")
          : "The authority uploads a photo of the fixed street. AI must find no remaining issue.",
      done: stage === "done",
    },
  ];

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
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {index + 1}
            </span>
            <span>
              <span className={step.done ? "font-medium" : "text-muted-foreground"}>
                {step.title}
              </span>
              {step.detail ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{step.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
