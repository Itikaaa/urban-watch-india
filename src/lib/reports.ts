import { supabase } from "@/integrations/supabase/client";
import {
  applyPackedHandling,
  findOpenDuplicate,
  findRecentPin,
  packHandling,
  unpackHandling,
  type PackedHandling,
  type Team,
  teamById,
} from "@/lib/handling";

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
  assigned_team: string | null;
  eta_hours: number | null;
  due_at: string | null;
  proof_image_path: string | null;
  verify_summary: string | null;
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
  return ((data ?? []) as ReportRow[]).map((row) => applyPackedHandling(row));
}

export async function findOpenDuplicateReport(
  lat: number,
  lng: number,
  hazardType: string,
  known: ReportRow[] = [],
): Promise<ReportRow | null> {
  const local = findOpenDuplicate(known, lat, lng, hazardType);
  if (local) return local;
  if (findRecentPin(lat, lng, hazardType)) {
    return { id: "recent-pin" } as ReportRow;
  }
  const open = await fetchReports(400);
  return findOpenDuplicate(open, lat, lng, hazardType);
}

export async function updateReportHandling(
  current: ReportRow,
  patch: {
    status?: string;
    team?: Team;
    etaHours?: number | null;
    dueAt?: string | null;
    proofPath?: string | null;
    verify?: string | null;
    afterRisk?: number | null;
  },
) {
  const packed: PackedHandling = {
    ...(unpackHandling(current.authority_dept) ?? {
      teamId: current.assigned_team,
      etaHours: current.eta_hours,
      dueAt: current.due_at,
      proofPath: current.proof_image_path,
      verify: current.verify_summary,
    }),
    v: 1,
  };
  if (patch.team) packed.teamId = patch.team.id;
  if (patch.etaHours !== undefined) packed.etaHours = patch.etaHours;
  if (patch.dueAt !== undefined) packed.dueAt = patch.dueAt;
  if (patch.proofPath !== undefined) packed.proofPath = patch.proofPath;
  if (patch.verify !== undefined) packed.verify = patch.verify;
  if (patch.afterRisk !== undefined) packed.afterRisk = patch.afterRisk;

  const team = teamById(packed.teamId);
  const packedDept = packHandling(packed);
  const full = {
    status: patch.status ?? current.status,
    authority_name: team?.name ?? current.authority_name,
    authority_dept: packedDept,
    assigned_team: packed.teamId ?? null,
    eta_hours: packed.etaHours ?? null,
    due_at: packed.dueAt ?? null,
    proof_image_path: packed.proofPath ?? null,
    verify_summary: packed.verify ?? null,
  };

  const { data, error } = await supabase
    .from("reports")
    .update(full)
    .eq("id", current.id)
    .select()
    .maybeSingle();
  if (!error && data) return applyPackedHandling(data as ReportRow);

  const missingColumn =
    !!error &&
    (/schema cache|could not find the .* column|PGRST204|42703/i.test(error.message) ||
      error.code === "PGRST204" ||
      error.code === "42703");
  if (error && !missingColumn) throw new Error(error.message);

  const { data: fallback, error: fallbackError } = await supabase
    .from("reports")
    .update({
      status: full.status,
      authority_name: full.authority_name,
      authority_dept: packedDept,
    })
    .eq("id", current.id)
    .select()
    .maybeSingle();
  if (fallbackError) throw new Error(fallbackError.message);
  if (!fallback) throw new Error("Could not save this update. Try signing in again.");
  return applyPackedHandling({
    ...(fallback as ReportRow),
    assigned_team: packed.teamId ?? null,
    eta_hours: packed.etaHours ?? null,
    due_at: packed.dueAt ?? null,
    proof_image_path: packed.proofPath ?? null,
    verify_summary: packed.verify ?? null,
  });
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
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Sign in before saving a report photo.");
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userData.user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("hazard-media").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function reportImageDataUrl(path: string | null) {
  const url = await signedImageUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the original photo."));
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}
