ALTER TABLE public.tarifas_coworking 
  ADD COLUMN metodo_fraccion text DEFAULT '15_min' 
    CHECK (metodo_fraccion IN ('hora_cerrada', '15_min', '30_min', 'minuto_exacto')),
  ADD COLUMN minutos_tolerancia integer DEFAULT 5;

ALTER TABLE public.coworking_sessions 
  ADD COLUMN tarifa_snapshot jsonb;