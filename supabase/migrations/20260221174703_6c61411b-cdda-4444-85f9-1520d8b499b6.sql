
-- Add tarifa and upsell tracking to coworking_sessions
ALTER TABLE public.coworking_sessions
  ADD COLUMN tarifa_id uuid REFERENCES public.tarifas_coworking(id),
  ADD COLUMN upsell_producto_id uuid REFERENCES public.productos(id),
  ADD COLUMN upsell_precio numeric DEFAULT NULL;
