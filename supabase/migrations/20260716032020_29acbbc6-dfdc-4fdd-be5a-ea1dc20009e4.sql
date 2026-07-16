INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES 
  ('20260715040000', 'fix_cancelar_sesion_coworking_paquetes', ARRAY['-- applied inline in follow-up migration']),
  ('20260715040100', 'add_fecha_descuento_to_mermas', ARRAY['-- applied inline in follow-up migration'])
ON CONFLICT (version) DO NOTHING;