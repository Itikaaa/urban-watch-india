import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useLiveReports } from "@/hooks/use-live-reports";
import { hazardLabel, severityLabel } from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";
import {
  loadAlertedIds,
  RANGE_SCAN_METERS,
  reportsInRange,
  saveAlertedIds,
  severeRisksInRange,
  type RangedReport,
} from "@/lib/range-scan";

export type ScanOrigin = { lat: number; lng: number };

function notifyUser(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    /* ignore blocked notifications */
  }
}

export function useRangeRiskScan(options: { enabled: boolean; autoLocate: boolean }) {
  const { t, locale } = useT();
  const { data: reports = [] } = useLiveReports(500, options.enabled);
  const [origin, setOrigin] = useState<ScanOrigin | null>(null);
  const [locating, setLocating] = useState(false);
  const watchRef = useRef<number | null>(null);
  const alertedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    alertedRef.current = loadAlertedIds();
  }, []);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error(t("noDeviceLocation"));
      return;
    }
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error(t("locationNeededRange"));
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
    if (watchRef.current != null) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 15000 },
    );
  }, [t]);

  useEffect(() => {
    if (!options.enabled || !options.autoLocate) return;
    locate();
    return () => stopWatch();
  }, [options.enabled, options.autoLocate, locate, stopWatch]);

  const nearby = useMemo(
    () => (origin ? reportsInRange(origin, reports, RANGE_SCAN_METERS) : []),
    [origin, reports],
  );
  const severe = useMemo(() => severeRisksInRange(nearby), [nearby]);
  const severeKey = severe.map((item) => item.id).sort().join("|");

  useEffect(() => {
    if (!origin || !severe.length) return;
    const fresh: RangedReport[] = [];
    for (const report of severe) {
      if (alertedRef.current.has(report.id)) continue;
      alertedRef.current.add(report.id);
      fresh.push(report);
    }
    if (!fresh.length) return;
    saveAlertedIds(alertedRef.current);
    for (const report of fresh) {
      const place = report.address || t("located");
      const body = t("severeAlert", {
        hazard: hazardLabel(report.hazard_type, locale),
        n: report.meters,
        place,
      });
      toast.error(t("severeNearbyTitle"), { description: body, duration: 14000 });
      notifyUser(t("brand"), body);
    }
  }, [origin, severe, severeKey, locale, t]);

  return {
    origin,
    locating,
    nearby,
    severe,
    rangeMeters: RANGE_SCAN_METERS,
    locate,
    reports,
  };
}
