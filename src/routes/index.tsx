import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Radar,
  Send,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import MapPanel from "@/components/MapPanel";
import {
  analyzeFrame,
  geocodePlace,
  reverseGeocode,
  type Detection,
  type DetectedItem,
} from "@/lib/detect.functions";
import { HazardAnalysisPanel } from "@/components/HazardAnalysisPanel";
import { withoutAnalysisItems, withStoredAnalysis } from "@/lib/hazard-analysis";
import { readExifGps } from "@/lib/exif";
import {
  HAZARD_LABELS,
  resolveAuthority,
  severityFromScore,
  type Authority,
} from "@/lib/authorities";
import { findOpenDuplicateReport, uploadHazardImage } from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";
import { useLiveReports } from "@/hooks/use-live-reports";
import { AuthCard, useAuth } from "@/lib/auth";
import { annotateSource, runStillDetections } from "@/lib/object-detector";
import { clutterRisk, groupSights, type Sight } from "@/lib/sights";
import { useLiveSights } from "@/hooks/use-live-sights";
import { useRangeRiskScan } from "@/hooks/use-range-risk-scan";
import {
  findOpenDuplicate,
  findRecentPin,
  noteRecentPin,
  shouldAutoReport,
  teamForHazard,
} from "@/lib/handling";
import { sessionRole } from "@/lib/role";
import { IssueProgress } from "@/components/IssueProgress";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import {
  hazardLabel,
  severityLabel,
  sightLabel,
  teamFocusLabel,
  type MessageKey,
} from "@/lib/i18n";
import { useT } from "@/lib/i18n-provider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DRISHTI — Live Pothole, Garbage & Waterlogging Detection in India" },
      {
        name: "description",
        content:
          "Scan Indian streets with your camera or upload a geotagged photo or video. AI spots potholes, garbage and waterlogging, maps the risk and alerts the responsible civic authority.",
      },
      { property: "og:title", content: "DRISHTI — Live Urban Risk Detection for India" },
      {
        property: "og:description",
        content:
          "AI street scanning for potholes, garbage and waterlogging, plotted on a live risk map with automatic civic-authority alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type Place = {
  lat: number | null;
  lng: number | null;
  address: string | null;
  road: string | null;
  city: string | null;
  state: string | null;
  origin: string;
};

const MAX_SIDE = 1100;

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function drawToDataUrl(source: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function shrinkImage(dataUrl: string) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return drawToDataUrl(img, img.naturalWidth, img.naturalHeight);
}

const ROAD_TYPES = new Set([
  "pothole",
  "waterlogging",
  "debris",
  "open_manhole",
  "broken_footpath",
  "damaged_road",
  "traffic_hazard",
  "stagnant_water",
]);

function sightsToDetection(sights: Sight[]): Detection {
  const groups = groupSights(sights);
  const items: DetectedItem[] = groups.map((group) => {
    const matched = sights.filter(
      (sight) => sight.kind === group.kind && sight.label === group.label,
    );
    const confidence = matched.reduce((sum, sight) => sum + sight.score, 0) / matched.length;
    const type =
      group.kind === "vehicle" ? "vehicle" : group.kind === "scene" ? "other" : group.kind;
    return {
      type,
      label: group.label,
      count: group.count,
      severity: group.kind === "garbage" ? Math.min(5, 1 + Math.ceil(group.count / 2)) : 1,
      confidence,
      note: "",
    };
  });
  const garbage = sights.filter((sight) => sight.kind === "garbage").length;
  return {
    hazardDetected: garbage > 0,
    primaryType: garbage > 0 ? "garbage" : "other",
    riskScore: clutterRisk(garbage),
    confidence: items.length ? Math.max(...items.map((item) => item.confidence)) : 0,
    summary: groups.map((group) => `${group.count} ${group.label.toLowerCase()}`).join(", "),
    items,
    locationGuess: null,
    analysis: null,
  };
}

function combineDetection(local: Detection, ai: Detection): Detection {
  const roadItems = ai.items.filter((item) => ROAD_TYPES.has(item.type));
  const items = [...local.items, ...roadItems];
  const useRoad = roadItems.length > 0 && ai.riskScore > local.riskScore;
  return {
    hazardDetected: local.hazardDetected || roadItems.length > 0 || ai.hazardDetected,
    primaryType: useRoad ? ai.primaryType : local.items.length ? local.primaryType : ai.primaryType,
    riskScore: Math.max(local.riskScore, ai.riskScore),
    confidence: Math.max(local.confidence, ai.confidence),
    summary: [local.summary, roadItems.length ? ai.summary : ""].filter(Boolean).join(". "),
    items: items.length ? items : ai.items,
    locationGuess: ai.locationGuess,
    analysis: ai.analysis,
  };
}

function Home() {
  const { t, locale } = useT();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("live");
  const [preview, setPreview] = useState<string | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [place, setPlace] = useState<Place | null>(null);
  const [manual, setManual] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    authority: Authority;
    road: string;
    message: string;
  } | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const placeRef = useRef<Place | null>(null);
  placeRef.current = place;
  const autoLock = useRef(false);
  const pendingUpload = useRef<{
    detection: Detection;
    image: string | null;
    source: "photo" | "video";
  } | null>(null);
  const fileLiveRef = useRef<(detection: Detection, image: string | null) => Promise<void>>(
    async () => undefined,
  );
  const {
    canvasRef,
    sights,
    sightsRef,
    status: detectorStatus,
  } = useLiveSights(videoRef, cameraOn && tab === "live");

  const { data: reports = [] } = useLiveReports(200, Boolean(user));
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const [rangeWatch, setRangeWatch] = useState(false);
  useEffect(() => {
    if (!user || sessionRole() === "authority") return;
    if (!navigator.permissions?.query) return;
    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (status.state === "granted") setRangeWatch(true);
      })
      .catch(() => undefined);
  }, [user]);
  useRangeRiskScan({ enabled: rangeWatch, autoLocate: rangeWatch });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOn || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [cameraOn, tab]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      void readCurrentLocation();
    } catch {
      toast.error(t("cameraBlocked"));
    }
  }

  const analyze = useCallback(async (image: string, hint?: string) => {
    setAnalyzing(true);
    try {
      return await analyzeFrame({ data: { image, hint } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("analysisFailed"));
      return null;
    } finally {
      setAnalyzing(false);
      setProgress("");
    }
  }, [t]);

  const scanLiveFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const frame = drawToDataUrl(video, video.videoWidth, video.videoHeight);
    const local = sightsToDetection(sightsRef.current);
    setPreview(frame);
    setDetection(local);
    const ai = await analyze(frame);
    if (ai) setDetection(combineDetection(local, ai));
    else if (!local.items.length) toast(t("nothingInFrame"));
  }, [analyze, sightsRef, t]);

  async function readCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error(t("noDeviceLocation"));
      return null;
    }
    return new Promise<Place | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          let next: Place;
          try {
            const info = await reverseGeocode({ data: { lat: latitude, lng: longitude } });
            next = { ...info, origin: "originLiveGps" };
          } catch {
            next = {
              lat: latitude,
              lng: longitude,
              address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
              road: null,
              city: null,
              state: null,
              origin: "originLiveGps",
            };
          }
          placeRef.current = next;
          setPlace(next);
          resolve(next);
        },
        () => {
          toast.error(t("locationBlocked"));
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000 },
      );
    });
  }

  async function applyManualLocation(query: string, origin: string): Promise<Place | null> {
    if (!query.trim()) return null;
    try {
      const info = await geocodePlace({ data: { query } });
      if (!info) {
        toast.error(t("placeNotFound"));
        return null;
      }
      const next: Place = { ...info, origin };
      placeRef.current = next;
      setPlace(next);
      return next;
    } catch {
      toast.error(t("locationLookupFailed"));
      return null;
    }
  }

  function hasMapCoords(located: Place | null | undefined): located is Place & { lat: number; lng: number } {
    return located != null && located.lat != null && located.lng != null;
  }

  async function locateForUpload(
    detection: Detection,
    prefer: Place | null,
    guessOrigin: "originGuessedPhoto" | "originGuessedVideo",
  ): Promise<Place | null> {
    if (hasMapCoords(prefer)) {
      placeRef.current = prefer;
      setPlace(prefer);
      return prefer;
    }
    if (hasMapCoords(placeRef.current)) return placeRef.current;
    if (detection.locationGuess?.text) {
      const guessed = await applyManualLocation(detection.locationGuess.text, guessOrigin);
      if (hasMapCoords(guessed)) return guessed;
    }
    const live = await readCurrentLocation();
    if (hasMapCoords(live)) return live;
    return placeRef.current;
  }

  async function autoMapUpload(
    detection: Detection,
    image: string | null,
    source: "photo" | "video",
    prefer: Place | null,
  ) {
    if (!shouldAutoReport(detection.primaryType, detection.hazardDetected, detection.items)) {
      if (!detection.hazardDetected && detection.items.length === 0) toast(t("nothingInFrame"));
      return;
    }
    const located = await locateForUpload(
      detection,
      prefer,
      source === "photo" ? "originGuessedPhoto" : "originGuessedVideo",
    );
    if (!hasMapCoords(located)) {
      pendingUpload.current = { detection, image, source };
      toast.error(t("addLocation"));
      return;
    }
    pendingUpload.current = null;
    setProgress(t("mappingUpload"));
    await publishReport({
      detection,
      located,
      image,
      source,
      note: "",
      announce: true,
      resetForm: false,
    });
  }

  async function onPhoto(file: File) {
    pendingUpload.current = null;
    setDetection(null);
    const buffer = await file.arrayBuffer();
    const gps = readExifGps(buffer);
    const dataUrl = await shrinkImage(await fileToDataUrl(file));
    setPreview(dataUrl);

    let photoPlace: Place | null = null;
    if (gps) {
      try {
        const info = await reverseGeocode({ data: { lat: gps.lat, lng: gps.lng } });
        photoPlace = { ...info, origin: "originPhotoGps" };
        toast.success(t("locationReadGps"));
      } catch {
        photoPlace = {
          lat: gps.lat,
          lng: gps.lng,
          address: `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`,
          road: null,
          city: null,
          state: null,
          origin: "originPhotoGps",
        };
      }
      placeRef.current = photoPlace;
      setPlace(photoPlace);
    }

    let imageForMap = dataUrl;
    let local = sightsToDetection([]);
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      local = await runStillDetections(async (detect) => {
        const found = detect(img);
        const marked = annotateSource(img, img.naturalWidth, img.naturalHeight, found);
        if (marked) {
          setPreview(marked);
          imageForMap = marked;
        }
        return sightsToDetection(found);
      });
    } catch {
      toast.error(t("couldNotReadPhoto"));
    }
    setDetection(local);
    const result = await analyze(dataUrl);
    const merged = result ? combineDetection(local, result) : local;
    setDetection(merged);
    await autoMapUpload(merged, imageForMap, "photo", photoPlace);
  }

  async function onVideo(file: File) {
    pendingUpload.current = null;
    setDetection(null);
    setAnalyzing(true);
    setProgress(t("readingVideo"));
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      await new Promise((res, rej) => {
        video.onloadedmetadata = () => res(null);
        video.onerror = () => rej(new Error("Could not read this video"));
      });
      const duration = Math.max(0.1, video.duration || 1);
      const count = Math.min(6, Math.max(3, Math.round(duration / 3)));
      let bestLocal = sightsToDetection([]);
      let bestMarked: string | null = null;
      let bestRaw: string | null = null;
      let bestScore = -1;

      try {
        await runStillDetections(async (detect) => {
          for (let i = 0; i < count; i++) {
            const t = (duration * (i + 0.5)) / count;
            setProgress(`${i + 1}/${count}`);
            await new Promise((res) => {
              video.onseeked = () => res(null);
              video.currentTime = Math.min(t, duration - 0.05);
            });
            const found = detect(video);
            const local = sightsToDetection(found);
            const raw = drawToDataUrl(video, video.videoWidth, video.videoHeight);
            const marked = annotateSource(video, video.videoWidth, video.videoHeight, found);
            const score = local.riskScore + found.length;
            if (score > bestScore) {
              bestScore = score;
              bestLocal = local;
              bestRaw = raw;
              bestMarked = marked ?? raw;
            }
          }
        });
      } catch {
        toast.error(t("couldNotReadVideo"));
      }
      URL.revokeObjectURL(url);

      if (!bestRaw || !bestMarked) {
        toast.error(t("noVideoFrame"));
        return;
      }
      setPreview(bestMarked);
      setDetection(bestLocal);
      const ai = await analyze(bestRaw);
      const merged = ai ? combineDetection(bestLocal, ai) : bestLocal;
      setDetection(merged);
      await autoMapUpload(merged, bestMarked, "video", null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("videoFailed"));
    } finally {
      setAnalyzing(false);
      setProgress("");
    }
  }

  async function publishReport(input: {
    detection: Detection;
    located: Place;
    image: string | null;
    source: string;
    note: string;
    announce: boolean;
    resetForm?: boolean;
  }) {
    if (!input.located.lat || !input.located.lng) {
      toast.error(t("addLocation"));
      return false;
    }
    let duplicate =
      findOpenDuplicate(
        reportsRef.current,
        input.located.lat,
        input.located.lng,
        input.detection.primaryType,
      ) || findRecentPin(input.located.lat, input.located.lng, input.detection.primaryType);
    if (!duplicate) {
      try {
        duplicate = await findOpenDuplicateReport(
          input.located.lat,
          input.located.lng,
          input.detection.primaryType,
          reportsRef.current,
        );
      } catch {
        duplicate = null;
      }
    }
    if (duplicate) {
      noteRecentPin(input.located.lat, input.located.lng, input.detection.primaryType);
      if (input.source !== "live") {
        toast(t("alreadyReported"), {
          description: t("alreadyReportedDetail", {
            focus: teamFocusLabel(
              teamForHazard(input.detection.primaryType).id,
              locale,
            ).toLowerCase(),
          }),
        });
      }
      return false;
    }
    setSubmitting(true);
    try {
      let imagePath: string | null = null;
      if (input.image) {
        try {
          imagePath = await uploadHazardImage(input.image);
        } catch {
          toast(t("photoNotSaved"));
        }
      }

      const severity = severityFromScore(input.detection.riskScore);
      const authority = resolveAuthority({
        city: input.located.city,
        state: input.located.state,
        road: input.located.road,
      });

      const { data, error } = await supabase
        .from("reports")
        .insert({
          hazard_type: input.detection.primaryType,
          severity,
          risk_score: Math.round(input.detection.riskScore),
          confidence: input.detection.confidence,
          summary: input.detection.summary,
          items: withStoredAnalysis(input.detection.items, input.detection.analysis),
          lat: input.located.lat,
          lng: input.located.lng,
          address: input.located.address,
          road: input.located.road,
          city: input.located.city,
          state: input.located.state,
          source: input.source,
          image_path: imagePath,
          reporter_note: input.note || null,
          status: "reported",
          authority_name: authority.name,
          authority_dept: authority.dept,
          authority_contact: authority.contact,
        })
        .select()
        .single();
      if (error) throw error;
      noteRecentPin(input.located.lat, input.located.lng, input.detection.primaryType);
      const row = data as (typeof reportsRef.current)[number];
      reportsRef.current = [row, ...reportsRef.current];
      queryClient.setQueriesData({ queryKey: ["reports"] }, (old: typeof reports | undefined) => {
        if (!old) return [row];
        if (old.some((item) => item.id === row.id)) return old;
        return [row, ...old];
      });

      const roadHazard = ["pothole", "damaged_road", "open_manhole", "broken_footpath"].includes(
        input.detection.primaryType,
      );

      if (roadHazard || severity === "critical" || severity === "high") {
        const roadName = input.located.road ?? input.located.address ?? "the reported location";
        const message =
          `${HAZARD_LABELS[input.detection.primaryType] ?? input.detection.primaryType} on ${roadName}` +
          `${input.located.city ? `, ${input.located.city}` : ""}. Risk ${Math.round(input.detection.riskScore)}/100. ${input.detection.summary}`;
        await supabase.from("alerts").insert({
          report_id: data.id,
          authority_name: authority.name,
          authority_dept: authority.dept,
          authority_contact: authority.contact,
          channel: "in-app",
          message,
        });
        if (input.announce) setAlertInfo({ authority, road: roadName, message });
      }

      toast.success(t("reportedOnMap"));
      if (input.resetForm !== false) {
        setDetection(null);
        setPreview(null);
        setNote("");
      }
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("submitFailed"));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReport() {
    if (!detection) return;
    if (!place?.lat || !place.lng) {
      toast.error(t("addLocation"));
      return;
    }
    await publishReport({
      detection,
      located: place,
      image: preview,
      source: tab,
      note,
      announce: true,
    });
  }

  async function captureGeoPhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const frame = drawToDataUrl(video, video.videoWidth, video.videoHeight);
    const found = sightsRef.current;
    const marked = annotateSource(video, video.videoWidth, video.videoHeight, found) ?? frame;
    const local = sightsToDetection(found);
    setPreview(marked);
    setDetection(local);

    const [ai, located] = await Promise.all([
      analyze(frame),
      placeRef.current?.lat != null && placeRef.current.lng != null
        ? Promise.resolve(placeRef.current)
        : readCurrentLocation(),
    ]);
    const merged = ai ? combineDetection(local, ai) : local;
    setDetection(merged);
    setPreview(marked);

    if (merged.riskScore <= 70) {
      toast(t("riskKeptHere", { n: Math.round(merged.riskScore) }));
      return;
    }
    if (!located?.lat || !located.lng) return;
    await publishReport({
      detection: merged,
      located,
      image: marked,
      source: "geo-photo",
      note,
      announce: false,
    });
  }

  async function fileLive(detection: Detection, image: string | null) {
    if (!shouldAutoReport(detection.primaryType, detection.hazardDetected, detection.items)) return;
    if (image) setPreview(image);
    setDetection(detection);
    if (autoLock.current) return;
    autoLock.current = true;
    try {
      const located =
        placeRef.current?.lat != null && placeRef.current.lng != null
          ? placeRef.current
          : await readCurrentLocation();
      if (!located?.lat || !located.lng) return;
      if (
        findRecentPin(located.lat, located.lng, detection.primaryType) ||
        findOpenDuplicate(reportsRef.current, located.lat, located.lng, detection.primaryType)
      ) {
        noteRecentPin(located.lat, located.lng, detection.primaryType);
        return;
      }
      await publishReport({
        detection,
        located,
        image,
        source: "live",
        note: "",
        announce: false,
        resetForm: false,
      });
    } finally {
      autoLock.current = false;
    }
  }
  fileLiveRef.current = fileLive;

  useEffect(() => {
    if (!cameraOn || tab !== "live") return;
    const detection = sightsToDetection(sightsRef.current);
    if (!shouldAutoReport(detection.primaryType, detection.hazardDetected, detection.items)) return;
    const video = videoRef.current;
    const image =
      video && video.videoWidth ? drawToDataUrl(video, video.videoWidth, video.videoHeight) : null;
    void fileLiveRef.current(detection, image);
  }, [cameraOn, tab, sights, sightsRef]);

  useEffect(() => {
    if (!cameraOn || tab !== "live") return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video?.videoWidth || autoLock.current) return;
      const frame = drawToDataUrl(video, video.videoWidth, video.videoHeight);
      void analyzeFrame({ data: { image: frame } })
        .then((detection) => {
          if (shouldAutoReport(detection.primaryType, detection.hazardDetected, detection.items)) {
            void fileLiveRef.current(detection, frame);
          }
        })
        .catch(() => undefined);
    }, 20000);
    return () => window.clearInterval(id);
  }, [cameraOn, tab]);

  useEffect(() => {
    const pending = pendingUpload.current;
    if (!pending || place?.lat == null || place.lng == null) return;
    pendingUpload.current = null;
    void publishReport({
      detection: pending.detection,
      located: place,
      image: pending.image,
      source: pending.source,
      note: "",
      announce: true,
      resetForm: false,
    });
  }, [place]);

  useEffect(() => {
    if (!loading && user && sessionRole() === "authority") {
      void navigate({ to: "/authority" });
    }
  }, [loading, user, navigate]);

  const severity = detection ? severityFromScore(detection.riskScore) : "low";
  const visibleItems = detection ? withoutAnalysisItems(detection.items) : [];
  const totalItems = visibleItems.reduce(
    (sum, i) => sum + (Number.isFinite(i.count) ? i.count : 1),
    0,
  );
  const liveGroups = groupSights(sights);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t("checkingSignIn")}
      </div>
    );
  }

  if (!user) {
    return <AuthCard />;
  }

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
            <Radar className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">{t("brand")}</span>
            <Badge variant="secondary" className="ml-1">
              {t("india")}
            </Badge>
          </div>
          <nav className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/range">
              <Button variant="secondary" size="sm">
                <Radar className="size-4" /> {t("rangeRiskScan")}
              </Button>
            </Link>
            <Link to="/map">
              <Button variant="secondary" size="sm">
                <MapPin className="size-4" /> {t("liveRiskMap")}
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              {t("signOut")}
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("scan")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="live">
                    <Camera className="mr-1 size-4" /> {t("live")}
                  </TabsTrigger>
                  <TabsTrigger value="photo">
                    <ImageIcon className="mr-1 size-4" /> {t("photo")}
                  </TabsTrigger>
                  <TabsTrigger value="video">
                    <Video className="mr-1 size-4" /> {t("video")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="live" className="space-y-3 pt-4">
                  <div className="relative overflow-hidden rounded-xl border border-border bg-black">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="aspect-video w-full object-contain"
                    />
                    <canvas
                      ref={canvasRef}
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                    {cameraOn && liveGroups.length > 0 && (
                      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
                        {liveGroups.map((group) => (
                          <span
                            key={`${group.kind}-${group.label}`}
                            className={`rounded bg-black/75 px-2 py-0.5 text-xs ${
                              group.kind === "person"
                                ? "text-sky-300"
                                : group.kind === "phone"
                                  ? "text-yellow-300"
                                  : group.kind === "vehicle"
                                    ? "text-orange-300"
                                    : group.kind === "garbage"
                                      ? "text-red-400"
                                      : "text-white"
                            }`}
                          >
                            {sightLabel(group.kind, group.label, locale)} {group.count}
                          </span>
                        ))}
                      </div>
                    )}
                    {cameraOn && detectorStatus === "loading" && (
                      <div className="absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 text-xs text-white">
                        {t("loading")}
                      </div>
                    )}
                    {cameraOn && detectorStatus === "error" && (
                      <div className="absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 text-xs text-white">
                        {t("detectorUnavailable")}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!cameraOn ? (
                      <Button onClick={startCamera}>
                        <Camera className="size-4" /> {t("startCamera")}
                      </Button>
                    ) : (
                      <>
                        <Button onClick={() => void scanLiveFrame()} disabled={analyzing}>
                          {analyzing ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Radar className="size-4" />
                          )}
                          {t("capture")}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void captureGeoPhoto()}
                          disabled={analyzing || submitting}
                        >
                          <MapPin className="size-4" /> {t("geoPhoto")}
                        </Button>
                        <Button variant="ghost" onClick={stopCamera}>
                          {t("stop")}
                        </Button>
                      </>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="photo" className="space-y-3 pt-4">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void onPhoto(f);
                    }}
                  />
                </TabsContent>

                <TabsContent value="video" className="space-y-3 pt-4">
                  <Input
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void onVideo(f);
                    }}
                  />
                </TabsContent>
              </Tabs>

              {analyzing || submitting ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {progress || t("checking")}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("location")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void readCurrentLocation()}>
                  <MapPin className="size-4" /> {t("useLiveLocation")}
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={t("locationPlaceholder")}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => void applyManualLocation(manual, "originTyped")}
                >
                  {t("find")}
                </Button>
              </div>
              {place ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <div className="font-medium">{place.address ?? t("located")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {place.origin.startsWith("origin")
                      ? t(place.origin as MessageKey)
                      : place.origin}
                    {place.lat && place.lng
                      ? ` · ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
                      : ""}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noLocationYet")}</p>
              )}
            </CardContent>
          </Card>

          {detection && (
            <Card className="border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-primary" /> {t("found")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {preview && !(cameraOn && tab === "live") && (
                  <img src={preview} alt="" className="w-full rounded-lg border border-border" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{hazardLabel(detection.primaryType, locale)}</Badge>
                  <Badge variant="outline">
                    {t("riskBadge", {
                      severity: severityLabel(severity, locale),
                      score: Math.round(detection.riskScore),
                    })}
                  </Badge>
                  <Badge variant="secondary">
                    {t("sure", { n: Math.round(detection.confidence * 100) })}
                  </Badge>
                  {totalItems > 0 && <Badge variant="secondary">{totalItems}</Badge>}
                </div>
                {visibleItems.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {visibleItems.map((item, i) => (
                      <li key={i} className="flex gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <span className="font-medium">
                          {item.label}
                          {item.count > 1 ? ` ×${item.count}` : ""}
                        </span>
                        {item.note ? (
                          <span className="text-muted-foreground">{item.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <HazardAnalysisPanel analysis={detection.analysis} />
                <Textarea
                  placeholder={t("note")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void submitReport()} disabled={submitting}>
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {t("putOnMap")}
                  </Button>
                  <Button variant="ghost" onClick={() => setDetection(null)}>
                    {t("discard")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("liveRiskMap")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MapPanel
                reports={reports}
                height={340}
                focus={place?.lat && place?.lng ? { lat: place.lat, lng: place.lng } : null}
              />
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full" style={{ background: "#22c55e" }} />{" "}
                  {t("green")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full" style={{ background: "#eab308" }} />{" "}
                  {t("yellow")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full" style={{ background: "#dc2626" }} />{" "}
                  {t("red")}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("incidentReport")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reports.slice(0, 6).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <IssueProgress
                    hazardType={r.hazard_type}
                    status={r.status}
                    assignedTeam={r.assigned_team}
                    authorityName={r.authority_name}
                    etaHours={r.eta_hours}
                    dueAt={r.due_at}
                    summary={r.summary}
                    address={r.address}
                    verifySummary={r.verify_summary}
                    items={r.items}
                  />
                </div>
              ))}
              {reports.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("noReportsYet")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={!!alertInfo} onOpenChange={(open) => !open && setAlertInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" /> {t("alertRaised")}
            </DialogTitle>
            <DialogDescription>
              {t("alertLogged", { road: alertInfo?.road ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-border p-3">
              <div className="font-medium">{alertInfo?.authority.name}</div>
              <div className="text-muted-foreground">{alertInfo?.authority.dept}</div>
              {alertInfo?.authority.helpline && (
                <div className="mt-1 text-muted-foreground">
                  {t("helpline", { n: alertInfo.authority.helpline })}
                </div>
              )}
              {alertInfo?.authority.contact && (
                <a
                  className="mt-1 inline-block text-primary underline"
                  href={alertInfo.authority.contact}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("openPortal")}
                </a>
              )}
            </div>
            <p className="text-muted-foreground">{alertInfo?.message}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
