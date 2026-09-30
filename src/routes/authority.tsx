import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IssueProgress } from "@/components/IssueProgress";
import type { ReportRow } from "@/lib/reports";
import {
  reportImageDataUrl,
  signedImageUrl,
  updateReportHandling,
  uploadHazardImage,
} from "@/lib/reports";
import { AuthCard, useAuth } from "@/lib/auth";
import {
  assignedTeamFor,
  dueFromEta,
  formatResolution,
  handlingStage,
  remainingRiskIsLow,
  resolutionHours,
  TEAMS,
  teamForHazard,
} from "@/lib/handling";
import { sessionRole } from "@/lib/role";
import { verifyRepair } from "@/lib/detect.functions";
import { useLiveReports } from "@/hooks/use-live-reports";

export const Route = createFileRoute("/authority")({
  head: () => ({
    meta: [{ title: "Municipal dashboard — SadakSafe" }],
  }),
  component: AuthorityPage,
});

function AuthorityPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState<string | null>(null);
  const { data: reports = [] } = useLiveReports(200, Boolean(user));

  useEffect(() => {
    if (!loading && user && sessionRole() !== "authority") {
      void navigate({ to: "/" });
    }
  }, [loading, user, navigate]);

  async function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
  }

  function putReport(updated: ReportRow) {
    queryClient.setQueriesData({ queryKey: ["reports"] }, (old: ReportRow[] | undefined) =>
      old?.map((row) => (row.id === updated.id ? updated : row)),
    );
  }

  async function assignTeam(report: ReportRow, teamId: string) {
    const team = Object.values(TEAMS).find((item) => item.id === teamId);
    if (!team) return;
    setSavingId(report.id);
    try {
      const updated = await updateReportHandling(report, { status: "assigned", team });
      putReport(updated);
      toast.success(`Assigned to ${team.name} — visible on the reporter's progress.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign this team.");
    } finally {
      setSavingId(null);
    }
  }

  async function allocateTime(report: ReportRow, hoursRaw: string) {
    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours) || hours < 1) {
      toast.error("Enter how many hours the team has to finish.");
      return;
    }
    setSavingId(report.id);
    try {
      const due = dueFromEta(report.created_at, hours).toISOString();
      const updated = await updateReportHandling(report, {
        etaHours: Math.round(hours),
        dueAt: due,
      });
      putReport(updated);
      toast.success(
        `Time set to ${formatResolution(Math.round(hours))} — updated for the reporter.`,
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the time allocation.");
    } finally {
      setSavingId(null);
    }
  }

  async function closeWithProof(report: ReportRow, dataUrl: string) {
    setSavingId(report.id);
    try {
      const originalImage = await reportImageDataUrl(report.image_path);
      const check = await verifyRepair({
        data: {
          image: dataUrl,
          originalImage: originalImage ?? undefined,
          originalType: report.hazard_type,
          originalRisk: report.risk_score,
        },
      });
      if (!remainingRiskIsLow(check)) {
        toast.error(
          check.summary ||
            `Remaining risk is ${Math.round(check.riskScore)}/100. Upload a clearer photo of the repaired place — it must score as low risk to close.`,
        );
        return;
      }
      const proofPath = await uploadHazardImage(dataUrl);
      const updated = await updateReportHandling(report, {
        status: "done",
        proofPath,
        verify:
          check.summary || `AI scored remaining risk ${Math.round(check.riskScore)}/100 (low).`,
        afterRisk: check.riskScore,
      });
      putReport(updated);
      toast.success(
        `Remaining risk ${Math.round(check.riskScore)}/100 (low). Closed for the reporter.`,
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not verify the repair photo.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Checking your sign-in…
      </div>
    );
  }

  if (!user) return <AuthCard message="Sign in as the municipal authority." />;

  const open = reports.filter((report) => handlingStage(report.status) !== "done");

  return (
    <div className="min-h-screen">
      <header className="border-b border-border" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <Radar className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">Municipal dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/map">
              <Button variant="secondary" size="sm">
                Map
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <p className="text-sm text-muted-foreground">
          Assign a team and allocate time here — both save immediately and then appear on the
          reporter's incident list. To close an assigned issue, upload a new photo of the same
          place. AI compares it with the original and closes the report only if remaining risk is
          low.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          {(["garbage", "pothole", "streetlight", "water"] as const).map((key) => {
            const team = teamForHazard(
              key === "garbage"
                ? "garbage"
                : key === "pothole"
                  ? "pothole"
                  : key === "streetlight"
                    ? "streetlight"
                    : "waterlogging",
            );
            const count = open.filter(
              (report) => teamForHazard(report.hazard_type).id === team.id,
            ).length;
            return (
              <Card key={team.id}>
                <CardContent className="pt-6">
                  <div className="text-sm font-medium">{team.name}</div>
                  <div className="text-xs text-muted-foreground">{team.focus}</div>
                  <div className="mt-2 text-2xl font-bold">{count}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {reports.map((report) => (
          <AuthorityReportCard
            key={report.id}
            report={report}
            busy={savingId === report.id}
            onAssign={(teamId) => void assignTeam(report, teamId)}
            onAllocate={(hours) => void allocateTime(report, hours)}
            onClose={(image) => void closeWithProof(report, image)}
          />
        ))}
        {reports.length === 0 && <p className="text-sm text-muted-foreground">No reports yet.</p>}
      </main>
    </div>
  );
}

function AuthorityReportCard({
  report,
  busy,
  onAssign,
  onAllocate,
  onClose,
}: {
  report: ReportRow;
  busy: boolean;
  onAssign: (teamId: string) => void;
  onAllocate: (hours: string) => void;
  onClose: (image: string) => void;
}) {
  const suggested = teamForHazard(report.hazard_type);
  const assigned = assignedTeamFor(report);
  const stage = handlingStage(report.status);
  const [teamId, setTeamId] = useState(assigned?.id ?? suggested.id);
  const [hours, setHours] = useState(
    String(report.eta_hours ?? resolutionHours(report.risk_score)),
  );
  const [proof, setProof] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (assigned?.id) setTeamId(assigned.id);
  }, [assigned?.id]);

  useEffect(() => {
    if (report.eta_hours != null) setHours(String(report.eta_hours));
  }, [report.eta_hours]);

  useEffect(() => {
    let cancelled = false;
    void signedImageUrl(report.image_path).then((url) => {
      if (!cancelled) setPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [report.image_path]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{assigned?.name ?? "Unassigned"}</CardTitle>
        <Badge variant="outline" className="capitalize">
          {stage}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview ? (
          <img src={preview} alt="" className="max-h-48 w-full rounded-lg border object-cover" />
        ) : null}
        <IssueProgress
          hazardType={report.hazard_type}
          status={report.status}
          assignedTeam={report.assigned_team}
          authorityName={report.authority_name}
          etaHours={report.eta_hours}
          dueAt={report.due_at}
          summary={report.summary}
          address={report.address}
          verifySummary={report.verify_summary}
        />
        {stage !== "done" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label>Assign field team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a team" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TEAMS).map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name} — {team.focus}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Suggested from the report: {suggested.name}. The reporter sees this only after you
                assign.
              </p>
              <Button size="sm" disabled={busy} onClick={() => onAssign(teamId)}>
                {assigned
                  ? "Update assignment"
                  : `Assign ${Object.values(TEAMS).find((t) => t.id === teamId)?.name ?? "team"}`}
              </Button>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label htmlFor={`eta-${report.id}`}>Allocate time (hours)</Label>
              <Input
                id={`eta-${report.id}`}
                type="number"
                min={1}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Suggested {formatResolution(resolutionHours(report.risk_score))} from risk. Saved
                time is what the reporter sees.
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onAllocate(hours)}
              >
                Save time allocation
              </Button>
            </div>
          </div>
        )}
        {(stage === "assigned" || Boolean(assigned)) && stage !== "done" && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label>Photo of the same place after work</Label>
            <p className="text-xs text-muted-foreground">
              Upload a new picture of the reported location. AI compares it with the original report
              photo and scores remaining risk. The issue closes only if that score is low (under
              40/100).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {preview ? (
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Original report</div>
                  <img
                    src={preview}
                    alt=""
                    className="max-h-40 w-full rounded-lg border object-cover"
                  />
                </div>
              ) : null}
              {proof ? (
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Recent photo</div>
                  <img
                    src={proof}
                    alt=""
                    className="max-h-40 w-full rounded-lg border object-cover"
                  />
                </div>
              ) : null}
            </div>
            <Input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setProof(String(reader.result));
                reader.readAsDataURL(file);
              }}
            />
            <Button
              size="sm"
              disabled={busy || !proof}
              onClick={() => {
                if (proof) onClose(proof);
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              Compare photos and close if low risk
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
