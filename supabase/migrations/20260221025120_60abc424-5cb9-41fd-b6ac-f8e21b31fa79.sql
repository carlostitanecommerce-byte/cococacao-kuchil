
-- Table for per-tarifa upsell pricing
CREATE TABLE public.tarifa_upsells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarifa_id uuid NOT NULL REFERENCES public.tarifas_coworking(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  precio_especial numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tarifa_id, producto_id)
);

ALTER TABLE public.tarifa_upsells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage upsells" ON public.tarifa_upsells FOR ALL USING (has_role(auth.uid(), 'administrador'::app_role));
CREATE POLICY "Authenticated users can view upsells" ON public.tarifa_upsells FOR SELECT USING (true);
