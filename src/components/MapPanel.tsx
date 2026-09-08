import { lazy, Suspense, useEffect, useState } from "react";
import type { MapReport } from "./HazardMap";

const HazardMap = lazy(() => import("./HazardMap"));

export default function MapPanel(props: {
  reports: MapReport[];
  height?: number;
  focus?: { lat: number; lng: number } | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const placeholder = (
    <div
      style={{ height: props.height ?? 420 }}
      className="flex w-full items-center justify-center rounded-xl border border-border bg-muted text-sm text-muted-foreground"
    >
      Loading map…
    </div>
  );

  if (!mounted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <HazardMap {...props} />
    </Suspense>
  );
}
