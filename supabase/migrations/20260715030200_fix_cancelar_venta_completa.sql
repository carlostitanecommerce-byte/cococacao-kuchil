-- =============================================================================
-- FIX Bug 3: RPC atómica cancelar_venta_completa
--
-- PROBLEMA: cancelacionVentaUtils.ts ejecuta pasos secuenciales desde el frontend
-- (reabrir items, cancelar KDS, revertir coworking, cancelar venta) sin transacción.
-- Si algún paso falla, el estado queda inconsistente.
-- Además, al desvincular items de cuenta abierta ANTES de cancelar la venta,
-- el trigger reintegrar_inventario_cancelacion no los encuentra y no devuelve su stock.
--
-- FIX: RPC atómica que ejecuta todo en una sola transacción SQL, con lógica
-- correcta para distinguir items POS (reintegrar) de items coworking open account
-- (no reintegrar porque su stock ya fue descontado por registrar_consumo_coworking).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancelar_venta_completa(
  p_venta_id uuid,
  p_motivo text,
  p_post_cierre boolean DEFAULT false,
  p_caja_folio integer DEFAULT NULL,
  p_solicitud_id uuid DEFAULT NULL,
  p_accion_override text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_venta RECORD;
  v_reopened integer := 0;
  v_kds_canceladas integer := 0;
  v_coworking_revertida boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo de cancelación es obligatorio';
  END IF;

  SELECT * INTO v_venta FROM public.ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF v_venta.estado = 'cancelada'::venta_estado THEN
    RAISE EXCEPTION 'La venta ya está cancelada';
  END IF;

  -- Reabrir items de cuenta abierta (venta_id → NULL) ANTES de cancelar la venta,
  -- para que el trigger reintegrar_inventario_cancelacion NO los toque.
  UPDATE public.detalle_ventas
  SET venta_id = NULL
  WHERE venta_id = p_venta_id
    AND coworking_session_id IS NOT NULL;
  GET DIAGNOSTICS v_reopened = ROW_COUNT;

  UPDATE public.kds_orders
  SET estado = 'cancelada'::kds_estado
  WHERE venta_id = p_venta_id
    AND estado <> 'cancelada'::kds_estado;
  GET DIAGNOSTICS v_kds_canceladas = ROW_COUNT;

  IF v_venta.coworking_session_id IS NOT NULL THEN
    UPDATE public.coworking_sessions
    SET estado = 'pendiente_pago'::coworking_estado,
        fecha_salida_real = NULL
    WHERE id = v_venta.coworking_session_id
      AND estado = 'finalizado'::coworking_estado;
    IF FOUND THEN
      v_coworking_revertida := true;
    END IF;
  END IF;

  -- El trigger reintegrar_inventario_cancelacion se dispara al UPDATE y reintegra
  -- stock solo de los items POS restantes (los coworking ya fueron desvinculados).
  UPDATE public.ventas
  SET estado = 'cancelada'::venta_estado,
      motivo_cancelacion = trim(p_motivo)
  WHERE id = p_venta_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    COALESCE(p_accion_override,
      CASE WHEN p_post_cierre THEN 'correccion_post_cierre' ELSE 'cancelar_venta' END),
    CASE WHEN p_post_cierre
      THEN format('Corrección post-cierre: cancelación de venta $%s (turno %s) por %s. Motivo: %s',
                  round((v_venta.total_bruto + COALESCE(v_venta.monto_propina, 0))::numeric, 2),
                  COALESCE('Nro.' || p_caja_folio, 'cerrado'),
                  COALESCE((SELECT nombre FROM profiles WHERE id = v_user), 'Admin'),
                  trim(p_motivo))
      ELSE format('Venta $%s cancelada. Motivo: %s',
                  round((v_venta.total_bruto + COALESCE(v_venta.monto_propina, 0))::numeric, 2),
                  trim(p_motivo))
    END,
    jsonb_build_object(
      'venta_id', p_venta_id,
      'folio', v_venta.folio,
      'total', v_venta.total_bruto + COALESCE(v_venta.monto_propina, 0),
      'motivo', trim(p_motivo),
      'lineas_open_account_reabiertas', v_reopened,
      'stock_reintegrado_por_trigger', true,
      'kds_canceladas', v_kds_canceladas,
      'coworking_session_revertida', v_coworking_revertida,
      'correccion_post_cierre', p_post_cierre,
      'solicitud_id', p_solicitud_id,
      'transaccional', true
    )
  );

  IF p_solicitud_id IS NOT NULL THEN
    UPDATE public.solicitudes_cancelacion
    SET estado = 'aprobada',
        revisado_por = v_user
    WHERE id = p_solicitud_id::uuid;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'lineas_open_account_reabiertas', v_reopened,
    'stock_revertido', true,
    'kds_canceladas', v_kds_canceladas,
    'coworking_revertida', v_coworking_revertida
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancelar_venta_completa(uuid, text, boolean, integer, uuid, text) TO authenticated;
