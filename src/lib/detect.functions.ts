import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type DetectedItem = {
  type: string;
  label: string;
  count: number;
  severity: number;
  confidence: number;
  note: string;
};

export type Detection = {
  hazardDetected: boolean;
  primaryType: string;
  riskScore: number;
  confidence: number;
  summary: string;
  items: DetectedItem[];
  locationGuess: { text: string; confidence: number } | null;
};

const SYSTEM = `You are an urban hazard inspector for Indian streets. You look at a street image and list EVERY visible civic hazard, including very small ones.

Detect and count: potholes, cracked or damaged road surface, waterlogging or stagnant water, garbage piles, scattered litter (count individual small items such as wrappers, plastic bottles, cups, cigarette packets, polythene bags), overflowing bins, construction debris, open manholes or drains, broken footpaths, and any other traffic or public-safety risk.

Be exhaustive about small litter: scan the whole frame including road edges, gutters, kerbs and background.

Return ONLY minified JSON, no markdown fence, in this exact shape:
{"hazardDetected":boolean,"primaryType":"pothole|waterlogging|garbage|debris|open_manhole|broken_footpath|damaged_road|traffic_hazard|stagnant_water|other","riskScore":0-100,"confidence":0-1,"summary":"one or two sentences in plain English","items":[{"type":"...","label":"short human label","count":number,"severity":1-5,"confidence":0-1,"note":"where in the frame and how bad"}],"locationGuess":{"text":"place guessed from signboards, shop names, vehicle number plates or landmarks — include city/state if visible","confidence":0-1}}

If nothing is visible, set hazardDetected false, riskScore 0 and items []. If no location clue is visible, set locationGuess null. riskScore must reflect danger to people: deep potholes on a busy road or an open manhole are 80+, heavy waterlogging 60-85, large garbage piles 45-70, scattered litter 15-35.`;

function safeJson(text: string): Detection | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1));
    return {
      hazardDetected: Boolean(raw.hazardDetected),
      primaryType: String(raw.primaryType ?? "other"),
      riskScore: Math.max(0, Math.min(100, Number(raw.riskScore ?? 0))),
      confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
      summary: String(raw.summary ?? ""),
      items: Array.isArray(raw.items)
        ? raw.items.map((i: Record<string, unknown>) => ({
            type: String(i.type ?? "other"),
            label: String(i.label ?? i.type ?? "hazard"),
            count: Number(i.count ?? 1),
            severity: Number(i.severity ?? 1),
            confidence: Number(i.confidence ?? 0.5),
            note: String(i.note ?? ""),
          }))
        : [],
      locationGuess:
        raw.locationGuess && raw.locationGuess.text
          ? {
              text: String(raw.locationGuess.text),
              confidence: Number(raw.locationGuess.confidence ?? 0.3),
            }
          : null,
    };
  } catch {
    return null;
  }
}

export const analyzeFrame = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        image: z.string().min(32),
        hint: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<Detection> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured on this project.");

    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: data.hint
                  ? `Inspect this street image. Context from the reporter: ${data.hint}`
                  : "Inspect this street image and list every hazard, however small.",
              },
              { type: "image_url", image_url: { url: data.image } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Too many checks at once — wait a few seconds and try again.");
      if (res.status === 402) throw new Error("AI credits for this project are exhausted. Add credits to continue.");
      throw new Error(`Analysis failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = safeJson(text);
    if (!parsed) throw new Error("Could not read the analysis result. Try another frame.");
    return parsed;
  });

export type PlaceInfo = {
  address: string | null;
  road: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
};

async function nominatim(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "UrbanRiskWatch/1.0 (civic hazard reporting, India)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Location lookup failed (${res.status})`);
  return res.json();
}

function pick(addr: Record<string, string> | undefined, keys: string[]) {
  if (!addr) return null;
  for (const k of keys) if (addr[k]) return addr[k];
  return null;
}

export const reverseGeocode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ lat: z.number(), lng: z.number() }).parse(data))
  .handler(async ({ data }): Promise<PlaceInfo> => {
    const json = (await nominatim(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${data.lat}&lon=${data.lng}`,
    )) as { display_name?: string; address?: Record<string, string> };
    return {
      address: json.display_name ?? null,
      road: pick(json.address, ["road", "pedestrian", "footway", "highway", "neighbourhood"]),
      city: pick(json.address, ["city", "town", "village", "municipality", "suburb", "county"]),
      state: pick(json.address, ["state"]),
      lat: data.lat,
      lng: data.lng,
    };
  });

export const geocodePlace = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ query: z.string().min(2) }).parse(data))
  .handler(async ({ data }): Promise<PlaceInfo | null> => {
    const q = encodeURIComponent(`${data.query}, India`);
    const json = (await nominatim(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=in&limit=1&q=${q}`,
    )) as Array<{ lat: string; lon: string; display_name: string; address?: Record<string, string> }>;
    const hit = json?.[0];
    if (!hit) return null;
    return {
      address: hit.display_name,
      road: pick(hit.address, ["road", "pedestrian", "footway", "highway", "neighbourhood"]),
      city: pick(hit.address, ["city", "town", "village", "municipality", "suburb", "county"]),
      state: pick(hit.address, ["state"]),
      lat: Number(hit.lat),
      lng: Number(hit.lon),
    };
  });
