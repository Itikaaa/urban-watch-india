import { classifySight, containFrame, sightColor, type Sight } from "@/lib/sights";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/1/efficientdet_lite2.tflite";

type Detector = import("@mediapipe/tasks-vision").ObjectDetector;

type RawDetection = {
  categories: { categoryName: string; score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
};

type StillSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

let detectorPromise: Promise<Detector> | null = null;
let detector: Detector | null = null;
let mode: "IMAGE" | "VIDEO" = "VIDEO";

async function createDetector(): Promise<Detector> {
  const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const shared = {
    runningMode: "VIDEO" as const,
    scoreThreshold: 0.35,
    maxResults: 20,
  };
  try {
    return await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      ...shared,
    });
  } catch {
    return await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      ...shared,
    });
  }
}

export function loadDetector() {
  if (typeof window === "undefined")
    return Promise.reject(new Error("Detector runs in the browser only"));
  if (!detectorPromise) {
    detectorPromise = createDetector()
      .then((created) => {
        detector = created;
        mode = "VIDEO";
        return created;
      })
      .catch((error) => {
        detectorPromise = null;
        throw error;
      });
  }
  return detectorPromise;
}

function toSights(detections: RawDetection[]): Sight[] {
  const sights: Sight[] = [];
  for (const detection of detections) {
    const category = detection.categories[0];
    const box = detection.boundingBox;
    if (!category || !box || box.width < 8 || box.height < 8) continue;
    const classified = classifySight(category.categoryName);
    sights.push({
      kind: classified.kind,
      label: classified.label,
      score: category.score,
      box: { x: box.originX, y: box.originY, w: box.width, h: box.height },
    });
  }
  return sights.sort((a, b) => b.score - a.score);
}

export function detectVideoFrame(video: HTMLVideoElement, timestamp: number): Sight[] {
  if (!detector || mode !== "VIDEO" || video.readyState < 2) return [];
  return toSights(detector.detectForVideo(video, timestamp).detections);
}

export async function runStillDetections<T>(
  fn: (detect: (source: StillSource) => Sight[]) => Promise<T>,
): Promise<T> {
  const current = await loadDetector();
  if (mode !== "IMAGE") {
    await current.setOptions({ runningMode: "IMAGE" });
    mode = "IMAGE";
  }
  try {
    return await fn((source) => toSights(current.detect(source).detections));
  } finally {
    await current.setOptions({ runningMode: "VIDEO" });
    mode = "VIDEO";
  }
}

export function detectStill(source: StillSource) {
  return runStillDetections(async (detect) => detect(source));
}

export function annotateSource(
  source: StillSource,
  width: number,
  height: number,
  sights: Sight[],
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  for (const sight of sights) {
    const color = sightColor(sight.kind);
    ctx.lineWidth = Math.max(2, Math.round(width / 240));
    ctx.strokeStyle = color;
    ctx.strokeRect(sight.box.x, sight.box.y, sight.box.w, sight.box.h);
    ctx.font = `600 ${Math.max(14, Math.round(width / 40))}px sans-serif`;
    const pad = 4;
    const tw = ctx.measureText(sight.label).width;
    const labelH = Math.max(18, Math.round(width / 40));
    const labelY = sight.box.y > labelH ? sight.box.y - labelH : sight.box.y;
    ctx.fillStyle = color;
    ctx.fillRect(sight.box.x, labelY, tw + pad * 2, labelH);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillText(sight.label, sight.box.x + pad, labelY + labelH - 5);
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function drawSights(
  canvas: HTMLCanvasElement,
  sourceW: number,
  sourceH: number,
  sights: Sight[],
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const frame = containFrame(rect.width, rect.height, sourceW, sourceH);

  for (const sight of sights) {
    const x = sight.box.x * frame.scale + frame.offsetX;
    const y = sight.box.y * frame.scale + frame.offsetY;
    const w = sight.box.w * frame.scale;
    const h = sight.box.h * frame.scale;
    const color = sightColor(sight.kind);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    const text = sight.label;
    ctx.font = "600 12px sans-serif";
    const pad = 4;
    const tw = ctx.measureText(text).width;
    const labelY = y > 18 ? y - 18 : y;
    ctx.fillStyle = color;
    ctx.fillRect(x, labelY, tw + pad * 2, 18);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillText(text, x + pad, labelY + 13);
  }
}
