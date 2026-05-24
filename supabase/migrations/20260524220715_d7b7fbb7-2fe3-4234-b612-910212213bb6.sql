-- ENUM de estados
CREATE TYPE public.orden_pos_estado AS ENUM ('pendiente', 'cobrada', 'cancelada');

-- Secuencia para folio
CREATE SEQUENCE public.ordenes_pos_folio_seq START 1;

-- Tabla principal
CREATE TABLE public.ordenes_pos_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio INTEGER NOT NULL DEFAULT nextval('public.ordenes_pos_folio_seq'),
  usuario_id UUID NOT NULL,
  caja_id UUID,
  cliente_nombre TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  tipo_consumo TEXT NOT NULL DEFAULT 'sitio',
  notas TEXT,
  estado public.orden_pos_estado NOT NULL DEFAULT 'pendiente',
  venta_id UUID,
  cancelada_por UUID,
  motivo_cancelacion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ordenes_pos_estado ON public.ordenes_pos_pendientes(estado);
CREATE INDEX idx_ordenes_pos_caja   ON public.ordenes_pos_pendientes(caja_id);

-- Trigger updated_at
CREATE TRIGGER trg_ordenes_pos_updated
BEFORE UPDATE ON public.ordenes_pos_pendientes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.ordenes_pos_pendientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ordenes_pos"
ON public.ordenes_pos_pendientes FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Operadores pueden insertar ordenes_pos"
ON public.ordenes_pos_pendientes FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = usuario_id AND (
    has_role(auth.uid(), 'administrador'::app_role) OR
    has_role(auth.uid(), 'supervisor'::app_role)    OR
    has_role(auth.uid(), 'caja'::app_role)          OR
    has_role(auth.uid(), 'recepcion'::app_role)
  )
);

CREATE POLICY "Operadores pueden actualizar ordenes_pos"
ON public.ordenes_pos_pendientes FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'administrador'::app_role) OR
  has_role(auth.uid(), 'supervisor'::app_role)    OR
  has_role(auth.uid(), 'caja'::app_role)          OR
  has_role(auth.uid(), 'recepcion'::app_role)
);

CREATE POLICY "Admins pueden eliminar ordenes_pos"
ON public.ordenes_pos_pendientes FOR DELETE
TO authenticated USING (has_role(auth.uid(), 'administrador'::app_role));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ordenes_pos_pendientes;
ALTER TABLE public.ordenes_pos_pendientes REPLICA IDENTITY FULL;