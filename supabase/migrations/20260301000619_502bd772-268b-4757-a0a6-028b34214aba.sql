
-- Create junction table for multiple upsells per session
CREATE TABLE public.coworking_session_upsells (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.coworking_sessions(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.productos(id),
  precio_especial NUMERIC NOT NULL DEFAULT 0,
  cantidad INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.coworking_session_upsells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view session upsells"
  ON public.coworking_session_upsells FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert session upsells"
  ON public.coworking_session_upsells FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete session upsells"
  ON public.coworking_session_upsells FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage session upsells"
  ON public.coworking_session_upsells FOR ALL
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.coworking_session_upsells;

-- Migrate existing single-upsell data to the new table
INSERT INTO public.coworking_session_upsells (session_id, producto_id, precio_especial, cantidad)
SELECT id, upsell_producto_id, COALESCE(upsell_precio, 0), 1
FROM public.coworking_sessions
WHERE upsell_producto_id IS NOT NULL
  AND estado IN ('activo', 'pendiente_pago');
