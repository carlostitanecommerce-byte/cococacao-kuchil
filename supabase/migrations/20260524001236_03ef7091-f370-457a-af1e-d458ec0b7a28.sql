-- ─────────────────────────────────────────────────────────────
-- 1. Validaciones de servidor para cajas y movimientos
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validar_movimiento_caja()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.monto IS NULL OR NEW.monto <= 0 THEN
    RAISE EXCEPTION 'El monto del movimiento debe ser mayor a cero';
  END IF;
  IF NEW.motivo IS NULL OR length(trim(NEW.motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo del movimiento es obligatorio';
  END IF;
  IF NEW.tipo NOT IN ('entrada','salida') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', NEW.tipo;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validar_movimiento_caja ON public.movimientos_caja;
CREATE TRIGGER trg_validar_movimiento_caja
  BEFORE INSERT ON public.movimientos_caja
  FOR EACH ROW EXECUTE FUNCTION public.validar_movimiento_caja();

CREATE OR REPLACE FUNCTION public.validar_apertura_caja()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.monto_apertura IS NULL OR NEW.monto_apertura < 0 THEN
    RAISE EXCEPTION 'El monto de apertura no puede ser negativo';
  END IF;
  IF NEW.monto_apertura > 10000 THEN
    RAISE EXCEPTION 'El monto de apertura no puede exceder $10,000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validar_apertura_caja ON public.cajas;
CREATE TRIGGER trg_validar_apertura_caja
  BEFORE INSERT ON public.cajas
  FOR EACH ROW EXECUTE FUNCTION public.validar_apertura_caja();

-- ─────────────────────────────────────────────────────────────
-- 2. Configuración: umbral para aprobación de movimientos
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.configuracion_ventas (clave, valor)
VALUES ('umbral_movimiento_caja', 500)
ON CONFLICT (clave) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3. Tabla solicitudes_movimiento_caja
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.solicitud_movimiento_estado AS ENUM ('pendiente','aprobada','rechazada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.solicitudes_movimiento_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caja_id uuid NOT NULL,
  solicitante_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('entrada','salida')),
  monto numeric NOT NULL CHECK (monto > 0),
  motivo text NOT NULL,
  estado public.solicitud_movimiento_estado NOT NULL DEFAULT 'pendiente',
  revisado_por uuid,
  motivo_rechazo text,
  movimiento_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_mov_caja_estado
  ON public.solicitudes_movimiento_caja (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sol_mov_caja_solicitante
  ON public.solicitudes_movimiento_caja (solicitante_id);

ALTER TABLE public.solicitudes_movimiento_caja ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operadores ven sus solicitudes" ON public.solicitudes_movimiento_caja;
CREATE POLICY "Operadores ven sus solicitudes"
  ON public.solicitudes_movimiento_caja FOR SELECT
  TO authenticated
  USING (auth.uid() = solicitante_id);

DROP POLICY IF EXISTS "Admin y supervisor ven todas las solicitudes" ON public.solicitudes_movimiento_caja;
CREATE POLICY "Admin y supervisor ven todas las solicitudes"
  ON public.solicitudes_movimiento_caja FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'administrador'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role));

-- Insert/update se hacen vía RPC SECURITY DEFINER; no se exponen policies.

CREATE OR REPLACE FUNCTION public.update_sol_mov_caja_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sol_mov_caja_updated_at ON public.solicitudes_movimiento_caja;
CREATE TRIGGER trg_sol_mov_caja_updated_at
  BEFORE UPDATE ON public.solicitudes_movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION public.update_sol_mov_caja_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. RPC registrar_movimiento_caja (decide directo vs solicitud)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja(
  p_tipo text,
  p_monto numeric,
  p_motivo text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_caja_id uuid;
  v_umbral numeric;
  v_es_admin_sup boolean;
  v_es_operador boolean;
  v_mov_id uuid;
  v_sol_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE='42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'Motivo obligatorio';
  END IF;
  IF p_tipo NOT IN ('entrada','salida') THEN
    RAISE EXCEPTION 'Tipo inválido';
  END IF;

  v_es_admin_sup := has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role);
  v_es_operador  := v_es_admin_sup OR has_role(v_user,'caja'::app_role) OR has_role(v_user,'recepcion'::app_role);

  IF NOT v_es_operador THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE='42501';
  END IF;

  SELECT id INTO v_caja_id FROM public.cajas
   WHERE estado = 'abierta'::caja_estado
   ORDER BY fecha_apertura DESC LIMIT 1;
  IF v_caja_id IS NULL THEN
    RAISE EXCEPTION 'No hay caja abierta';
  END IF;

  SELECT COALESCE(valor, 500) INTO v_umbral
    FROM public.configuracion_ventas WHERE clave = 'umbral_movimiento_caja';
  IF v_umbral IS NULL THEN v_umbral := 500; END IF;

  -- Admin/supervisor siempre directo; operadores solo si < umbral
  IF v_es_admin_sup OR p_monto < v_umbral THEN
    INSERT INTO public.movimientos_caja (caja_id, usuario_id, tipo, monto, motivo)
    VALUES (v_caja_id, v_user, p_tipo, p_monto, trim(p_motivo))
    RETURNING id INTO v_mov_id;

    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (v_user,
      CASE WHEN p_tipo='entrada' THEN 'entrada_caja' ELSE 'salida_caja' END,
      format('%s de caja: $%s - %s',
        CASE WHEN p_tipo='entrada' THEN 'Entrada' ELSE 'Salida' END,
        p_monto::text, trim(p_motivo)),
      jsonb_build_object('caja_id', v_caja_id, 'tipo', p_tipo, 'monto', p_monto, 'motivo', trim(p_motivo), 'movimiento_id', v_mov_id)
    );

    RETURN json_build_object('ok', true, 'pending', false, 'movimiento_id', v_mov_id);
  ELSE
    INSERT INTO public.solicitudes_movimiento_caja (caja_id, solicitante_id, tipo, monto, motivo)
    VALUES (v_caja_id, v_user, p_tipo, p_monto, trim(p_motivo))
    RETURNING id INTO v_sol_id;

    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (v_user, 'solicitud_movimiento_caja',
      format('Solicitud de %s por $%s - %s',
        CASE WHEN p_tipo='entrada' THEN 'entrada' ELSE 'salida' END,
        p_monto::text, trim(p_motivo)),
      jsonb_build_object('solicitud_id', v_sol_id, 'caja_id', v_caja_id, 'tipo', p_tipo, 'monto', p_monto, 'umbral', v_umbral)
    );

    RETURN json_build_object('ok', true, 'pending', true, 'solicitud_id', v_sol_id, 'umbral', v_umbral);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.registrar_movimiento_caja(text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_caja(text,numeric,text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. RPC aprobar / rechazar solicitud
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_movimiento_caja(p_solicitud_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sol RECORD;
  v_caja_estado caja_estado;
  v_mov_id uuid;
BEGIN
  IF NOT (has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes_movimiento_caja
    WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solicitud ya procesada';
  END IF;

  SELECT estado INTO v_caja_estado FROM public.cajas WHERE id = v_sol.caja_id;
  IF v_caja_estado <> 'abierta'::caja_estado THEN
    RAISE EXCEPTION 'La caja ya no está abierta';
  END IF;

  INSERT INTO public.movimientos_caja (caja_id, usuario_id, tipo, monto, motivo)
  VALUES (v_sol.caja_id, v_sol.solicitante_id, v_sol.tipo, v_sol.monto,
    v_sol.motivo || ' (aprobado)')
  RETURNING id INTO v_mov_id;

  UPDATE public.solicitudes_movimiento_caja
    SET estado='aprobada', revisado_por=v_user, movimiento_id=v_mov_id
    WHERE id = p_solicitud_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'aprobar_movimiento_caja',
    format('Aprobada %s por $%s', v_sol.tipo, v_sol.monto::text),
    jsonb_build_object('solicitud_id', p_solicitud_id, 'movimiento_id', v_mov_id,
      'caja_id', v_sol.caja_id, 'tipo', v_sol.tipo, 'monto', v_sol.monto));

  RETURN json_build_object('ok', true, 'movimiento_id', v_mov_id);
END $$;
REVOKE ALL ON FUNCTION public.aprobar_movimiento_caja(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprobar_movimiento_caja(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rechazar_movimiento_caja(p_solicitud_id uuid, p_motivo text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sol RECORD;
BEGIN
  IF NOT (has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_sol FROM public.solicitudes_movimiento_caja
    WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solicitud ya procesada';
  END IF;

  UPDATE public.solicitudes_movimiento_caja
    SET estado='rechazada', revisado_por=v_user, motivo_rechazo=NULLIF(trim(coalesce(p_motivo,'')),'')
    WHERE id = p_solicitud_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'rechazar_movimiento_caja',
    format('Rechazada %s por $%s', v_sol.tipo, v_sol.monto::text),
    jsonb_build_object('solicitud_id', p_solicitud_id, 'caja_id', v_sol.caja_id,
      'tipo', v_sol.tipo, 'monto', v_sol.monto, 'motivo_rechazo', p_motivo));

  RETURN json_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.rechazar_movimiento_caja(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rechazar_movimiento_caja(uuid,text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. Asignación automática de caja_id en ventas + backfill
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asignar_caja_id_venta()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_caja_id uuid;
BEGIN
  IF NEW.caja_id IS NULL THEN
    SELECT id INTO v_caja_id FROM public.cajas
      WHERE estado = 'abierta'::caja_estado
      ORDER BY fecha_apertura DESC LIMIT 1;
    IF v_caja_id IS NOT NULL THEN
      NEW.caja_id := v_caja_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_asignar_caja_id_venta ON public.ventas;
CREATE TRIGGER trg_asignar_caja_id_venta
  BEFORE INSERT ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.asignar_caja_id_venta();

-- Backfill: asignar caja_id a ventas históricas sin él, buscando turno
-- (abierto o cerrado) cuyo intervalo contenga la fecha de la venta.
UPDATE public.ventas v
   SET caja_id = c.id
  FROM public.cajas c
 WHERE v.caja_id IS NULL
   AND v.fecha >= c.fecha_apertura
   AND (c.fecha_cierre IS NULL OR v.fecha <= c.fecha_cierre);

-- ─────────────────────────────────────────────────────────────
-- 7. RPC cerrar_caja: ya no incluye ventas con caja_id NULL
-- (backfill + trigger garantizan asignación)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cerrar_caja(
  p_caja_id uuid, p_monto_cierre numeric, p_notas_cierre text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_caja RECORD;
  v_ventas_efectivo numeric;
  v_entradas numeric;
  v_salidas numeric;
  v_esperado numeric;
  v_diferencia numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE='42501'; END IF;
  IF NOT (
    has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role) OR
    has_role(v_user,'caja'::app_role) OR has_role(v_user,'recepcion'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_caja FROM public.cajas
   WHERE id = p_caja_id AND estado = 'abierta'::caja_estado FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caja no encontrada o ya cerrada'; END IF;

  SELECT COALESCE(SUM(monto_efectivo),0) INTO v_ventas_efectivo
    FROM public.ventas
   WHERE estado='completada'::venta_estado AND caja_id = p_caja_id;

  SELECT
    COALESCE(SUM(CASE WHEN tipo='entrada' THEN monto ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN tipo='salida'  THEN monto ELSE 0 END),0)
    INTO v_entradas, v_salidas
    FROM public.movimientos_caja WHERE caja_id = p_caja_id;

  v_esperado := v_caja.monto_apertura + v_ventas_efectivo + v_entradas - v_salidas;
  v_diferencia := p_monto_cierre - v_esperado;

  UPDATE public.cajas SET
    estado='cerrada'::caja_estado, monto_cierre=p_monto_cierre,
    fecha_cierre=now(), diferencia=v_diferencia, notas_cierre=p_notas_cierre
   WHERE id = p_caja_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'cierre_caja',
    format('Cierre de caja. Esperado: $%s, Contado: $%s, Diferencia: $%s',
      v_esperado::text, p_monto_cierre::text, v_diferencia::text),
    jsonb_build_object('caja_id', p_caja_id, 'monto_cierre', p_monto_cierre,
      'esperado', v_esperado, 'diferencia', v_diferencia, 'notas_cierre', p_notas_cierre));

  RETURN json_build_object('ok', true, 'esperado', v_esperado, 'diferencia', v_diferencia);
END $$;

-- Realtime para solicitudes
ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitudes_movimiento_caja;