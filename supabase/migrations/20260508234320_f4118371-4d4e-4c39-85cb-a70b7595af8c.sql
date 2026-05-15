-- Asegurar REPLICA IDENTITY FULL para emitir payloads completos
ALTER TABLE public.insumos REPLICA IDENTITY FULL;
ALTER TABLE public.productos REPLICA IDENTITY FULL;
ALTER TABLE public.recetas REPLICA IDENTITY FULL;

-- Agregar a la publicación supabase_realtime (idempotente)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.insumos;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.productos;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.recetas;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;