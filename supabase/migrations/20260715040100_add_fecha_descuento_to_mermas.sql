-- Migración para añadir fecha_descuento a la tabla mermas
-- y redefinir las funciones que insertan mermas de trazabilidad (sin descontar stock).

-- 1. Añadir columna fecha_descuento a la tabla mermas
ALTER TABLE public.mermas ADD COLUMN IF NOT EXISTS fecha_descuento timestamp with time zone NOT NULL DEFAULT now();

-- 2. Actualizar registros existentes para que fecha_descuento coincida con fecha
UPDATE public.mermas SET fecha_descuento = fecha WHERE fecha_descuento IS NULL;

-- 3. Redefinir public.resolver_cancelacion_item_sesion
CREATE OR REPLACE FUNCTION public.resolver_cancelacion_item_sesion(p_cancelacion_id uuid, p_decision text, p_notas text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_cancel RECORD; v_dv RECORD;
  v_nueva_cantidad integer; v_receta RECORD;
  v_total_kds integer; v_cancelados_kds integer; v_mermas integer := 0;
  v_comp RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (public.has_role(v_user, 'administrador'::app_role)
       OR public.has_role(v_user, 'supervisor'::app_role)
       OR public.has_role(v_user, 'barista'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes para resolver cancelación' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('retornado_stock', 'merma', 'rechazado') THEN
    RAISE EXCEPTION 'Decisión inválida: %', p_decision; END IF;

  SELECT * INTO v_cancel FROM public.cancelaciones_items_sesion WHERE id = p_cancelacion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud de cancelación no encontrada'; END IF;
  IF v_cancel.estado <> 'pendiente_decision' THEN
    RAISE EXCEPTION 'Esta solicitud ya fue resuelta (estado: %)', v_cancel.estado; END IF;

  IF p_decision = 'rechazado' THEN
    IF v_cancel.kds_item_id IS NOT NULL THEN
      UPDATE public.kds_order_items
        SET cancel_qty = GREATEST(0, cancel_qty - v_cancel.cantidad),
            cancel_requested = (GREATEST(0, cancel_qty - v_cancel.cantidad) > 0)
      WHERE id = v_cancel.kds_item_id;
    END IF;
    UPDATE public.cancelaciones_items_sesion
       SET estado = 'rechazado', decidido_por = v_user, decided_at = now(), notas_cocina = p_notas
     WHERE id = p_cancelacion_id;
    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (v_user, 'resolver_cancelacion_item_sesion',
            format('Cancelación rechazada: %s ×%s', v_cancel.nombre_producto, v_cancel.cantidad),
            jsonb_build_object('cancelacion_id', p_cancelacion_id, 'decision', 'rechazado', 'notas', p_notas));
    RETURN json_build_object('ok', true, 'decision', 'rechazado');
  END IF;

  IF v_cancel.detalle_id IS NOT NULL THEN
    SELECT * INTO v_dv FROM public.detalle_ventas
      WHERE id = v_cancel.detalle_id AND venta_id IS NULL FOR UPDATE;
  END IF;

  IF v_dv.id IS NOT NULL THEN
    v_nueva_cantidad := v_dv.cantidad - v_cancel.cantidad;

    IF v_dv.producto_id IS NOT NULL AND v_dv.paquete_id IS NULL THEN
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id ORDER BY r.insumo_id LOOP
        IF p_decision = 'retornado_stock' THEN
          UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_cancel.cantidad)
            WHERE id = v_receta.insumo_id;
        ELSE
          INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id, fecha_descuento)
          VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * v_cancel.cantidad,
            format('Cancelación coworking — %s ×%s (sesión %s)',
                   v_cancel.nombre_producto, v_cancel.cantidad, v_dv.coworking_session_id),
            v_user, COALESCE(v_dv.created_at, now()));
          v_mermas := v_mermas + 1;
        END IF;
      END LOOP;

    ELSIF v_dv.paquete_id IS NOT NULL THEN
      FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id ORDER BY producto_id LOOP
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid ORDER BY r.insumo_id LOOP
          IF p_decision = 'retornado_stock' THEN
            UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_comp.qty * v_cancel.cantidad)
              WHERE id = v_receta.insumo_id;
          ELSE
            INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id, fecha_descuento)
            VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * v_comp.qty * v_cancel.cantidad,
              format('Cancelación coworking — paquete %s ×%s (sesión %s)',
                     v_cancel.nombre_producto, v_cancel.cantidad, v_dv.coworking_session_id),
              v_user, COALESCE(v_dv.created_at, now()));
            v_mermas := v_mermas + 1;
          END IF;
        END LOOP;
      END LOOP;
    END IF;

    IF v_nueva_cantidad <= 0 THEN
      DELETE FROM public.detalle_ventas WHERE id = v_dv.id;
    ELSE
      UPDATE public.detalle_ventas
        SET cantidad = v_nueva_cantidad, subtotal = v_dv.precio_unitario * v_nueva_cantidad
      WHERE id = v_dv.id;
    END IF;
  END IF;

  IF v_cancel.kds_item_id IS NOT NULL THEN
    SELECT cantidad, cancel_qty INTO v_total_kds, v_cancelados_kds
      FROM public.kds_order_items WHERE id = v_cancel.kds_item_id FOR UPDATE;
    IF v_total_kds IS NOT NULL THEN
      IF (v_total_kds - v_cancel.cantidad) <= 0 THEN
        DELETE FROM public.kds_order_items WHERE id = v_cancel.kds_item_id;
      ELSE
        UPDATE public.kds_order_items
          SET cantidad = v_total_kds - v_cancel.cantidad,
              cancel_qty = GREATEST(0, v_cancelados_kds - v_cancel.cantidad),
              cancel_requested = (GREATEST(0, v_cancelados_kds - v_cancel.cantidad) > 0)
        WHERE id = v_cancel.kds_item_id;
      END IF;
    END IF;
  END IF;

  UPDATE public.cancelaciones_items_sesion
     SET estado = CASE WHEN p_decision = 'merma' THEN 'merma'::cancelacion_item_estado
                       ELSE 'retornado_stock'::cancelacion_item_estado END,
         decidido_por = v_user, decided_at = now(), notas_cocina = p_notas
   WHERE id = p_cancelacion_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'resolver_cancelacion_item_sesion',
    format('Cancelación resuelta (%s): %s ×%s', p_decision, v_cancel.nombre_producto, v_cancel.cantidad),
    jsonb_build_object('cancelacion_id', p_cancelacion_id, 'decision', p_decision,
      'mermas_creadas', v_mermas, 'transaccional', true));

  RETURN json_build_object('ok', true, 'decision', p_decision, 'mermas', v_mermas);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolver_cancelacion_item_sesion(uuid, text, text) TO authenticated;


-- 4. Redefinir public.recalcular_amenities_pax
CREATE OR REPLACE FUNCTION public.recalcular_amenities_pax(
  p_session_id uuid,
  p_new_pax integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session RECORD;
  v_amenities jsonb;
  v_amenity jsonb;
  v_producto_id uuid;
  v_cant_incluida integer;
  v_nombre text;
  v_existing_id uuid;
  v_old_qty integer;
  v_new_qty integer;
  v_delta integer;
  v_receta RECORD;
  v_stock_actual numeric;
  v_stock_reintegrado integer := 0;
  v_lineas_aumentadas integer := 0;
  v_lineas_reducidas integer := 0;
  v_lineas_eliminadas integer := 0;
  v_total_mermas integer := 0;
  v_increments jsonb := '[]'::jsonb;
  v_created_at timestamp with time zone;
  v_requiere_prep boolean;
  v_kds_items_pending jsonb := '[]'::jsonb;
  v_kds_folio integer := NULL;
  v_kds_order_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
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

    SELECT id, cantidad, created_at INTO v_existing_id, v_old_qty, v_created_at
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
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id, fecha_descuento)
        VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * abs(v_delta),
          format('Recalc amenities por baja de pax — %s ×%s (sesión %s, %s pax → %s pax)',
                 v_nombre, abs(v_delta), v_session.cliente_nombre, v_session.pax_count, p_new_pax),
          v_user, COALESCE(v_created_at, now()));
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
$$;

GRANT EXECUTE ON FUNCTION public.recalcular_amenities_pax(uuid, integer) TO authenticated;


-- 5. Redefinir public.cancelar_sesion_coworking
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
  v_dv_created_at timestamp with time zone;
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
    
    v_dv_created_at := NULL;
    IF NULLIF(v_item->>'id', '') IS NOT NULL THEN
      SELECT created_at INTO v_dv_created_at
      FROM public.detalle_ventas WHERE id = (v_item->>'id')::uuid;
    END IF;

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

          INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id, fecha_descuento)
          VALUES (
            v_receta.insumo_id,
            v_cant_descontar,
            format('Entrega paquete en sesión cancelada — %s (%s · %s ×%s)',
                   v_session.cliente_nombre,
                   COALESCE(v_item->>'nombre', 'paquete'),
                   (SELECT nombre FROM public.productos WHERE id = v_comp.pid),
                   (v_item->>'cantidad')),
            v_user_id,
            COALESCE(v_dv_created_at, now())
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

        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id, fecha_descuento)
        VALUES (
          v_receta.insumo_id,
          v_cant_descontar,
          format('Entrega en sesión cancelada — %s (%s ×%s)',
                 v_session.cliente_nombre,
                 COALESCE(v_item->>'nombre', 'producto'),
                 v_item->>'cantidad'),
          v_user_id,
          COALESCE(v_dv_created_at, now())
        );
        v_mermas_creadas := v_mermas_creadas + 1;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_dv IN
    SELECT id, producto_id, cantidad, paquete_id, tipo_concepto, created_at
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

GRANT EXECUTE ON FUNCTION public.cancelar_sesion_coworking(uuid, text, jsonb, uuid, boolean) TO authenticated;
