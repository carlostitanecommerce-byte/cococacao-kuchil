
-- Create audit_logs table
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  accion text NOT NULL,
  descripcion text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view all logs
CREATE POLICY "Admins can view all audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'administrador'));

-- Authenticated users can insert their own logs
CREATE POLICY "Authenticated users can insert own logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role inserts (edge functions) bypass RLS, so no extra policy needed

-- Index for fast queries
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs (user_id);

-- Create cajas table
CREATE TYPE public.caja_estado AS ENUM ('abierta', 'cerrada');

CREATE TABLE public.cajas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  monto_apertura numeric(12,2) NOT NULL DEFAULT 0,
  monto_cierre numeric(12,2),
  estado public.caja_estado NOT NULL DEFAULT 'abierta',
  fecha_apertura timestamp with time zone NOT NULL DEFAULT now(),
  fecha_cierre timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cajas ENABLE ROW LEVEL SECURITY;

-- Admins and supervisors can view all cajas
CREATE POLICY "Admins can manage all cajas"
  ON public.cajas FOR ALL
  USING (public.has_role(auth.uid(), 'administrador'));

CREATE POLICY "Supervisors can view all cajas"
  ON public.cajas FOR SELECT
  USING (public.has_role(auth.uid(), 'supervisor'));

-- Caja users can view and manage their own
CREATE POLICY "Users can view own cajas"
  ON public.cajas FOR SELECT
  USING (auth.uid() = usuario_id);

CREATE POLICY "Users can insert own cajas"
  ON public.cajas FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Users can update own cajas"
  ON public.cajas FOR UPDATE
  USING (auth.uid() = usuario_id);

-- Trigger for updated_at
CREATE TRIGGER update_cajas_updated_at
  BEFORE UPDATE ON public.cajas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
