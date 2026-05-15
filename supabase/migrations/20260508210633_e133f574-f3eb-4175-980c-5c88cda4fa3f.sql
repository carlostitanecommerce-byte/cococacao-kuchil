ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS caja_id uuid NULL REFERENCES public.cajas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_caja_id ON public.ventas(caja_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha_estado ON public.ventas(fecha, estado);