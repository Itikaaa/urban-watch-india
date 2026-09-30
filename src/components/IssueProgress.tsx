import { HAZARD_LABELS } from "@/lib/authorities";
import {
  dueDate,
  formatResolution,
  handlingStage,
  resolutionHours,
  teamForHazard,
} from "@/lib/handling";

export function IssueProgress({
  hazardType,
  status,
  riskScore,
  createdAt,
  summary,
  address,
}: {
  hazardType: string;
  status: string;
  riskScore: number;
  createdAt: string;
  summary?: string | null;
  address?: string | null;
}) {
  const team = teamForHazard(hazardType);
  const stage = handlingStage(status);
  const hours = resolutionHours(riskScore);
  const due = dueDate(createdAt, riskScore);
  const steps = [
    { title: "Reported successfully", done: true },
    {
      title: stage === "reported" ? "Assigned" : `Assigned to ${team.name}`,
      detail: team.focus,
      done: stage !== "reported",
    },
    {
      title: `Completes in ${formatResolution(hours)}`,
      detail: due.toLocaleString(),
      done: stage === "done",
    },
    { title: "Done and closed", done: stage === "done" },
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
              {"detail" in step && step.detail ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{step.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
