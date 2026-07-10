-- 1. Tabla generalizada
CREATE TABLE public.coworking_membresias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES public.clientes(id)          ON DELETE RESTRICT,
  tarifa_id   UUID NOT NULL REFERENCES public.tarifas_coworking(id) ON DELETE RESTRICT,
  area_id     UUID NULL     REFERENCES public.areas_coworking(id)   ON DELETE SET NULL,
  usuario_id  UUID NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado IN ('pendiente_pago','activa','vencida','cancelada')),
  horas_totales     NUMERIC NOT NULL DEFAULT 0 CHECK (horas_totales >= 0),
  horas_disponibles NUMERIC NOT NULL DEFAULT 0 CHECK (horas_disponibles >= 0),
  notas TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_membresia_fechas        CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT chk_membresia_horas_consumo CHECK (horas_disponibles <= horas_totales)
);

-- 2. GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coworking_membresias TO authenticated;
GRANT ALL                             ON public.coworking_membresias TO service_role;

-- 3. RLS
ALTER TABLE public.coworking_membresias ENABLE ROW LEVEL SECURITY;

-- 4. Políticas
CREATE POLICY "Membresías: lectura autenticados"
  ON public.coworking_membresias FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Membresías: gestión staff"
  ON public.coworking_membresias FOR ALL
  TO authenticated
  USING (
       public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  )
  WITH CHECK (
       public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  );

-- 5. Trigger updated_at
CREATE TRIGGER trg_update_coworking_membresias_updated_at
BEFORE UPDATE ON public.coworking_membresias
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Índices
CREATE INDEX idx_coworking_membresias_cliente_id ON public.coworking_membresias(cliente_id);
CREATE INDEX idx_coworking_membresias_estado     ON public.coworking_membresias(estado);
CREATE INDEX idx_coworking_membresias_tarifa_id  ON public.coworking_membresias(tarifa_id);
CREATE INDEX idx_coworking_membresias_area_id    ON public.coworking_membresias(area_id);
CREATE INDEX idx_coworking_membresias_estado_fin ON public.coworking_membresias(estado, fecha_fin);