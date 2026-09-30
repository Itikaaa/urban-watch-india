import { useEffect, useRef, useState, type RefObject } from "react";
import { detectVideoFrame, drawSights, loadDetector } from "@/lib/object-detector";
import { groupSights, type Sight } from "@/lib/sights";

export function useLiveSights(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sightsRef = useRef<Sight[]>([]);
  const [sights, setSights] = useState<Sight[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!active) {
      setStatus("idle");
      setSights([]);
      sightsRef.current = [];
      return;
    }

    let cancelled = false;
    let frame = 0;
    let busy = false;
    let lastRun = 0;
    let lastEmit = 0;
    let lastTimestamp = 0;
    let lastCounts = "";
    setStatus("loading");

    void loadDetector()
      .then(() => {
        if (cancelled) return;
        setStatus("ready");
        const tick = (now: number) => {
          frame = requestAnimationFrame(tick);
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
          if (busy || now - lastRun < 160) {
            return;
          }
          lastRun = now;
          busy = true;
          lastTimestamp = Math.max(lastTimestamp + 1, now);
          try {
            const next = detectVideoFrame(video, lastTimestamp);
            sightsRef.current = next;
            if (!cancelled) {
              const counts = groupSights(next)
                .map((group) => `${group.label}:${group.count}`)
                .join("|");
              const hasGarbage = next.some((sight) => sight.kind === "garbage");
              if (counts !== lastCounts || (hasGarbage && now - lastEmit > 2500)) {
                lastCounts = counts;
                lastEmit = now;
                setSights(next.slice());
              }
              drawSights(canvas, video.videoWidth, video.videoHeight, next);
            }
          } catch {
            // A frame can fail while a still image is being checked. The next frame retries.
          } finally {
            busy = false;
          }
        };
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    const canvas = canvasRef.current;
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, videoRef]);

  return { canvasRef, sights, sightsRef, status };
}
