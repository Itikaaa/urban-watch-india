import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Radar, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import MapPanel from "@/components/MapPanel";
import { IssueProgress } from "@/components/IssueProgress";
import { AuthCard, useAuth } from "@/lib/auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useRangeRiskScan } from "@/hooks/use-range-risk-scan";
import { RANGE_SCAN_METERS } from "@/lib/range-scan";
import { hazardLabel, severityLabel } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";
import { riskColor } from "@/lib/authorities";
import { sessionRole } from "@/lib/role";

export const Route = createFileRoute("/range")({
  head: () => ({
    meta: [
      { title: "DRISHTI — Range risk scan" },
      {
        name: "description",
        content:
          "Scan a 1 km range around you. Severe street hazards inside that circle trigger an automatic alert.",
      },
      { property: "og:title", content: "DRISHTI — Range risk scan" },
    ],
  }),
  component: RangePage,
});

function RangePage() {
  const { t, locale } = useT();
  const { user, loading, signOut } = useAuth();
  const enabled = Boolean(user) && sessionRole() !== "authority";
  const { origin, locating, nearby, severe, locate, reports } = useRangeRiskScan({
    enabled,
    autoLocate: enabled,
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t("checkingSignIn")}
      </div>
    );
  }

  if (!user) return <AuthCard message={t("authRangeMessage")} />;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <Radar className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">{t("rangeRiskScan")}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/map">
              <Button variant="secondary" size="sm">
                {t("liveRiskMap")}
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
        <p className="text-sm text-muted-foreground">{t("rangeRiskScanHelp")}</p>

        {severe.length > 0 ? (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>{t("severeNearbyTitle")}</AlertTitle>
            <AlertDescription>{t("severeNearbyBody", { n: severe.length })}</AlertDescription>
          </Alert>
        ) : origin ? (
          <Alert>
            <AlertTitle>{t("rangeClear")}</AlertTitle>
            <AlertDescription>{t("noSevereNearby")}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{t("rangeRadius")}</div>
              <div className="text-sm text-muted-foreground">{t("withinRange")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{nearby.length}</div>
              <div className="text-sm text-muted-foreground">{t("nearbyHazards")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-destructive">{severe.length}</div>
              <div className="text-sm text-muted-foreground">{t("highOrCritical")}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => locate()} disabled={locating}>
            {locating ? t("locatingYou") : t("startRangeScan")}
          </Button>
        </div>

        <MapPanel
          reports={reports}
          height={520}
          focus={origin}
          origin={origin}
          rangeMeters={RANGE_SCAN_METERS}
        />
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: "#38bdf8" }} /> {t("youAreHere")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: riskColor(80) }} /> {t("red")}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: riskColor(50) }} /> {t("yellow")}
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("nearbyHazards")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {nearby.map((report) => (
              <div key={report.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge>{hazardLabel(report.hazard_type, locale)}</Badge>
                  <Badge variant={report.risk_score >= 70 ? "destructive" : "outline"}>
                    {t("riskBadge", {
                      severity: severityLabel(report.severity, locale),
                      score: report.risk_score,
                    })}
                  </Badge>
                  <Badge variant="secondary">{t("metersAway", { n: report.meters })}</Badge>
                </div>
                <IssueProgress
                  hazardType={report.hazard_type}
                  status={report.status}
                  summary={report.summary}
                  address={report.address}
                />
              </div>
            ))}
            {origin && nearby.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noNearbyHazards")}</p>
            ) : null}
            {!origin ? (
              <p className="text-sm text-muted-foreground">{t("locationNeededRange")}</p>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
