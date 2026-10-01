import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import MapPanel from "@/components/MapPanel";
import { fetchAlerts } from "@/lib/reports";
import { useLiveReports } from "@/hooks/use-live-reports";
import { riskColor } from "@/lib/authorities";
import { IssueProgress } from "@/components/IssueProgress";
import { AuthCard, useAuth } from "@/lib/auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { hazardLabel } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "DRISHTI — Live Urban Risk Map of India" },
      {
        name: "description",
        content:
          "A shared live map of street hazards reported across India, colour-coded by risk, with the log of alerts raised with civic authorities.",
      },
      { property: "og:title", content: "DRISHTI — Live Urban Risk Map of India" },
      {
        property: "og:description",
        content:
          "Every reported pothole, garbage pile and waterlogged stretch, plotted and colour-coded by risk.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

const FILTERS = ["all", "pothole", "garbage", "waterlogging", "other"] as const;

function MapPage() {
  const { t, locale } = useT();
  const { user, loading, signOut } = useAuth();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const { data: reports = [] } = useLiveReports(500, Boolean(user));
  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => fetchAlerts(50),
    enabled: Boolean(user),
  });

  const filtered = useMemo(() => {
    if (filter === "all") return reports;
    if (filter === "other")
      return reports.filter((r) => !["pothole", "garbage", "waterlogging"].includes(r.hazard_type));
    return reports.filter((r) => r.hazard_type === filter);
  }, [reports, filter]);

  const counts = useMemo(
    () => ({
      critical: reports.filter((r) => r.severity === "critical").length,
      high: reports.filter((r) => r.severity === "high").length,
      open: reports.filter((r) => r.status === "open").length,
    }),
    [reports],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t("checkingSignIn")}
      </div>
    );
  }

  if (!user) {
    return <AuthCard message={t("authMapMessage")} />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <Radar className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">{t("liveRiskMap")}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/range">
              <Button variant="secondary" size="sm">
                {t("rangeRiskScan")}
              </Button>
            </Link>
            <Link to="/">
              <Button variant="secondary" size="sm">
                <ArrowLeft className="size-4" /> {t("scanStreet")}
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              {t("signOut")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{reports.length}</div>
              <div className="text-sm text-muted-foreground">{t("reportsOnMap")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-destructive">
                {counts.critical + counts.high}
              </div>
              <div className="text-sm text-muted-foreground">{t("highOrCritical")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{alerts.length}</div>
              <div className="text-sm text-muted-foreground">{t("alertsRaised")}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "secondary"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? t("everything") : hazardLabel(f, locale)}
            </Button>
          ))}
        </div>

        <MapPanel reports={filtered} height={520} />
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: riskColor(10) }} />{" "}
            {t("green")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: riskColor(50) }} />{" "}
            {t("yellow")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: riskColor(80) }} />{" "}
            {t("red")}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("reportedHazards")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filtered.slice(0, 20).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <IssueProgress
                    hazardType={r.hazard_type}
                    status={r.status}
                    assignedTeam={r.assigned_team}
                    authorityName={r.authority_name}
                    etaHours={r.eta_hours}
                    dueAt={r.due_at}
                    summary={r.summary}
                    address={r.address}
                    verifySummary={r.verify_summary}
                    items={r.items}
                  />
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("nothingReported")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("alertLog")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.authority_name}</span>
                    <Badge variant="secondary" className="capitalize">
                      {a.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{a.authority_dept}</div>
                  <p className="mt-1 text-muted-foreground">{a.message}</p>
                </div>
              ))}
              {alerts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("noAlerts")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
