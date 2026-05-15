ALTER TABLE public.tarifas_coworking
  DROP CONSTRAINT IF EXISTS tarifas_coworking_metodo_fraccion_check;

ALTER TABLE public.tarifas_coworking
  ADD CONSTRAINT tarifas_coworking_metodo_fraccion_check
  CHECK (metodo_fraccion IN ('sin_cobro','hora_cerrada','15_min','30_min','minuto_exacto'));