
-- Create session status enum
CREATE TYPE public.coworking_estado AS ENUM ('activo', 'finalizado', 'cancelado');

-- Create coworking_sessions table
CREATE TABLE public.coworking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nombre text NOT NULL,
  area_id uuid NOT NULL REFERENCES public.areas_coworking(id),
  pax_count integer NOT NULL DEFAULT 1,
  usuario_id uuid NOT NULL,
  fecha_inicio timestamp with time zone NOT NULL DEFAULT now(),
  fecha_fin_estimada timestamp with time zone NOT NULL,
  fecha_salida_real timestamp with time zone,
  estado public.coworking_estado NOT NULL DEFAULT 'activo',
  monto_acumulado numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.coworking_sessions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view sessions
CREATE POLICY "Authenticated users can view sessions"
  ON public.coworking_sessions FOR SELECT
  USING (true);

-- Authenticated users can insert sessions
CREATE POLICY "Authenticated users can insert sessions"
  ON public.coworking_sessions FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

-- Users can update sessions (for check-out)
CREATE POLICY "Authenticated users can update sessions"
  ON public.coworking_sessions FOR UPDATE
  USING (true);

-- Admins can delete
CREATE POLICY "Admins can delete sessions"
  ON public.coworking_sessions FOR DELETE
  USING (public.has_role(auth.uid(), 'administrador'));

-- Indexes
CREATE INDEX idx_coworking_sessions_area ON public.coworking_sessions (area_id);
CREATE INDEX idx_coworking_sessions_estado ON public.coworking_sessions (estado);

-- Updated_at trigger
CREATE TRIGGER update_coworking_sessions_updated_at
  BEFORE UPDATE ON public.coworking_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.coworking_sessions;
