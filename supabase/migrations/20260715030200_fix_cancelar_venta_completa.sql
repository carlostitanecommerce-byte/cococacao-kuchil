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
  v_d RECORD;
  v_r RECORD;
  v_reintegrados integer := 0;
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

  -- 1. Bloquear venta
  SELECT * INTO v_venta FROM public.ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF v_venta.estado = 'cancelada'::venta_estado THEN
    RAISE EXCEPTION 'La venta ya está cancelada';
  END IF;

  -- 2. Reintegrar stock SOLO para items que NO son de cuenta abierta coworking.
  --    Items de cuenta abierta: tienen coworking_session_id y su stock ya fue
  --    descontado por registrar_consumo_coworking (no por el INSERT trigger).
  --    Al reabrir (paso 3) permanecen con stock descontado para re-checkout.
  --
  --    Items POS normales (sin coworking_session_id): su stock fue descontado
  --    por el trigger descontar_inventario_venta. Debemos reintegrarlo.
  FOR v_d IN
    SELECT producto_id, cantidad
    FROM public.detalle_ventas
    WHERE venta_id = p_venta_id
      AND producto_id IS NOT NULL
      AND coworking_session_id IS NULL  -- Solo items POS, no coworking
    ORDER BY producto_id
  LOOP
    FOR v_r IN
      SELECT insumo_id, cantidad_necesaria
      FROM public.recetas
      WHERE producto_id = v_d.producto_id
      ORDER BY insumo_id
    LOOP
      UPDATE public.insumos
      SET stock_actual = stock_actual + (v_r.cantidad_necesaria * v_d.cantidad)
      WHERE id = v_r.insumo_id;
      v_reintegrados := v_reintegrados + 1;
    END LOOP;
  END LOOP;

  -- 3. Reabrir items de cuenta abierta (venta_id → NULL)
  --    Estos items permanecerán en detalle_ventas con venta_id = NULL,
  --    listos para ser re-estampados cuando la sesión se cobre de nuevo.
  UPDATE public.detalle_ventas
  SET venta_id = NULL
  WHERE venta_id = p_venta_id
    AND coworking_session_id IS NOT NULL;
  GET DIAGNOSTICS v_reopened = ROW_COUNT;

  -- 4. Cancelar órdenes KDS asociadas
  UPDATE public.kds_orders
  SET estado = 'cancelada'::kds_estado
  WHERE venta_id = p_venta_id
    AND estado <> 'cancelada'::kds_estado;
  GET DIAGNOSTICS v_kds_canceladas = ROW_COUNT;

  -- 5. Revertir sesión coworking si aplica
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

  -- 6. Marcar venta como cancelada
  --    NOTA: El trigger reintegrar_inventario_cancelacion se disparará,
  --    pero solo encontrará items SIN coworking_session_id (los de cuenta
  --    abierta ya fueron desvinculados en paso 3). Para evitar DOBLE
  --    reintegración, desactivamos temporalmente el trigger.
  --    Alternativa más simple: los items POS ya fueron reintegrados en paso 2,
  --    así que el trigger encontrará los mismos items y los volvería a reintegrar.
  --    SOLUCIÓN: Eliminamos los detalles POS ANTES de la cancelación para que
  --    el trigger no los encuentre. No — eso rompe la auditoría.
  --
  --    Mejor solución: Marcamos primero la venta como cancelada SIN trigger,
  --    o bien nos aseguramos de que el paso 2 y el trigger no se pisen.
  --    Como ya reintegramos en paso 2, necesitamos evitar que el trigger
  --    reintegre de nuevo. Pero no podemos desactivar triggers per-transaction
  --    fácilmente. La solución: ya que los items de coworking fueron desvinculados
  --    (paso 3), y los items POS ya fueron reintegrados (paso 2), simplemente
  --    NO usamos el trigger — usamos una columna flag para indicar que la
  --    reintegración ya se hizo.
  --    
  --    Enfoque final: reintegramos SOLO los items coworking reopened aquí
  --    (NO en paso 2), y dejamos que el trigger reintegre los items POS.
  --    Esto evita duplicación porque:
  --    - Items coworking: desvinculados (paso 3), trigger no los ve ✅
  --    - Items POS: trigger los reintegra ✅

  -- REVERTIR paso 2: el trigger lo hará por nosotros para items POS
  -- Re-descontar lo que reintegramos en paso 2
  FOR v_d IN
    SELECT producto_id, cantidad
    FROM public.detalle_ventas
    WHERE venta_id = p_venta_id
      AND producto_id IS NOT NULL
      AND coworking_session_id IS NULL
    ORDER BY producto_id
  LOOP
    FOR v_r IN
      SELECT insumo_id, cantidad_necesaria
      FROM public.recetas
      WHERE producto_id = v_d.producto_id
      ORDER BY insumo_id
    LOOP
      UPDATE public.insumos
      SET stock_actual = stock_actual - (v_r.cantidad_necesaria * v_d.cantidad)
      WHERE id = v_r.insumo_id;
    END LOOP;
  END LOOP;
  -- Ahora el stock está como antes del paso 2.
  -- El trigger reintegrar_inventario_cancelacion se encargará de los items POS.

  UPDATE public.ventas
  SET estado = 'cancelada'::venta_estado,
      motivo_cancelacion = trim(p_motivo)
  WHERE id = p_venta_id;
  -- El trigger reintegrar_inventario_cancelacion se dispara aquí y reintegra
  -- stock de items POS (los que tienen venta_id = p_venta_id y producto_id NOT NULL).
  -- Los items coworking ya fueron desvinculados (venta_id = NULL) así que el trigger los ignora.

  -- 7. Audit log enriquecido
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

  -- 8. Si fue aprobación de solicitud, actualizar la solicitud
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
