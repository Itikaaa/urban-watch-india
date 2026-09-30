DROP POLICY IF EXISTS hazard_media_owner_read ON storage.objects;
CREATE POLICY hazard_media_authenticated_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'hazard-media');
