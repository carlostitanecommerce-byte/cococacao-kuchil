
-- Enum for solicitud states
CREATE TYPE public.solicitud_cancelacion_estado AS ENUM ('pendiente', 'aprobada', 'rechazada');

-- Table
CREATE TABLE public.solicitudes_cancelacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id uuid NOT NULL REFERENCES public.ventas(id),
  solicitante_id uuid NOT NULL,
  motivo text NOT NULL,
  estado solicitud_cancelacion_estado NOT NULL DEFAULT 'pendiente',
  revisado_por uuid,
  motivo_rechazo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Updated_at trigger
CREATE TRIGGER update_solicitudes_cancelacion_updated_at
  BEFORE UPDATE ON public.solicitudes_cancelacion
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.solicitudes_cancelacion ENABLE ROW LEVEL SECURITY;

-- RLS: users can view their own requests
CREATE POLICY "Users can view own solicitudes"
  ON public.solicitudes_cancelacion FOR SELECT
  USING (auth.uid() = solicitante_id);

-- RLS: admins can view all
CREATE POLICY "Admins can view all solicitudes"
  ON public.solicitudes_cancelacion FOR SELECT
  USING (public.has_role(auth.uid(), 'administrador'));

-- RLS: authenticated users can insert their own
CREATE POLICY "Users can insert own solicitudes"
  ON public.solicitudes_cancelacion FOR INSERT
  WITH CHECK (auth.uid() = solicitante_id);

-- RLS: admins can update (approve/reject)
CREATE POLICY "Admins can update solicitudes"
  ON public.solicitudes_cancelacion FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrador'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitudes_cancelacion;
