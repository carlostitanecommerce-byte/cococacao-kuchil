-- B2: Quitar doble-conteo de stock comprometido en validaciones
-- (registrar_consumo_coworking ya descontó físicamente del stock_actual)
CREATE OR REPLACE FUNCTION public.validar_stock_disponible(p_producto_id uuid, p_cantidad integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receta RECORD;
BEGIN
  FOR v_receta IN
    SELECT r.insumo_id, r.cantidad_necesaria, i.stock_actual, i.nombre
    FROM public.recetas r JOIN public.insumos i ON i.id = r.insumo_id
    WHERE r.producto_id = p_producto_id
  LOOP
    IF v_receta.stock_actual < (v_receta.cantidad_necesaria * p_cantidad) THEN
      RETURN json_build_object('valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre || '. Disponible: ' || v_receta.stock_actual);
    END IF;
  END LOOP;
  RETURN json_build_object('valido', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_stock_carrito(p_items jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb; v_uso_acumulado jsonb := '{}'::jsonb; v_receta RECORD;
  v_uso_carrito NUMERIC; v_cant integer; v_prod uuid;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_prod := (v_item->>'producto_id')::uuid; v_cant := (v_item->>'cantidad')::integer;
    IF v_prod IS NULL THEN CONTINUE; END IF;
    FOR v_receta IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = v_prod LOOP
      v_uso_acumulado := jsonb_set(v_uso_acumulado, ARRAY[v_receta.insumo_id::text],
        to_jsonb(COALESCE((v_uso_acumulado->>v_receta.insumo_id::text)::numeric, 0)
                 + (v_receta.cantidad_necesaria * v_cant)));
    END LOOP;
  END LOOP;

  FOR v_receta IN
    SELECT i.id AS insumo_id, i.stock_actual, i.nombre FROM public.insumos i
    WHERE i.id::text IN (SELECT jsonb_object_keys(v_uso_acumulado))
  LOOP
    v_uso_carrito := (v_uso_acumulado->>v_receta.insumo_id::text)::numeric;
    IF v_receta.stock_actual < v_uso_carrito THEN
      RETURN json_build_object('valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre
                 || '. Disponible: ' || v_receta.stock_actual || ', requerido: ' || v_uso_carrito);
    END IF;
  END LOOP;
  RETURN json_build_object('valido', true);
END;
$function$;

-- B1: Cancelación de paquete en coworking debe devolver/mermar inventario de componentes
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
    IF v_dv.producto_id IS NOT NULL AND v_dv.tipo_concepto <> 'paquete'::tipo_concepto THEN
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

    -- Caso B: línea de paquete (producto_id NULL, tipo_concepto='paquete')
    ELSIF v_dv.tipo_concepto = 'paquete'::tipo_concepto AND v_dv.paquete_id IS NOT NULL THEN
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

-- B1 (parte 2): resolver_cancelacion_item_sesion debe manejar paquetes
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
    IF v_dv.producto_id IS NOT NULL AND v_dv.tipo_concepto <> 'paquete'::tipo_concepto THEN
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

    -- Caso B: paquete (producto_id NULL)
    ELSIF v_dv.tipo_concepto = 'paquete'::tipo_concepto AND v_dv.paquete_id IS NOT NULL THEN
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