
ALTER TABLE public.coworking_sessions
  ADD COLUMN IF NOT EXISTS cliente_id UUID NULL REFERENCES public.clientes(id) ON DELETE SET NULL;

ALTER TABLE public.coworking_reservaciones
  ADD COLUMN IF NOT EXISTS cliente_id UUID NULL REFERENCES public.clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coworking_sessions_cliente_id
  ON public.coworking_sessions(cliente_id);

CREATE INDEX IF NOT EXISTS idx_coworking_reservaciones_cliente_id
  ON public.coworking_reservaciones(cliente_id);
