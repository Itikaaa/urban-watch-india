import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { readExifGps } from "@/lib/exif";
import {
  HAZARD_LABELS,
  resolveAuthority,
  severityFromScore,
  type Authority,
} from "@/lib/authorities";
import { fetchReports, uploadHazardImage } from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";
import { AuthCard, useAuth } from "@/lib/auth";
import { annotateSource, runStillDetections } from "@/lib/object-detector";
import { clutterRisk, groupSights, type Sight } from "@/lib/sights";
import { useLiveSights } from "@/hooks/use-live-sights";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SadakSafe — Live Pothole, Garbage & Waterlogging Detection in India" },
      {
        name: "description",
        content:
          "Scan Indian streets with your camera or upload a geotagged photo or video. AI spots potholes, garbage and waterlogging, maps the risk and alerts the responsible civic authority.",
      },
      { property: "og:title", content: "SadakSafe — Live Urban Risk Detection for India" },
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
  };
}

function Home() {
  const { user, loading, signOut } = useAuth();
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
  const {
    canvasRef,
    sights,
    sightsRef,
    status: detectorStatus,
  } = useLiveSights(videoRef, cameraOn && tab === "live");

  const { data: reports = [] } = useQuery({
    queryKey: ["reports"],
    queryFn: () => fetchReports(200),
    enabled: Boolean(user),
  });

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
      toast.error("Camera access was blocked. Allow the camera, or use the photo tab.");
    }
  }

  const analyze = useCallback(async (image: string, hint?: string) => {
    setAnalyzing(true);
    try {
      return await analyzeFrame({ data: { image, hint } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
      return null;
    } finally {
      setAnalyzing(false);
      setProgress("");
    }
  }, []);

  const scanLiveFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const frame = drawToDataUrl(video, video.videoWidth, video.videoHeight);
    const local = sightsToDetection(sightsRef.current);
    setPreview(frame);
    setDetection(local);
    const ai = await analyze(frame);
    if (ai) setDetection(combineDetection(local, ai));
    else if (!local.items.length) toast("Nothing in this frame.");
  }, [analyze, sightsRef]);

  async function readCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error("This device cannot share its location.");
      return null;
    }
    return new Promise<Place | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          let next: Place;
          try {
            const info = await reverseGeocode({ data: { lat: latitude, lng: longitude } });
            next = { ...info, origin: "Live GPS" };
          } catch {
            next = {
              lat: latitude,
              lng: longitude,
              address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
              road: null,
              city: null,
              state: null,
              origin: "Live GPS",
            };
          }
          placeRef.current = next;
          setPlace(next);
          resolve(next);
        },
        () => {
          toast.error("Location was blocked — type the place below instead.");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000 },
      );
    });
  }

  async function applyManualLocation(query: string, origin: string) {
    if (!query.trim()) return;
    try {
      const info = await geocodePlace({ data: { query } });
      if (!info) {
        toast.error("Could not find that place on the map.");
        return;
      }
      setPlace({ ...info, origin });
    } catch {
      toast.error("Location lookup failed. Try again.");
    }
  }

  async function onPhoto(file: File) {
    setDetection(null);
    const buffer = await file.arrayBuffer();
    const gps = readExifGps(buffer);
    const dataUrl = await shrinkImage(await fileToDataUrl(file));
    setPreview(dataUrl);

    if (gps) {
      try {
        const info = await reverseGeocode({ data: { lat: gps.lat, lng: gps.lng } });
        setPlace({ ...info, origin: "Photo GPS tag" });
        toast.success("Location read from the photo's GPS tag.");
      } catch {
        setPlace({
          lat: gps.lat,
          lng: gps.lng,
          address: `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`,
          road: null,
          city: null,
          state: null,
          origin: "Photo GPS tag",
        });
      }
    }

    let local = sightsToDetection([]);
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      local = await runStillDetections(async (detect) => {
        const found = detect(img);
        const marked = annotateSource(img, img.naturalWidth, img.naturalHeight, found);
        if (marked) setPreview(marked);
        return sightsToDetection(found);
      });
    } catch {
      toast.error("Could not read objects in this photo.");
    }
    setDetection(local);
    const result = await analyze(dataUrl);
    const merged = result ? combineDetection(local, result) : local;
    setDetection(merged);
    if (!gps && merged.locationGuess?.text) {
      await applyManualLocation(merged.locationGuess.text, "Guessed from the photo");
    }
  }

  async function onVideo(file: File) {
    setDetection(null);
    setAnalyzing(true);
    setProgress("Reading the video…");
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
        toast.error("Could not read objects in this video.");
      }
      URL.revokeObjectURL(url);

      if (!bestRaw || !bestMarked) {
        toast.error("No frame could be checked from this video.");
        return;
      }
      setPreview(bestMarked);
      setDetection(bestLocal);
      const ai = await analyze(bestRaw);
      const merged = ai ? combineDetection(bestLocal, ai) : bestLocal;
      setDetection(merged);
      if (merged.locationGuess?.text && !place) {
        await applyManualLocation(merged.locationGuess.text, "Guessed from the video");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Video check failed");
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
  }) {
    if (!input.located.lat || !input.located.lng) {
      toast.error("Add a location before submitting.");
      return false;
    }
    setSubmitting(true);
    try {
      let imagePath: string | null = null;
      if (input.image) {
        try {
          imagePath = await uploadHazardImage(input.image);
        } catch {
          toast("Photo could not be saved — sending the report without it.");
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
          items: input.detection.items,
          lat: input.located.lat,
          lng: input.located.lng,
          address: input.located.address,
          road: input.located.road,
          city: input.located.city,
          state: input.located.state,
          source: input.source,
          image_path: imagePath,
          reporter_note: input.note || null,
          authority_name: authority.name,
          authority_dept: authority.dept,
          authority_contact: authority.contact,
        })
        .select()
        .single();
      if (error) throw error;

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

      toast.success("Report added to the live map.");
      setDetection(null);
      setPreview(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit the report");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReport() {
    if (!detection) return;
    if (!place?.lat || !place.lng) {
      toast.error("Add a location before submitting.");
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
      toast(`Risk ${Math.round(merged.riskScore)}%. Photo kept here.`);
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

  const severity = detection ? severityFromScore(detection.riskScore) : "low";
  const totalItems =
    detection?.items.reduce((sum, i) => sum + (Number.isFinite(i.count) ? i.count : 1), 0) ?? 0;
  const liveGroups = groupSights(sights);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Checking your sign-in…
      </div>
    );
  }

  if (!user) {
    return <AuthCard />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border" style={{ background: "var(--gradient-hero)" }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2">
            <Radar className="size-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">SadakSafe</span>
            <Badge variant="secondary" className="ml-1">
              India
            </Badge>
          </div>
          <nav className="flex items-center gap-2">
            <Link to="/map">
              <Button variant="secondary" size="sm">
                <MapPin className="size-4" /> Live risk map
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scan</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="live">
                    <Camera className="mr-1 size-4" /> Live
                  </TabsTrigger>
                  <TabsTrigger value="photo">
                    <ImageIcon className="mr-1 size-4" /> Photo
                  </TabsTrigger>
                  <TabsTrigger value="video">
                    <Video className="mr-1 size-4" /> Video
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
                            {group.label} {group.count}
                          </span>
                        ))}
                      </div>
                    )}
                    {cameraOn && detectorStatus === "loading" && (
                      <div className="absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 text-xs text-white">
                        Loading
                      </div>
                    )}
                    {cameraOn && detectorStatus === "error" && (
                      <div className="absolute left-2 top-2 rounded bg-black/75 px-2 py-0.5 text-xs text-white">
                        Detector unavailable
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!cameraOn ? (
                      <Button onClick={startCamera}>
                        <Camera className="size-4" /> Start camera
                      </Button>
                    ) : (
                      <>
                        <Button onClick={() => void scanLiveFrame()} disabled={analyzing}>
                          {analyzing ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Radar className="size-4" />
                          )}
                          Capture
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void captureGeoPhoto()}
                          disabled={analyzing || submitting}
                        >
                          <MapPin className="size-4" /> Geo photo
                        </Button>
                        <Button variant="ghost" onClick={stopCamera}>
                          Stop
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
                      if (f) void onVideo(f);
                    }}
                  />
                </TabsContent>
              </Tabs>

              {analyzing && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {progress || "Checking"}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Location</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void readCurrentLocation()}>
                  <MapPin className="size-4" /> Use my live location
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Or type the road, area and city"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => void applyManualLocation(manual, "Typed by reporter")}
                >
                  Find
                </Button>
              </div>
              {place ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <div className="font-medium">{place.address ?? "Located"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {place.origin}
                    {place.lat && place.lng
                      ? ` · ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
                      : ""}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No location yet.</p>
              )}
            </CardContent>
          </Card>

          {detection && (
            <Card className="border-primary/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-primary" /> Found
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {preview && !(cameraOn && tab === "live") && (
                  <img src={preview} alt="" className="w-full rounded-lg border border-border" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{HAZARD_LABELS[detection.primaryType] ?? detection.primaryType}</Badge>
                  <Badge variant="outline" className="capitalize">
                    {severity} risk · {Math.round(detection.riskScore)}/100
                  </Badge>
                  <Badge variant="secondary">{Math.round(detection.confidence * 100)}% sure</Badge>
                  {totalItems > 0 && <Badge variant="secondary">{totalItems}</Badge>}
                </div>
                {detection.items.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {detection.items.map((item, i) => (
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
                <Textarea
                  placeholder="Note"
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
                    Put on map
                  </Button>
                  <Button variant="ghost" onClick={() => setDetection(null)}>
                    Discard
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live risk map</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MapPanel
                reports={reports}
                height={340}
                focus={place?.lat && place?.lng ? { lat: place.lat, lng: place.lng } : null}
              />
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full" style={{ background: "#22c55e" }} /> Green
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full" style={{ background: "#eab308" }} /> Yellow
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-3 rounded-full" style={{ background: "#dc2626" }} /> Red
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latest reports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reports.slice(0, 6).map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {HAZARD_LABELS[r.hazard_type] ?? r.hazard_type}
                    </span>
                    <Badge variant="outline" className="capitalize">
                      {r.severity}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {r.address ?? "Location pending"}
                  </div>
                </div>
              ))}
              {reports.length === 0 && (
                <p className="text-sm text-muted-foreground">No reports yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={!!alertInfo} onOpenChange={(open) => !open && setAlertInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" /> Alert raised
            </DialogTitle>
            <DialogDescription>
              This hazard was logged against the body responsible for {alertInfo?.road}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-border p-3">
              <div className="font-medium">{alertInfo?.authority.name}</div>
              <div className="text-muted-foreground">{alertInfo?.authority.dept}</div>
              {alertInfo?.authority.helpline && (
                <div className="mt-1 text-muted-foreground">
                  Helpline: {alertInfo.authority.helpline}
                </div>
              )}
              {alertInfo?.authority.contact && (
                <a
                  className="mt-1 inline-block text-primary underline"
                  href={alertInfo.authority.contact}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the official complaint portal
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
