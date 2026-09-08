import { supabase } from "@/integrations/supabase/client";

export type ReportRow = {
  id: string;
  created_at: string;
  hazard_type: string;
  severity: string;
  risk_score: number;
  confidence: number;
  summary: string;
  items: unknown;
  lat: number | null;
  lng: number | null;
  address: string | null;
  road: string | null;
  city: string | null;
  state: string | null;
  source: string;
  image_path: string | null;
  reporter_note: string | null;
  status: string;
  authority_name: string | null;
  authority_dept: string | null;
  authority_contact: string | null;
};

export type AlertRow = {
  id: string;
  created_at: string;
  report_id: string | null;
  authority_name: string;
  authority_dept: string | null;
  authority_contact: string | null;
  channel: string;
  message: string;
  status: string;
};

export async function fetchReports(limit = 200): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ReportRow[];
}

export async function fetchAlerts(limit = 50): Promise<AlertRow[]> {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AlertRow[];
}

export async function signedImageUrl(path: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("hazard-media").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function uploadHazardImage(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("hazard-media").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}
