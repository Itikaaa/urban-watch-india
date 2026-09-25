REVOKE ALL ON TABLE public.reports FROM anon;
REVOKE ALL ON TABLE public.alerts FROM anon;
GRANT SELECT, INSERT ON TABLE public.reports TO authenticated;
GRANT SELECT, INSERT ON TABLE public.alerts TO authenticated;
GRANT ALL ON TABLE public.reports TO service_role;
GRANT ALL ON TABLE public.alerts TO service_role;

DROP POLICY IF EXISTS reports_public_insert ON public.reports;
DROP POLICY IF EXISTS reports_public_read ON public.reports;
CREATE POLICY reports_authenticated_insert
  ON public.reports
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY reports_authenticated_read
  ON public.reports
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS alerts_public_insert ON public.alerts;
DROP POLICY IF EXISTS alerts_public_read ON public.alerts;
CREATE POLICY alerts_authenticated_insert
  ON public.alerts
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY alerts_authenticated_read
  ON public.alerts
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS hazard_media_public_read ON storage.objects;
DROP POLICY IF EXISTS hazard_media_public_upload ON storage.objects;
CREATE POLICY hazard_media_owner_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'hazard-media'
    AND (storage.foldername(name))[1] = (select auth.uid()::text)
  );
CREATE POLICY hazard_media_owner_upload
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'hazard-media'
    AND (storage.foldername(name))[1] = (select auth.uid()::text)
  );