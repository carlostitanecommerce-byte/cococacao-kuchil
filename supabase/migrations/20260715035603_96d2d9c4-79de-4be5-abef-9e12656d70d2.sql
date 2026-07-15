-- =============================================================================
-- FIX Bug 1 + Bug 4: recalcular_amenities_pax
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalcular_amenities_pax(p_session_id uuid, p_new_pax integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_session RECORD;
  v_amenity jsonb;
  v_amenities jsonb;
  v_producto_id uuid;
  v_cant_incluida integer;
  v_nombre text;
  v_old_qty integer;
  v_new_qty integer;
  v_delta integer;
  v_existing_id uuid;
  v_receta RECORD;
  v_stock_actual numeric;
  v_increments jsonb := '[]'::jsonb;
  v_total_mermas integer := 0;
  v_lineas_aumentadas integer := 0;
  v_lineas_reducidas integer := 0;
  v_lineas_eliminadas integer := 0;
  v_kds_folio integer := NULL;
  v_kds_order_id uuid := NULL;
  v_requiere_prep boolean;
  v_kds_items_pending jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (has_role(v_user, 'administrador'::app_role) OR has_role(v_user, 'supervisor'::app_role)
          OR has_role(v_user, 'recepcion'::app_role) OR has_role(v_user, 'caja'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes para recalcular amenities' USING ERRCODE = '42501';
  END IF;
  IF p_new_pax IS NULL OR p_new_pax < 0 THEN RAISE EXCEPTION 'pax inválido: %', p_new_pax; END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;
  IF v_session.estado <> 'activo'::coworking_estado THEN
    RAISE EXCEPTION 'Solo se pueden recalcular amenities en sesiones activas (estado: %)', v_session.estado;
  END IF;

  v_amenities := COALESCE(v_session.tarifa_snapshot->'amenities', '[]'::jsonb);
  IF jsonb_typeof(v_amenities) <> 'array' OR jsonb_array_length(v_amenities) = 0 THEN
    RETURN json_build_object('ok', true, 'increments', '[]'::jsonb,
      'mermas_creadas', 0, 'lineas_aumentadas', 0, 'lineas_reducidas', 0, 'lineas_eliminadas', 0);
  END IF;

  FOR v_amenity IN SELECT * FROM jsonb_array_elements(v_amenities) LOOP
    v_producto_id := NULLIF(v_amenity->>'producto_id','')::uuid;
    v_cant_incluida := COALESCE((v_amenity->>'cantidad_incluida')::integer, 0);
    v_nombre := COALESCE(v_amenity->>'nombre', 'Amenity');

    IF v_producto_id IS NULL THEN CONTINUE; END IF;

    v_new_qty := v_cant_incluida * p_new_pax;

    SELECT id, cantidad INTO v_existing_id, v_old_qty
      FROM public.detalle_ventas
     WHERE coworking_session_id = p_session_id AND venta_id IS NULL
       AND producto_id = v_producto_id AND tipo_concepto = 'amenity'::tipo_concepto
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

    v_old_qty := COALESCE(v_old_qty, 0);
    v_delta := v_new_qty - v_old_qty;

    IF v_delta = 0 AND v_existing_id IS NOT NULL THEN CONTINUE; END IF;

    IF v_delta > 0 THEN
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria, i.nombre AS insumo_nombre
        FROM public.recetas r
        JOIN public.insumos i ON i.id = r.insumo_id
        WHERE r.producto_id = v_producto_id
        ORDER BY r.insumo_id
      LOOP
        SELECT stock_actual INTO v_stock_actual
          FROM public.insumos WHERE id = v_receta.insumo_id FOR UPDATE;
        IF v_stock_actual < (v_receta.cantidad_necesaria * v_delta) THEN
          RAISE EXCEPTION 'Stock insuficiente de "%" para recalcular amenities: disponible %, requerido %',
            v_receta.insumo_nombre, v_stock_actual, v_receta.cantidad_necesaria * v_delta;
        END IF;
      END LOOP;

      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
        FROM public.recetas r
        WHERE r.producto_id = v_producto_id
        ORDER BY r.insumo_id
      LOOP
        UPDATE public.insumos
           SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * v_delta)
         WHERE id = v_receta.insumo_id;
      END LOOP;

      IF v_existing_id IS NOT NULL THEN
        UPDATE public.detalle_ventas SET cantidad = v_new_qty, subtotal = 0 WHERE id = v_existing_id;
      ELSE
        INSERT INTO public.detalle_ventas (
          venta_id, producto_id, cantidad, precio_unitario, subtotal,
          tipo_concepto, coworking_session_id
        ) VALUES (
          NULL, v_producto_id, v_new_qty, 0, 0, 'amenity'::tipo_concepto, p_session_id);
      END IF;
      v_lineas_aumentadas := v_lineas_aumentadas + 1;
      v_increments := v_increments || jsonb_build_array(jsonb_build_object(
        'producto_id', v_producto_id, 'nombre', v_nombre, 'cantidad', v_delta));

      SELECT requiere_preparacion INTO v_requiere_prep FROM public.productos WHERE id = v_producto_id;
      IF v_requiere_prep IS DISTINCT FROM false THEN
        v_kds_items_pending := v_kds_items_pending || jsonb_build_array(jsonb_build_object(
          'producto_id', v_producto_id, 'nombre', v_nombre, 'cantidad', v_delta));
      END IF;

    ELSIF v_delta < 0 AND v_existing_id IS NOT NULL THEN
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
          FROM public.recetas r
         WHERE r.producto_id = v_producto_id
         ORDER BY r.insumo_id
      LOOP
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * abs(v_delta),
          format('Recalc amenities por baja de pax — %s ×%s (sesión %s, %s pax → %s pax)',
                 v_nombre, abs(v_delta), v_session.cliente_nombre, v_session.pax_count, p_new_pax),
          v_user);
        v_total_mermas := v_total_mermas + 1;
      END LOOP;

      IF v_new_qty <= 0 THEN
        DELETE FROM public.detalle_ventas WHERE id = v_existing_id;
        v_lineas_eliminadas := v_lineas_eliminadas + 1;
      ELSE
        UPDATE public.detalle_ventas SET cantidad = v_new_qty, subtotal = 0 WHERE id = v_existing_id;
        v_lineas_reducidas := v_lineas_reducidas + 1;
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_kds_items_pending) > 0 THEN
    v_kds_folio := nextval('public.kds_coworking_folio_seq')::integer;
    INSERT INTO public.kds_orders (venta_id, coworking_session_id, folio, tipo_consumo, estado)
    VALUES (NULL, p_session_id, v_kds_folio, 'sitio', 'pendiente'::kds_estado)
    RETURNING id INTO v_kds_order_id;

    INSERT INTO public.kds_order_items (kds_order_id, producto_id, nombre_producto, cantidad, notas)
    SELECT v_kds_order_id,
      (k->>'producto_id')::uuid,
      format('%s ☕ (coworking — %s)', k->>'nombre', v_session.cliente_nombre),
      (k->>'cantidad')::integer,
      NULL
    FROM jsonb_array_elements(v_kds_items_pending) AS k;
  END IF;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'recalcular_amenities_pax',
    format('Recalc amenities por cambio de pax (sesión %s, %s → %s pax)',
           v_session.cliente_nombre, v_session.pax_count, p_new_pax),
    jsonb_build_object('session_id', p_session_id, 'old_pax', v_session.pax_count, 'new_pax', p_new_pax,
      'increments', v_increments, 'mermas_creadas', v_total_mermas,
      'lineas_aumentadas', v_lineas_aumentadas, 'lineas_reducidas', v_lineas_reducidas,
      'lineas_eliminadas', v_lineas_eliminadas, 'kds_folio', v_kds_folio, 'transaccional', true));

  RETURN json_build_object('ok', true, 'increments', v_increments,
    'mermas_creadas', v_total_mermas, 'lineas_aumentadas', v_lineas_aumentadas,
    'lineas_reducidas', v_lineas_reducidas, 'lineas_eliminadas', v_lineas_eliminadas,
    'kds_folio', v_kds_folio);
END;
$function$;

-- =============================================================================
-- FIX Bug 2: cancelar_sesion_coworking
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancelar_sesion_coworking(
  p_session_id uuid,
  p_motivo text,
  p_entregados jsonb,
  p_solicitud_id uuid DEFAULT NULL,
  p_is_admin boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session RECORD;
  v_item jsonb;
  v_receta RECORD;
  v_cant_descontar numeric;
  v_mermas_creadas integer := 0;
  v_total_entregados integer := 0;
  v_stock_reintegrado integer := 0;
  v_descripcion_audit text;
  v_solicitante_id uuid;
  v_dv RECORD;
  v_comp RECORD;
  v_delivered_qty numeric;
  v_cant_reintegrar numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;

  IF v_session.estado <> 'activo' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar sesiones activas (estado actual: %)', v_session.estado;
  END IF;

  IF p_is_admin THEN
    IF NOT public.has_role(v_user_id, 'administrador') THEN
      RAISE EXCEPTION 'Acción restringida a administradores' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_session.usuario_id <> v_user_id AND NOT public.has_role(v_user_id, 'administrador') THEN
      RAISE EXCEPTION 'No tienes permiso para cancelar esta sesión' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb))
  LOOP
    v_total_entregados := v_total_entregados + 1;
    
    IF NULLIF(v_item->>'paquete_id', '') IS NOT NULL THEN
      FOR v_comp IN
        SELECT producto_id AS pid, cantidad AS qty
        FROM public.paquete_componentes
        WHERE paquete_id = (v_item->>'paquete_id')::uuid
      LOOP
        FOR v_receta IN
          SELECT r.insumo_id, r.cantidad_necesaria
          FROM public.recetas r
          WHERE r.producto_id = v_comp.pid
        LOOP
          v_cant_descontar := v_receta.cantidad_necesaria * v_comp.qty * (v_item->>'cantidad')::numeric;
          IF v_cant_descontar <= 0 THEN CONTINUE; END IF;

          INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
          VALUES (
            v_receta.insumo_id,
            v_cant_descontar,
            format('Entrega paquete en sesión cancelada — %s (%s · %s ×%s)',
                   v_session.cliente_nombre,
                   COALESCE(v_item->>'nombre', 'paquete'),
                   (SELECT nombre FROM public.productos WHERE id = v_comp.pid),
                   (v_item->>'cantidad')),
            v_user_id
          );
          v_mermas_creadas := v_mermas_creadas + 1;
        END LOOP;
      END LOOP;
    ELSIF NULLIF(v_item->>'producto_id', '') IS NOT NULL THEN
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
        FROM public.recetas r
        WHERE r.producto_id = (v_item->>'producto_id')::uuid
      LOOP
        v_cant_descontar := v_receta.cantidad_necesaria * (v_item->>'cantidad')::numeric;
        IF v_cant_descontar <= 0 THEN CONTINUE; END IF;

        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (
          v_receta.insumo_id,
          v_cant_descontar,
          format('Entrega en sesión cancelada — %s (%s ×%s)',
                 v_session.cliente_nombre,
                 COALESCE(v_item->>'nombre', 'producto'),
                 v_item->>'cantidad'),
          v_user_id
        );
        v_mermas_creadas := v_mermas_creadas + 1;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_dv IN
    SELECT id, producto_id, cantidad, paquete_id, tipo_concepto
    FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id
      AND venta_id IS NULL
    ORDER BY id
  LOOP
    v_delivered_qty := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb))
    LOOP
      IF NULLIF(v_item->>'id', '') = v_dv.id::text THEN
        v_delivered_qty := (v_item->>'cantidad')::numeric;
        EXIT;
      END IF;
    END LOOP;

    v_cant_reintegrar := v_dv.cantidad - v_delivered_qty;

    IF v_cant_reintegrar > 0 THEN
      IF v_dv.paquete_id IS NOT NULL THEN
        FOR v_comp IN
          SELECT producto_id AS pid, cantidad AS qty
          FROM public.paquete_componentes
          WHERE paquete_id = v_dv.paquete_id
          ORDER BY producto_id
        LOOP
          FOR v_receta IN
            SELECT r.insumo_id, r.cantidad_necesaria
            FROM public.recetas r
            WHERE r.producto_id = v_comp.pid
            ORDER BY r.insumo_id
          LOOP
            UPDATE public.insumos
            SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_comp.qty * v_cant_reintegrar)
            WHERE id = v_receta.insumo_id;
            v_stock_reintegrado := v_stock_reintegrado + 1;
          END LOOP;
        END LOOP;
      ELSIF v_dv.producto_id IS NOT NULL THEN
        FOR v_receta IN
          SELECT r.insumo_id, r.cantidad_necesaria
          FROM public.recetas r
          WHERE r.producto_id = v_dv.producto_id
          ORDER BY r.insumo_id
        LOOP
          UPDATE public.insumos
          SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_cant_reintegrar)
          WHERE id = v_receta.insumo_id;
          v_stock_reintegrado := v_stock_reintegrado + 1;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.coworking_session_upsells WHERE session_id = p_session_id;

  DELETE FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id AND venta_id IS NULL;

  UPDATE public.coworking_sessions
  SET estado = 'cancelado',
      monto_acumulado = 0,
      fecha_salida_real = now()
  WHERE id = p_session_id;

  IF p_solicitud_id IS NOT NULL THEN
    UPDATE public.solicitudes_cancelacion_sesiones
    SET estado = 'aprobada',
        revisado_por = v_user_id
    WHERE id = p_solicitud_id
    RETURNING solicitante_id INTO v_solicitante_id;
  END IF;

  v_descripcion_audit := CASE
    WHEN p_solicitud_id IS NOT NULL THEN
      format('Cancelación aprobada — Cliente: %s · Entregados: %s item(s) · %s merma(s) · %s reintegro(s)',
             v_session.cliente_nombre, v_total_entregados, v_mermas_creadas, v_stock_reintegrado)
    ELSE
      format('Cancelación directa — Cliente: %s · Entregados: %s item(s) · %s merma(s) · %s reintegro(s)',
             v_session.cliente_nombre, v_total_entregados, v_mermas_creadas, v_stock_reintegrado)
  END;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user_id,
    CASE WHEN p_solicitud_id IS NOT NULL THEN 'aprobar_cancelacion_sesion'
         ELSE 'cancelar_sesion_coworking' END,
    v_descripcion_audit,
    jsonb_build_object(
      'session_id', p_session_id,
      'area_id', v_session.area_id,
      'cliente_nombre', v_session.cliente_nombre,
      'pax_count', v_session.pax_count,
      'motivo', p_motivo,
      'entregados', p_entregados,
      'mermas_creadas', v_mermas_creadas,
      'stock_reintegrado', v_stock_reintegrado,
      'solicitud_id', p_solicitud_id,
      'aprobado_por', CASE WHEN p_solicitud_id IS NOT NULL THEN v_user_id ELSE NULL END,
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'session_id', p_session_id,
    'mermas_creadas', v_mermas_creadas,
    'entregados_count', v_total_entregados,
    'stock_reintegrado', v_stock_reintegrado
  );
END;
$$;

-- =============================================================================
-- FIX Bug 3: RPC atómica cancelar_venta_completa
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