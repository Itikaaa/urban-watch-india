import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const OSRM = "https://router.project-osrm.org";

export type RouteStep = {
  instruction: string;
  road: string;
  distance: number;
  duration: number;
  type: string;
  modifier: string;
};

export type DrivingRoute = {
  distance: number;
  duration: number;
  points: { lat: number; lng: number }[];
  steps: RouteStep[];
};

type OsrmStep = {
  name?: string;
  distance?: number;
  duration?: number;
  maneuver?: { type?: string; modifier?: string };
};

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { steps?: OsrmStep[] }[];
};

function instructionFor(type: string, modifier: string, road: string) {
  const place = road || "the road";
  if (type === "depart") return `Head out on ${place}`;
  if (type === "arrive") return `Arrive at ${place}`;
  if (type === "roundabout") return `Take the roundabout onto ${place}`;
  if (type === "merge") return `Merge onto ${place}`;
  if (modifier === "left" || modifier === "sharp left" || modifier === "slight left") {
    return `Turn left onto ${place}`;
  }
  if (modifier === "right" || modifier === "sharp right" || modifier === "slight right") {
    return `Turn right onto ${place}`;
  }
  if (modifier === "uturn") return `Make a U-turn onto ${place}`;
  if (type === "new name" || type === "continue" || modifier === "straight") {
    return `Continue on ${place}`;
  }
  return `Continue on ${place}`;
}

function toRoute(raw: OsrmRoute): DrivingRoute | null {
  const coords = raw.geometry?.coordinates ?? [];
  if (coords.length < 2) return null;
  const steps: RouteStep[] = [];
  for (const leg of raw.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const road = String(step.name ?? "").trim();
      const type = String(step.maneuver?.type ?? "continue");
      const modifier = String(step.maneuver?.modifier ?? "");
      steps.push({
        instruction: instructionFor(type, modifier, road),
        road,
        distance: Math.round(Number(step.distance ?? 0)),
        duration: Math.round(Number(step.duration ?? 0)),
        type,
        modifier,
      });
    }
  }
  return {
    distance: Math.round(Number(raw.distance ?? 0)),
    duration: Math.round(Number(raw.duration ?? 0)),
    points: coords.map(([lng, lat]) => ({ lat, lng })),
    steps,
  };
}

export const fetchDrivingRoutes = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        fromLat: z.number(),
        fromLng: z.number(),
        toLat: z.number(),
        toLng: z.number(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<DrivingRoute[]> => {
    const path = `${data.fromLng},${data.fromLat};${data.toLng},${data.toLat}`;
    const url = `${OSRM}/route/v1/driving/${path}?alternatives=true&steps=true&overview=full&geometries=geojson&continue_straight=false`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DRISHTI/1.0 (civic safe-route, India)",
      },
    });
    if (!res.ok) {
      throw new Error(`Could not fetch driving directions (${res.status}).`);
    }
    const json = (await res.json()) as { code?: string; routes?: OsrmRoute[] };
    if (json.code && json.code !== "Ok") {
      throw new Error("No driving route found between those places.");
    }
    const routes = (json.routes ?? [])
      .map(toRoute)
      .filter((route): route is DrivingRoute => route != null);
    if (!routes.length) throw new Error("No driving route found between those places.");
    return routes.slice(0, 3);
  });
