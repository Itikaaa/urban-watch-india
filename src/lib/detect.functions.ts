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

const SYSTEM = `You look at one camera frame and name only what is visible.

Label every person as type "person" and label "Person". Label every mobile phone as type "phone" and label "Phone". Label every vehicle by what it is: Car, Bus, Truck, Motorcycle, Bicycle, Train, Boat, or Airplane, with type "vehicle". Label other recognizable objects by their own name (Chair, Dog, Bag, and so on) with type "other". Label only loose clutter — wrappers, bottles, cups, food waste, packets, and discarded rubbish — as type "garbage" and label "Garbage". Never label a person, phone, vehicle, animal, or other recognizable object as garbage.

Also list street hazards: potholes, damaged road, waterlogging, stagnant water, debris, open manholes, broken footpaths, broken streetlights, traffic hazards. Use type "streetlight" for a broken streetlight.

Return ONLY minified JSON:
{"hazardDetected":boolean,"primaryType":"pothole|waterlogging|garbage|debris|open_manhole|broken_footpath|damaged_road|traffic_hazard|stagnant_water|person|phone|other","riskScore":0-100,"confidence":0-1,"summary":"short count of what is visible","items":[{"type":"...","label":"Person|Phone|Garbage or the hazard name","count":number,"severity":1-5,"confidence":0-1,"note":""}],"locationGuess":{"text":"place from signs or landmarks","confidence":0-1}}

hazardDetected is true only for a street hazard, including garbage. A person or phone alone is not a hazard: riskScore 0. Open manhole or deep pothole 80+, heavy water 60-85, large garbage 45-70, scattered clutter 15-35. If nothing is visible, hazardDetected false, riskScore 0, items []. If no place is visible, locationGuess null.`;

const VERIFY_SYSTEM = `You inspect a photo taken after a municipal street repair.

Decide whether any street hazard is still visible. Look for potholes, damaged road, garbage piles, waterlogging, broken streetlights, open manholes, debris, or other street hazards.

Return ONLY minified JSON:
{"hazardDetected":boolean,"primaryType":"pothole|waterlogging|garbage|debris|open_manhole|broken_footpath|damaged_road|traffic_hazard|stagnant_water|other","riskScore":0-100,"confidence":0-1,"summary":"short verdict","items":[{"type":"...","label":"...","count":number,"severity":1-5,"confidence":0-1,"note":""}],"locationGuess":null}

hazardDetected is true only if a street hazard is still clearly visible. A repaired or clear road, ordinary traffic, wet but drained pavement, or people and vehicles are not hazards: hazardDetected false, riskScore 0, items [].`;

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
            type: String(i["type"] ?? "other"),
            label: String(i["label"] ?? i["type"] ?? "hazard"),
            count: Number(i["count"] ?? 1),
            severity: Number(i["severity"] ?? 1),
            confidence: Number(i["confidence"] ?? 0.5),
            note: String(i["note"] ?? ""),
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

async function completeVision(system: string, userText: string, image: string): Promise<Detection> {
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
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429)
      throw new Error("Too many checks at once — wait a few seconds and try again.");
    if (res.status === 402)
      throw new Error("AI credits for this project are exhausted. Add credits to continue.");
    throw new Error(`Analysis failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? "";
  const parsed = safeJson(text);
  if (!parsed) throw new Error("Could not read the analysis result. Try another frame.");
  return parsed;
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
    return completeVision(
      SYSTEM,
      data.hint
        ? `Inspect this street image. Context from the reporter: ${data.hint}`
        : "Inspect this street image and list every hazard, however small.",
      data.image,
    );
  });

export const verifyRepair = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        image: z.string().min(32),
        originalType: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<Detection> => {
    const original = data.originalType ? ` The original report was for ${data.originalType}.` : "";
    return completeVision(
      VERIFY_SYSTEM,
      `This is a completion photo of a repaired street.${original} Say if any street hazard remains.`,
      data.image,
    );
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
    )) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      address?: Record<string, string>;
    }>;
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
