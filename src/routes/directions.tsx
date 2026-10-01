import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Navigation, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import MapPanel from "@/components/MapPanel";
import { AuthCard, useAuth } from "@/lib/auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { geocodePlace } from "@/lib/detect.functions";
import { fetchDrivingRoutes, type DrivingRoute } from "@/lib/route.functions";
import { isSafer, scorePathRisks, type RouteRiskScore } from "@/lib/safe-route";
import { useLiveReports } from "@/hooks/use-live-reports";
import { sessionRole } from "@/lib/role";
import { hazardLabel, severityLabel } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";

export const Route = createFileRoute("/directions")({
  head: () => ({
    meta: [
      { title: "DRISHTI — Safe route" },
      {
        name: "description",
        content:
          "Get turn-by-turn directions scored against verified street hazards, with a safer alternative when the fastest route is too risky.",
      },
      { property: "og:title", content: "DRISHTI — Safe route" },
    ],
  }),
  component: DirectionsPage,
});

type ScoredRoute = {
  route: DrivingRoute;
  risk: RouteRiskScore;
};

function formatKm(meters: number) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatMins(seconds: number) {
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

function DirectionsPage() {
  const { t, locale } = useT();
  const { user, loading, signOut } = useAuth();
  const { data: reports = [] } = useLiveReports(500, Boolean(user));
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromLabel, setFromLabel] = useState("");
  const [toLabel, setToLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [scored, setScored] = useState<ScoredRoute[]>([]);
  const [active, setActive] = useState<"fastest" | "safer">("fastest");

  const fastest = scored[0] ?? null;
  const safer = useMemo(() => {
    if (!fastest || scored.length < 2) return null;
    let best: ScoredRoute | null = null;
    for (const option of scored.slice(1)) {
      if (!isSafer(option.risk, fastest.risk)) continue;
      if (!best || option.risk.weighted < best.risk.weighted) best = option;
    }
    if (best && fastest.risk.crowded) return best;
    if (best && fastest.risk.uniqueCount > 0 && best.risk.uniqueCount < fastest.risk.uniqueCount) {
      return best;
    }
    return null;
  }, [fastest, scored]);

  const chosen = active === "safer" && safer ? safer : fastest;
  const mapRoutes = useMemo(() => {
    const lines = [];
    if (fastest) {
      lines.push({
        path: fastest.route.points,
        color: fastest.risk.crowded ? "#dc2626" : "#0ea5e9",
        weight: active === "fastest" || !safer ? 6 : 4,
        dashed: false,
      });
    }
    if (safer) {
      lines.push({
        path: safer.route.points,
        color: "#16a34a",
        weight: active === "safer" ? 6 : 4,
        dashed: active !== "safer",
      });
    }
    return lines;
  }, [fastest, safer, active]);

  async function resolveFrom(): Promise<{ lat: number; lng: number; label: string } | null> {
    if (fromQuery.trim().length >= 2) {
      const place = await geocodePlace({ data: { query: fromQuery.trim() } });
      if (!place?.lat || !place.lng) {
        toast.error(t("placeNotFound"));
        return null;
      }
      return { lat: place.lat, lng: place.lng, label: place.address ?? fromQuery };
    }
    if (!navigator.geolocation) {
      toast.error(t("noDeviceLocation"));
      return null;
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            label: t("youAreHere"),
          }),
        () => {
          toast.error(t("locationNeededRange"));
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000 },
      );
    });
  }

  async function plan() {
    if (!toQuery.trim()) {
      toast.error(t("enterDestination"));
      return;
    }
    setBusy(true);
    try {
      const start = await resolveFrom();
      if (!start) return;
      const dest = await geocodePlace({ data: { query: toQuery.trim() } });
      if (!dest?.lat || !dest.lng) {
        toast.error(t("placeNotFound"));
        return;
      }
      const routes = await fetchDrivingRoutes({
        data: {
          fromLat: start.lat,
          fromLng: start.lng,
          toLat: dest.lat,
          toLng: dest.lng,
        },
      });
      const next = routes.map((route) => ({
        route,
        risk: scorePathRisks(route.points, reports),
      }));
      setOrigin({ lat: start.lat, lng: start.lng });
      setFromLabel(start.label);
      setToLabel(dest.address ?? toQuery);
      setScored(next);
      const first = next[0];
      const alt = next.slice(1).find((option) => first && isSafer(option.risk, first.risk));
      setActive(first?.risk.crowded && alt ? "safer" : "fastest");
      if (first?.risk.crowded) {
        toast.error(t("routeRiskAlert", { n: first.risk.uniqueCount }), { duration: 10000 });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("routeFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t("checkingSignIn")}
      </div>
    );
  }

  if (!user) return <AuthCard message={t("authDirectionsMessage")} />;
  if (sessionRole() === "authority") {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t("openingDashboard")}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <Navigation className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">{t("safeRoute")}</span>
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
        <p className="text-sm text-muted-foreground">{t("safeRouteHelp")}</p>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <Input
              placeholder={t("fromPlaceholder")}
              value={fromQuery}
              onChange={(event) => setFromQuery(event.target.value)}
            />
            <Input
              placeholder={t("toPlaceholder")}
              value={toQuery}
              onChange={(event) => setToQuery(event.target.value)}
            />
            <Button onClick={() => void plan()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
              {t("getRoute")}
            </Button>
          </CardContent>
        </Card>

        {fastest?.risk.crowded ? (
          <Alert variant="destructive">
            <AlertTitle>{t("routeRiskTitle")}</AlertTitle>
            <AlertDescription>
              {t("routeRiskAlert", { n: fastest.risk.uniqueCount })}
              {safer ? ` ${t("saferAvailable")}` : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        {safer ? (
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>{t("saferRouteTitle")}</AlertTitle>
            <AlertDescription>
              {t("saferRouteBody", {
                n: safer.risk.uniqueCount,
                skip: fastest ? fastest.risk.uniqueCount - safer.risk.uniqueCount : 0,
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        {scored.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={active === "fastest" ? "default" : "secondary"}
              onClick={() => setActive("fastest")}
            >
              {t("fastestRoute")} · {fastest ? formatMins(fastest.route.duration) : ""} ·{" "}
              {t("risksOnRoute", { n: fastest?.risk.uniqueCount ?? 0 })}
            </Button>
            {safer ? (
              <Button
                size="sm"
                variant={active === "safer" ? "default" : "secondary"}
                onClick={() => setActive("safer")}
              >
                {t("saferRoute")} · {formatMins(safer.route.duration)} ·{" "}
                {t("risksOnRoute", { n: safer.risk.uniqueCount })}
              </Button>
            ) : null}
          </div>
        ) : null}

        <MapPanel
          reports={(chosen?.risk.hazards ?? []).map((item) => ({
            id: item.id,
            lat: item.lat,
            lng: item.lng,
            hazard_type: item.hazard_type,
            severity: item.severity,
            risk_score: item.risk_score,
            summary: item.summary,
            address: item.address,
            created_at: "",
          }))}
          height={480}
          origin={origin}
          routes={mapRoutes}
        />

        {chosen ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("routeSummary")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  {fromLabel} → {toLabel}
                </div>
                <div className="text-muted-foreground">
                  {formatKm(chosen.route.distance)} · {formatMins(chosen.route.duration)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{t("risksOnRoute", { n: chosen.risk.uniqueCount })}</Badge>
                  <Badge variant="outline">{t("verifiedOnly")}</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("risksAlongRoute")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {chosen.risk.hazards.map((item) => (
                  <div key={item.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="font-medium">{hazardLabel(item.hazard_type, locale)}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("riskBadge", {
                        severity: severityLabel(item.severity, locale),
                        score: item.risk_score,
                      })}{" "}
                      · {t("metersAway", { n: item.meters })}
                      {item.address ? ` · ${item.address}` : ""}
                    </div>
                  </div>
                ))}
                {chosen.risk.hazards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noRisksOnRoute")}</p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {chosen?.route.steps.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("turnByTurn")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {chosen.route.steps.map((step, index) => (
                  <li key={`${index}-${step.instruction}`} className="flex gap-2 text-sm">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                      {index + 1}
                    </span>
                    <span>
                      <span className="font-medium">{step.instruction}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatKm(step.distance)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
