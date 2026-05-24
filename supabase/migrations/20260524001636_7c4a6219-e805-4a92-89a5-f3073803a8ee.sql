-- ─────────────────────────────────────────────────────────────
-- 1. Reverso de movimientos de caja
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.movimientos_caja
  ADD COLUMN IF NOT EXISTS reversa_de uuid REFERENCES public.movimientos_caja(id),
  ADD COLUMN IF NOT EXISTS motivo_reverso text;

CREATE INDEX IF NOT EXISTS idx_movimientos_caja_reversa_de
  ON public.movimientos_caja (reversa_de) WHERE reversa_de IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reversar_movimiento_caja(
  p_movimiento_id uuid,
  p_motivo text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_orig RECORD;
  v_caja_estado caja_estado;
  v_nuevo_id uuid;
  v_tipo_inverso text;
BEGIN
  IF NOT (has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE='42501';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo del reverso es obligatorio';
  END IF;

  SELECT * INTO v_orig FROM public.movimientos_caja
    WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado'; END IF;

  IF v_orig.reversa_de IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede reversar un reverso';
  END IF;

  -- Evitar doble reverso del mismo movimiento
  IF EXISTS (SELECT 1 FROM public.movimientos_caja WHERE reversa_de = p_movimiento_id) THEN
    RAISE EXCEPTION 'Este movimiento ya fue reversado';
  END IF;

  SELECT estado INTO v_caja_estado FROM public.cajas WHERE id = v_orig.caja_id;
  IF v_caja_estado <> 'abierta'::caja_estado THEN
    RAISE EXCEPTION 'No se puede reversar: la caja ya está cerrada';
  END IF;

  v_tipo_inverso := CASE WHEN v_orig.tipo = 'entrada' THEN 'salida' ELSE 'entrada' END;

  INSERT INTO public.movimientos_caja
    (caja_id, usuario_id, tipo, monto, motivo, reversa_de, motivo_reverso)
  VALUES
    (v_orig.caja_id, v_user, v_tipo_inverso, v_orig.monto,
     format('Reverso de %s: %s', v_orig.tipo, v_orig.motivo),
     p_movimiento_id, trim(p_motivo))
  RETURNING id INTO v_nuevo_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'reverso_movimiento_caja',
    format('Reverso de %s por $%s', v_orig.tipo, v_orig.monto::text),
    jsonb_build_object(
      'movimiento_original_id', p_movimiento_id,
      'movimiento_reverso_id', v_nuevo_id,
      'caja_id', v_orig.caja_id,
      'monto', v_orig.monto,
      'tipo_original', v_orig.tipo,
      'motivo_reverso', trim(p_motivo)
    ));

  RETURN json_build_object('ok', true, 'movimiento_reverso_id', v_nuevo_id);
END $$;
REVOKE ALL ON FUNCTION public.reversar_movimiento_caja(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reversar_movimiento_caja(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. cerrar_caja v2: notas obligatorias + bloqueo pendiente_pago + snapshot
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
  v_es_admin boolean;
  v_pendiente_pago_count int;
  v_sesiones_snapshot jsonb;
  v_notas text := NULLIF(trim(coalesce(p_notas_cierre,'')), '');
  v_umbral_dif numeric := 5;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE='42501'; END IF;
  IF NOT (
    has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role) OR
    has_role(v_user,'caja'::app_role) OR has_role(v_user,'recepcion'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE='42501';
  END IF;

  v_es_admin := has_role(v_user,'administrador'::app_role);

  SELECT * INTO v_caja FROM public.cajas
   WHERE id = p_caja_id AND estado = 'abierta'::caja_estado FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caja no encontrada o ya cerrada'; END IF;

  -- Snapshot de sesiones coworking activas o pendientes (para auditoría)
  SELECT
    COUNT(*) FILTER (WHERE estado = 'pendiente_pago'::coworking_estado),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'cliente_nombre', cliente_nombre,
      'estado', estado,
      'monto_acumulado', monto_acumulado,
      'fecha_inicio', fecha_inicio
    )) FILTER (WHERE estado IN ('activo'::coworking_estado,'pendiente_pago'::coworking_estado)),
      '[]'::jsonb)
  INTO v_pendiente_pago_count, v_sesiones_snapshot
  FROM public.coworking_sessions;

  -- Bloquear cierre si hay sesiones pendientes de pago salvo que sea admin con justificación
  IF v_pendiente_pago_count > 0 AND NOT v_es_admin THEN
    RAISE EXCEPTION 'Hay % sesión(es) de coworking pendientes de pago. Cóbralas o pide a un administrador que cierre la caja.', v_pendiente_pago_count;
  END IF;
  IF v_pendiente_pago_count > 0 AND v_es_admin AND v_notas IS NULL THEN
    RAISE EXCEPTION 'Notas de cierre obligatorias: indica por qué se cierra con % sesión(es) pendientes de pago.', v_pendiente_pago_count;
  END IF;

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

  -- Notas obligatorias cuando hay diferencia > umbral
  IF abs(v_diferencia) > v_umbral_dif AND v_notas IS NULL THEN
    RAISE EXCEPTION 'Notas de cierre obligatorias cuando hay diferencia mayor a $%', v_umbral_dif;
  END IF;

  UPDATE public.cajas SET
    estado='cerrada'::caja_estado, monto_cierre=p_monto_cierre,
    fecha_cierre=now(), diferencia=v_diferencia, notas_cierre=v_notas
   WHERE id = p_caja_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'cierre_caja',
    format('Cierre de caja. Esperado: $%s, Contado: $%s, Diferencia: $%s',
      v_esperado::text, p_monto_cierre::text, v_diferencia::text),
    jsonb_build_object(
      'caja_id', p_caja_id,
      'monto_cierre', p_monto_cierre,
      'esperado', v_esperado,
      'diferencia', v_diferencia,
      'notas_cierre', v_notas,
      'sesiones_pendientes_al_cierre', v_sesiones_snapshot,
      'pendiente_pago_count', v_pendiente_pago_count
    ));

  RETURN json_build_object(
    'ok', true,
    'esperado', v_esperado,
    'diferencia', v_diferencia,
    'sesiones_pendientes_count', jsonb_array_length(v_sesiones_snapshot)
  );
END $$;