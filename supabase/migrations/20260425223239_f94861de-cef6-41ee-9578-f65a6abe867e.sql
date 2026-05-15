-- Habilitar realtime completo para ventas y cajas (Cocina los necesita
-- para reaccionar instantáneamente a cancelaciones y cierre de turno).
ALTER TABLE public.ventas REPLICA IDENTITY FULL;
ALTER TABLE public.cajas  REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.ventas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cajas;