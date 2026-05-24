ALTER TABLE public.ventas
  ADD COLUMN plataforma_id uuid NULL
  REFERENCES public.plataformas_delivery(id) ON DELETE SET NULL;

CREATE INDEX idx_ventas_plataforma ON public.ventas(plataforma_id);