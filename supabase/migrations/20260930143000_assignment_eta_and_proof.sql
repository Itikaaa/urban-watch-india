ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS assigned_team text,
  ADD COLUMN IF NOT EXISTS eta_hours integer,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_image_path text,
  ADD COLUMN IF NOT EXISTS verify_summary text;
