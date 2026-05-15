-- Fix for cancellation and return-to-stock logic for packages

CREATE OR REPLACE FUNCTION public.cancelar_sesion_coworking(p_session_id uuid, p_motivo text, p_entregados jsonb, p_solicitud_id uuid DEFAULT NULL::uuid, p_is_admin boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_session RECORD; v_item jsonb; v_dv RECORD;
  v_receta RECORD; v_entregada_qty integer; v_no_entregada_qty integer;
  v_mermas_creadas integer := 0; v_total_entregados integer := 0;
  v_descripcion_audit text; v_solicitante_id uuid; v_entregados_map jsonb := '{}'::jsonb;
  v_comp RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;
  IF v_session.estado <> 'activo' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar sesiones activas (estado actual: %)', v_session.estado; END IF;

  IF p_is_admin THEN
    IF NOT public.has_role(v_user_id, 'administrador') THEN
      RAISE EXCEPTION 'Acción restringida a administradores' USING ERRCODE = '42501'; END IF;
  ELSE
    IF v_session.usuario_id <> v_user_id AND NOT public.has_role(v_user_id, 'administrador') THEN
      RAISE EXCEPTION 'No tienes permiso para cancelar esta sesión' USING ERRCODE = '42501'; END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb)) LOOP
    v_total_entregados := v_total_entregados + 1;
    v_entregados_map := jsonb_set(v_entregados_map, ARRAY[(v_item->>'producto_id')],
      to_jsonb(COALESCE((v_entregados_map->>(v_item->>'producto_id'))::integer, 0)
               + (v_item->>'cantidad')::integer));
  END LOOP;

  FOR v_dv IN
    SELECT id, producto_id, paquete_id, tipo_concepto, cantidad, descripcion
    FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id AND venta_id IS NULL
  LOOP
    v_entregada_qty := LEAST(COALESCE((v_entregados_map->>COALESCE(v_dv.producto_id::text, v_dv.paquete_id::text))::integer, 0), v_dv.cantidad);
    v_no_entregada_qty := v_dv.cantidad - v_entregada_qty;

    -- Caso A: línea de producto simple
    IF v_dv.producto_id IS NOT NULL AND v_dv.paquete_id IS NULL THEN
      IF v_entregada_qty > 0 THEN
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id LOOP
          INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
          VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * v_entregada_qty,
            format('Entrega en sesión cancelada — %s (%s ×%s)',
                   v_session.cliente_nombre, COALESCE(v_dv.descripcion, 'producto'), v_entregada_qty),
            v_user_id);
          v_mermas_creadas := v_mermas_creadas + 1;
        END LOOP;
        v_entregados_map := jsonb_set(v_entregados_map, ARRAY[v_dv.producto_id::text],
          to_jsonb(GREATEST(0, COALESCE((v_entregados_map->>v_dv.producto_id::text)::integer, 0) - v_entregada_qty)));
      END IF;
      IF v_no_entregada_qty > 0 THEN
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id LOOP
          UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_no_entregada_qty)
            WHERE id = v_receta.insumo_id;
        END LOOP;
      END IF;

    -- Caso B: línea de paquete (producto_id NULL, paquete_id IS NOT NULL)
    ELSIF v_dv.paquete_id IS NOT NULL THEN
      IF v_entregada_qty > 0 THEN
        FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid LOOP
            INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
            VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * v_comp.qty * v_entregada_qty,
              format('Entrega en sesión cancelada — paquete %s (×%s)',
                     COALESCE(v_dv.descripcion, 'paquete'), v_entregada_qty),
              v_user_id);
            v_mermas_creadas := v_mermas_creadas + 1;
          END LOOP;
        END LOOP;
      END IF;
      IF v_no_entregada_qty > 0 THEN
        FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid LOOP
            UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_comp.qty * v_no_entregada_qty)
              WHERE id = v_receta.insumo_id;
          END LOOP;
        END LOOP;
      END IF;
    END IF;

    DELETE FROM public.detalle_ventas WHERE id = v_dv.id;
  END LOOP;

  UPDATE public.coworking_sessions
    SET estado = 'cancelado', monto_acumulado = 0, fecha_salida_real = now()
    WHERE id = p_session_id;

  IF p_solicitud_id IS NOT NULL THEN
    UPDATE public.solicitudes_cancelacion_sesiones
      SET estado = 'aprobada', revisado_por = v_user_id
      WHERE id = p_solicitud_id RETURNING solicitante_id INTO v_solicitante_id;
  END IF;

  v_descripcion_audit := CASE
    WHEN p_solicitud_id IS NOT NULL THEN
      format('Cancelación aprobada — Cliente: %s · Entregados: %s item(s) · %s merma(s)',
             v_session.cliente_nombre, v_total_entregados, v_mermas_creadas)
    ELSE
      format('Cancelación directa — Cliente: %s · Entregados: %s item(s) · %s merma(s)',
             v_session.cliente_nombre, v_total_entregados, v_mermas_creadas)
  END;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user_id,
    CASE WHEN p_solicitud_id IS NOT NULL THEN 'aprobar_cancelacion_sesion' ELSE 'cancelar_sesion_coworking' END,
    v_descripcion_audit,
    jsonb_build_object('session_id', p_session_id, 'area_id', v_session.area_id,
      'cliente_nombre', v_session.cliente_nombre, 'pax_count', v_session.pax_count,
      'motivo', p_motivo, 'entregados', p_entregados, 'mermas_creadas', v_mermas_creadas,
      'solicitud_id', p_solicitud_id,
      'aprobado_por', CASE WHEN p_solicitud_id IS NOT NULL THEN v_user_id ELSE NULL END,
      'transaccional', true));

  RETURN json_build_object('ok', true, 'session_id', p_session_id,
    'mermas_creadas', v_mermas_creadas, 'entregados_count', v_total_entregados);
END;
$function$;

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

    -- Caso A: producto simple
    IF v_dv.producto_id IS NOT NULL AND v_dv.paquete_id IS NULL THEN
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id LOOP
        IF p_decision = 'retornado_stock' THEN
          UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_cancel.cantidad)
            WHERE id = v_receta.insumo_id;
        ELSE
          INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
          VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * v_cancel.cantidad,
            format('Cancelación coworking — %s ×%s (sesión %s)',
                   v_cancel.nombre_producto, v_cancel.cantidad, v_dv.coworking_session_id),
            v_user);
          v_mermas := v_mermas + 1;
        END IF;
      END LOOP;

    -- Caso B: paquete (producto_id NULL, paquete_id IS NOT NULL)
    ELSIF v_dv.paquete_id IS NOT NULL THEN
      FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id LOOP
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid LOOP
          IF p_decision = 'retornado_stock' THEN
            UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_comp.qty * v_cancel.cantidad)
              WHERE id = v_receta.insumo_id;
          ELSE
            INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
            VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * v_comp.qty * v_cancel.cantidad,
              format('Cancelación coworking — paquete %s ×%s (sesión %s)',
                     v_cancel.nombre_producto, v_cancel.cantidad, v_dv.coworking_session_id),
              v_user);
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

CREATE OR REPLACE FUNCTION public.solicitar_cancelacion_item_sesion(
  p_session_id uuid,
  p_detalle_id uuid,
  p_cantidad integer,
  p_motivo text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dv RECORD;
  v_pendientes integer;
  v_disponible integer;
  v_nombre text;
  v_kds_order_id uuid;
  v_kds_item_id uuid;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 4 THEN
    RAISE EXCEPTION 'Motivo requerido (mínimo 4 caracteres)';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad < 1 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  SELECT * INTO v_dv
    FROM public.detalle_ventas
   WHERE id = p_detalle_id
     AND coworking_session_id = p_session_id
     AND venta_id IS NULL
   FOR UPDATE;

  IF v_dv.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada o ya facturada';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0) INTO v_pendientes
    FROM public.cancelaciones_items_sesion
   WHERE detalle_id = p_detalle_id
     AND estado = 'pendiente_decision';

  v_disponible := v_dv.cantidad - v_pendientes;
  IF p_cantidad > v_disponible THEN
    RAISE EXCEPTION 'Cantidad excede lo disponible para cancelar (máx %)', v_disponible;
  END IF;

  -- Nombre del producto (puede venir de productos o del paquete_nombre)
  IF v_dv.producto_id IS NOT NULL THEN
    SELECT nombre INTO v_nombre FROM public.productos WHERE id = v_dv.producto_id;
  END IF;
  IF v_nombre IS NULL THEN
    v_nombre := COALESCE(v_dv.paquete_nombre, v_dv.descripcion, 'Producto/Paquete');
  END IF;

  -- Buscar último kds_order_items abierto que coincida
  IF v_dv.producto_id IS NOT NULL THEN
    SELECT koi.id, koi.kds_order_id INTO v_kds_item_id, v_kds_order_id
      FROM public.kds_order_items koi
      JOIN public.kds_orders ko ON ko.id = koi.kds_order_id
     WHERE ko.coworking_session_id = p_session_id
       AND koi.producto_id = v_dv.producto_id
       AND ko.estado <> 'listo'
     ORDER BY koi.created_at DESC
     LIMIT 1;
  ELSE
    -- Es un paquete (producto_id IS NULL). Enlazamos a la orden más reciente activa de la sesión
    -- para que la cocina reciba la alerta general.
    SELECT id INTO v_kds_order_id
      FROM public.kds_orders
     WHERE coworking_session_id = p_session_id
       AND estado <> 'listo'
     ORDER BY created_at DESC
     LIMIT 1;
    -- v_kds_item_id stays NULL because a package consists of multiple items in KDS
  END IF;

  INSERT INTO public.cancelaciones_items_sesion (
    session_id, detalle_id, producto_id, nombre_producto,
    cantidad, motivo, solicitante_id, kds_order_id, kds_item_id
  ) VALUES (
    p_session_id, p_detalle_id, v_dv.producto_id, v_nombre,
    p_cantidad, p_motivo, v_user, v_kds_order_id, v_kds_item_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'solicitar_cancelacion_item_sesion',
    format('Solicitud cancelación: %s ×%s', v_nombre, p_cantidad),
    jsonb_build_object(
      'cancelacion_id', v_id,
      'detalle_id', p_detalle_id,
      'session_id', p_session_id,
      'cantidad', p_cantidad,
      'kds_item_id', v_kds_item_id,
      'kds_order_id', v_kds_order_id
    )
  );

  RETURN json_build_object('ok', true, 'cancelacion_id', v_id);
END;
$$;
