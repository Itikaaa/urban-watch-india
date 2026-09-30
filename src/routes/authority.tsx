import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IssueProgress } from "@/components/IssueProgress";
import { fetchReports } from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard, useAuth } from "@/lib/auth";
import { handlingStage, teamForHazard } from "@/lib/handling";
import { sessionRole } from "@/lib/role";

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
  const { data: reports = [] } = useQuery({
    queryKey: ["reports"],
    queryFn: () => fetchReports(200),
    enabled: Boolean(user),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!loading && user && sessionRole() !== "authority") {
      void navigate({ to: "/" });
    }
  }, [loading, user, navigate]);

  async function assign(id: string, hazardType: string) {
    const team = teamForHazard(hazardType);
    setSavingId(id);
    const { error } = await supabase
      .from("reports")
      .update({
        status: "assigned",
        authority_name: team.name,
        authority_dept: `${team.name} — ${team.focus}`,
      })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Assigned to ${team.name}`);
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
  }

  async function closeIssue(id: string) {
    setSavingId(id);
    const { error } = await supabase.from("reports").update({ status: "done" }).eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marked done and closed");
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
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
        {reports.map((report) => {
          const stage = handlingStage(report.status);
          const team = teamForHazard(report.hazard_type);
          return (
            <Card key={report.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">{team.name}</CardTitle>
                <Badge variant="outline" className="capitalize">
                  {stage}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <IssueProgress
                  hazardType={report.hazard_type}
                  status={report.status}
                  riskScore={report.risk_score}
                  createdAt={report.created_at}
                  summary={report.summary}
                  address={report.address}
                />
                <div className="flex flex-wrap gap-2">
                  {stage === "reported" && (
                    <Button
                      size="sm"
                      disabled={savingId === report.id}
                      onClick={() => void assign(report.id, report.hazard_type)}
                    >
                      Assign to {team.name}
                    </Button>
                  )}
                  {stage === "assigned" && (
                    <Button
                      size="sm"
                      disabled={savingId === report.id}
                      onClick={() => void closeIssue(report.id)}
                    >
                      Mark done
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {reports.length === 0 && <p className="text-sm text-muted-foreground">No reports yet.</p>}
      </main>
    </div>
  );
}
