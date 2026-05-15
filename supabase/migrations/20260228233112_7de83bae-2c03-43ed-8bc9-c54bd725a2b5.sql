
-- Create enum for session cancellation request status (reuse existing pattern)
CREATE TYPE public.solicitud_cancelacion_sesion_estado AS ENUM ('pendiente', 'aprobada', 'rechazada');

-- Create table for coworking session cancellation requests
CREATE TABLE public.solicitudes_cancelacion_sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.coworking_sessions(id),
  solicitante_id uuid NOT NULL,
  motivo text NOT NULL,
  estado solicitud_cancelacion_sesion_estado NOT NULL DEFAULT 'pendiente',
  revisado_por uuid,
  motivo_rechazo text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.solicitudes_cancelacion_sesiones ENABLE ROW LEVEL SECURITY;

-- Users can view own solicitudes
CREATE POLICY "Users can view own solicitudes_sesiones"
ON public.solicitudes_cancelacion_sesiones
FOR SELECT
USING (auth.uid() = solicitante_id);

-- Admins can view all
CREATE POLICY "Admins can view all solicitudes_sesiones"
ON public.solicitudes_cancelacion_sesiones
FOR SELECT
USING (public.has_role(auth.uid(), 'administrador'));

-- Users can insert own
CREATE POLICY "Users can insert own solicitudes_sesiones"
ON public.solicitudes_cancelacion_sesiones
FOR INSERT
WITH CHECK (auth.uid() = solicitante_id);

-- Admins can update
CREATE POLICY "Admins can update solicitudes_sesiones"
ON public.solicitudes_cancelacion_sesiones
FOR UPDATE
USING (public.has_role(auth.uid(), 'administrador'));

-- Trigger for updated_at
CREATE TRIGGER update_solicitudes_cancelacion_sesiones_updated_at
BEFORE UPDATE ON public.solicitudes_cancelacion_sesiones
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitudes_cancelacion_sesiones;
