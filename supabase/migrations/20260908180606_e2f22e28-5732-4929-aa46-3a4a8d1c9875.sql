CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  hazard_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  risk_score integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  summary text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  lat double precision,
  lng double precision,
  address text,
  road text,
  city text,
  state text,
  source text NOT NULL DEFAULT 'live',
  image_path text,
  reporter_note text,
  status text NOT NULL DEFAULT 'open',
  authority_name text,
  authority_dept text,
  authority_contact text
);

GRANT SELECT, INSERT ON public.reports TO anon;
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_public_read" ON public.reports FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "reports_public_insert" ON public.reports FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  report_id uuid REFERENCES public.reports(id) ON DELETE CASCADE,
  authority_name text NOT NULL,
  authority_dept text,
  authority_contact text,
  channel text NOT NULL DEFAULT 'in-app',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'sent'
);

GRANT SELECT, INSERT ON public.alerts TO anon;
GRANT SELECT, INSERT ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts_public_read" ON public.alerts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "alerts_public_insert" ON public.alerts FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX reports_created_at_idx ON public.reports (created_at DESC);

CREATE POLICY "hazard_media_public_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'hazard-media');
CREATE POLICY "hazard_media_public_upload" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'hazard-media');