import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { composeSummary, parseAnalysis, type HazardSceneAnalysis } from "@/lib/hazard-analysis";

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
  analysis: HazardSceneAnalysis | null;
};

const JSON_SHAPE = `{"hazardDetected":boolean,"primaryType":"pothole|waterlogging|garbage|debris|open_manhole|broken_footpath|damaged_road|traffic_hazard|stagnant_water|person|phone|other","riskScore":0-100,"confidence":0-1,"summary":"short factual description of every street issue","items":[{"type":"...","label":"...","count":number,"severity":1-5,"confidence":0-1,"note":"size/depth/water details for that object"}],"locationGuess":{"text":"place from signs or landmarks","confidence":0-1},"analysis":{"assessment":"how each issue looks and why it is a risk","depthClass":"none|surface|shallow|moderate|deep|severe","depthCm":number|null,"depthCmMin":number|null,"depthCmMax":number|null,"widthCm":number|null,"lengthCm":number|null,"waterPresent":boolean,"waterDepthCm":number|null,"waterDepthClass":"none|surface|shallow|moderate|deep|severe","waterObscuresBottom":boolean,"cues":"which scale cues you used","caveats":"what is uncertain"}}`;

const SYSTEM = `You inspect one street photo like a municipal surveyor. Name only what is actually visible. Be precise.

Label every person as type "person" and label "Person". Label every mobile phone as type "phone" and label "Phone". Label every vehicle by what it is: Car, Bus, Truck, Motorcycle, Bicycle, Train, Boat, or Airplane, with type "vehicle". Label other recognizable objects by their own name with type "other". Label only loose clutter — wrappers, bottles, cups, food waste, packets, and discarded rubbish — as type "garbage" and label "Garbage". Never label a person, phone, vehicle, animal, or other recognizable object as garbage.

Also list every street hazard that is visible: potholes, damaged road, waterlogging, stagnant water, debris, open manholes, broken footpaths, broken streetlights, traffic hazards. Use type "streetlight" for a broken streetlight. If a pothole is filled with water, list BOTH pothole and waterlogging (or stagnant_water if it is still/mosquito-prone). Do not hide a cavity just because water covers it.

DEPTH AND SIZE (required whenever a pothole, open manhole, broken pavement, or standing water is visible):
Estimate centimetres using visible scale. Prefer, in order: manhole cover ~60 cm, brick ~19×9 cm, kerb rise ~10–15 cm, lane marking dash ~150×10 cm in India, car tyre sidewall, motorcycle wheel ~40–50 cm, adult shoe ~25–30 cm, drain grate, paving tile. Convert pixel span of the cavity rim to cm from those references. Infer depth from: rim-to-floor drop, shadow inside the hole, how much of a wheel or kerb is swallowed, broken slab thickness, and perspective foreshortening. Give a best estimate (depthCm) plus a tight range (depthCmMin/Max). Classes: surface <2 cm, shallow 2–5, moderate 5–15, deep 15–30, severe >30.

WATERLOGGED POTHOLES: Treat the water surface as a minimum depth, not the true floor. Measure water depth from the rim using the waterline on kerbs, tyres, debris, or the drop from asphalt edge to the meniscus. If the floor is not visible (turbid, dark, rippled, or no texture on the bottom), set waterObscuresBottom true and set cavity depthCm ABOVE the water depth — typically water depth plus at least 3–10 cm extra unless a clear bottom is seen. Distinguish sheet flooding on a flat road (waterPresent, depthClass none or surface, primaryType waterlogging) from a water-filled crater (primaryType pothole, waterPresent true). Darker, still, debris-trapping pools are usually deeper than bright shallow sheets.

Analyse every issue properly: count, severity, whether it sits in a wheel path, if it can burst a tyre or stall a two-wheeler, garbage volume, open drain risk, broken light at night. Put numbers in analysis and in each item.note.

Return ONLY minified JSON:
${JSON_SHAPE}

hazardDetected is true only for a street hazard, including garbage. A person or phone alone is not a hazard: riskScore 0. Open manhole or severe/deep pothole 80+, water-filled pothole with hidden floor 85+, heavy water 60–85, large garbage 45–70, scattered clutter 15–35. If nothing is visible, hazardDetected false, riskScore 0, items [], analysis null. If no place is visible, locationGuess null. Never invent a depth when no cavity or water is visible — use depthClass "none" and null centimetres.`;

const VERIFY_SYSTEM = `You compare two street photos of the same place: the original hazard report, then a later photo after municipal work.

Score remaining street risk in the RECENT photo only (0-100). Compare it with the original so you can tell if the reported issue improved.

Look for remaining potholes, damaged road, garbage piles, waterlogging, broken streetlights, open manholes, debris, or other street hazards. Re-estimate remaining cavity depth and standing-water depth with the same centimetre method as a survey (scale from kerbs, tyres, bricks, manhole covers). A filled/patched surface should have depthClass none or surface.

Return ONLY minified JSON:
${JSON_SHAPE}

riskScore is the remaining risk in the recent photo. Below 40 is low. If the original issue is gone or only a faint trace remains, riskScore below 40, hazardDetected false. If the recent photo still clearly shows the same or a similar street hazard, riskScore 40 or higher and hazardDetected true.`;

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
    const analysis = parseAnalysis(raw.analysis);
    return {
      hazardDetected: Boolean(raw.hazardDetected),
      primaryType: String(raw.primaryType ?? "other"),
      riskScore: Math.max(0, Math.min(100, Number(raw.riskScore ?? 0))),
      confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0))),
      summary: composeSummary(String(raw.summary ?? ""), analysis),
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
      analysis,
    };
  } catch {
    return null;
  }
}

async function completeVision(
  system: string,
  userText: string,
  images: string[],
): Promise<Detection> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured on this project.");

  const imageParts = images.filter(Boolean).map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

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
          content: [{ type: "text", text: userText }, ...imageParts],
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
        ? `Inspect this street image. Context from the reporter: ${data.hint} Estimate pothole and water depth in centimetres even if waterlogged.`
        : "Inspect this street image. List every hazard. Estimate pothole and water depth in centimetres even if the hole is waterlogged. Analyse each issue accurately.",
      [data.image],
    );
  });

export const verifyRepair = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        image: z.string().min(32),
        originalImage: z.string().min(32).optional(),
        originalType: z.string().optional(),
        originalRisk: z.number().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<Detection> => {
    const original = data.originalType
      ? ` The original report was for ${data.originalType}${
          data.originalRisk != null ? ` with risk ${Math.round(data.originalRisk)}/100` : ""
        }.`
      : "";
    const images = data.originalImage ? [data.originalImage, data.image] : [data.image];
    const prompt = data.originalImage
      ? `Image 1 is the original report photo. Image 2 is a later photo of the same place after work.${original} Compare them, re-estimate remaining cavity and water depth in centimetres, and score remaining risk in image 2.`
      : `This is a later photo of the reported place after work.${original} Score remaining street risk and remaining depth.`;
    return completeVision(VERIFY_SYSTEM, prompt, images);
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
