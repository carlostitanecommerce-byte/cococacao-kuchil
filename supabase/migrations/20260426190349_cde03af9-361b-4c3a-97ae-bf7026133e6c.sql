
ALTER TABLE public.productos REPLICA IDENTITY FULL;
ALTER TABLE public.coworking_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.coworking_session_upsells REPLICA IDENTITY FULL;
ALTER TABLE public.detalle_ventas REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.productos; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.coworking_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.coworking_session_upsells; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.detalle_ventas; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
