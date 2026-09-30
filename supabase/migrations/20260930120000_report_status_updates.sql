GRANT UPDATE ON public.reports TO authenticated;

CREATE POLICY "reports_authenticated_update" ON public.reports
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
