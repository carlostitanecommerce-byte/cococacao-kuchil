-- Reapply: fix cancellation/consumo RPCs to not cast 'paquete' to tipo_concepto enum.
-- The enum only contains ('producto','coworking','amenity'); paquetes are detected via paquete_id IS NOT NULL.

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

    -- Caso B: línea de paquete (paquete_id IS NOT NULL)
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

    -- Caso B: paquete
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


CREATE OR REPLACE FUNCTION public.registrar_consumo_coworking(p_session_id uuid, p_items jsonb, p_kds_items jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_session RECORD;
  v_item jsonb;
  v_kds_item jsonb;
  v_producto_id uuid;
  v_cantidad integer;
  v_tipo_concepto text;
  v_paquete_id uuid;
  v_componentes jsonb;
  v_componente jsonb;
  v_receta RECORD;
  v_total numeric := 0;
  v_lineas integer := 0;
  v_kds_order_id uuid := NULL;
  v_kds_folio integer := NULL;
  v_requiere_prep boolean;
  v_kds_rows jsonb := '[]'::jsonb;
  v_sufijo text;
  v_uso jsonb := '{}'::jsonb;
  v_insumo_id uuid;
  v_nombre_insumo text;
  v_stock_actual numeric;
  v_uso_total numeric;
  v_comp_pid uuid;
  v_comp_qty numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_role(v_user, 'administrador'::app_role)
    OR has_role(v_user, 'caja'::app_role)
    OR has_role(v_user, 'recepcion'::app_role)
    OR has_role(v_user, 'supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes para cargar consumo a coworking' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No hay ítems para cargar';
  END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de coworking no encontrada';
  END IF;
  IF v_session.estado NOT IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado) THEN
    RAISE EXCEPTION 'La sesión no acepta cargos (estado: %)', v_session.estado;
  END IF;

  v_sufijo := format('(coworking — %s)', v_session.cliente_nombre);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_tipo_concepto := COALESCE(v_item->>'tipo_concepto', 'producto');
    v_cantidad := COALESCE((v_item->>'cantidad')::integer, 0);
    v_producto_id := NULLIF(v_item->>'producto_id','')::uuid;
    v_paquete_id := NULLIF(v_item->>'paquete_id','')::uuid;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida en ítem';
    END IF;

    IF v_tipo_concepto = 'paquete' THEN
      IF v_paquete_id IS NULL THEN
        RAISE EXCEPTION 'Paquete sin id';
      END IF;
      v_componentes := v_item->'componentes';
      IF v_componentes IS NULL OR jsonb_typeof(v_componentes) <> 'array' OR jsonb_array_length(v_componentes) = 0 THEN
        FOR v_componente IN
          SELECT jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad) AS j
          FROM public.paquete_componentes WHERE paquete_id = v_paquete_id
        LOOP
          v_comp_pid := (v_componente->>'producto_id')::uuid;
          v_comp_qty := (v_componente->>'cantidad')::numeric;
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp_pid LOOP
            v_uso := jsonb_set(v_uso, ARRAY[v_receta.insumo_id::text],
              to_jsonb(COALESCE((v_uso->>v_receta.insumo_id::text)::numeric, 0)
                       + (v_receta.cantidad_necesaria * v_comp_qty * v_cantidad)));
          END LOOP;
        END LOOP;
      ELSE
        FOR v_componente IN SELECT * FROM jsonb_array_elements(v_componentes)
        LOOP
          v_comp_pid := (v_componente->>'producto_id')::uuid;
          v_comp_qty := (v_componente->>'cantidad')::numeric;
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp_pid LOOP
            v_uso := jsonb_set(v_uso, ARRAY[v_receta.insumo_id::text],
              to_jsonb(COALESCE((v_uso->>v_receta.insumo_id::text)::numeric, 0)
                       + (v_receta.cantidad_necesaria * v_comp_qty * v_cantidad)));
          END LOOP;
        END LOOP;
      END IF;
    ELSE
      IF v_producto_id IS NULL THEN
        RAISE EXCEPTION 'Producto sin id';
      END IF;
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_producto_id LOOP
        v_uso := jsonb_set(v_uso, ARRAY[v_receta.insumo_id::text],
          to_jsonb(COALESCE((v_uso->>v_receta.insumo_id::text)::numeric, 0)
                   + (v_receta.cantidad_necesaria * v_cantidad)));
      END LOOP;
    END IF;
  END LOOP;

  FOR v_insumo_id IN SELECT (jsonb_object_keys(v_uso))::uuid
  LOOP
    SELECT stock_actual, nombre INTO v_stock_actual, v_nombre_insumo
      FROM public.insumos WHERE id = v_insumo_id FOR UPDATE;
    v_uso_total := (v_uso->>v_insumo_id::text)::numeric;
    IF v_stock_actual < v_uso_total THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": disponible %, requerido para este cargo %',
        v_nombre_insumo, v_stock_actual, v_uso_total;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_tipo_concepto := COALESCE(v_item->>'tipo_concepto', 'producto');
    v_cantidad := (v_item->>'cantidad')::integer;
    v_producto_id := NULLIF(v_item->>'producto_id','')::uuid;
    v_paquete_id := NULLIF(v_item->>'paquete_id','')::uuid;
    v_componentes := v_item->'componentes';

    INSERT INTO public.detalle_ventas (
      venta_id, producto_id, cantidad, precio_unitario, subtotal,
      tipo_concepto, coworking_session_id, descripcion, paquete_id, paquete_nombre
    ) VALUES (
      NULL, v_producto_id, v_cantidad,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'subtotal')::numeric,
      (CASE WHEN v_tipo_concepto = 'paquete' THEN 'producto' ELSE v_tipo_concepto END)::tipo_concepto, p_session_id,
      v_item->>'descripcion', v_paquete_id, v_item->>'paquete_nombre'
    );

    v_total := v_total + (v_item->>'subtotal')::numeric;
    v_lineas := v_lineas + 1;

    IF v_tipo_concepto = 'paquete' THEN
      IF v_componentes IS NOT NULL AND jsonb_typeof(v_componentes) = 'array' AND jsonb_array_length(v_componentes) > 0 THEN
        FOR v_componente IN SELECT * FROM jsonb_array_elements(v_componentes) LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = (v_componente->>'producto_id')::uuid LOOP
            UPDATE public.insumos
              SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * (v_componente->>'cantidad')::numeric * v_cantidad)
              WHERE id = v_receta.insumo_id;
          END LOOP;
        END LOOP;
      ELSE
        FOR v_componente IN
          SELECT jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad) AS j
          FROM public.paquete_componentes WHERE paquete_id = v_paquete_id
        LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = (v_componente->>'producto_id')::uuid LOOP
            UPDATE public.insumos
              SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * (v_componente->>'cantidad')::numeric * v_cantidad)
              WHERE id = v_receta.insumo_id;
          END LOOP;
        END LOOP;
      END IF;
    ELSE
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_producto_id LOOP
        UPDATE public.insumos
          SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * v_cantidad)
          WHERE id = v_receta.insumo_id;
      END LOOP;
    END IF;
  END LOOP;

  IF p_kds_items IS NOT NULL AND jsonb_typeof(p_kds_items) = 'array' AND jsonb_array_length(p_kds_items) > 0 THEN
    FOR v_kds_item IN SELECT * FROM jsonb_array_elements(p_kds_items) LOOP
      v_producto_id := NULLIF(v_kds_item->>'producto_id','')::uuid;
      IF v_producto_id IS NULL THEN CONTINUE; END IF;
      SELECT requiere_preparacion INTO v_requiere_prep FROM public.productos WHERE id = v_producto_id;
      IF v_requiere_prep IS DISTINCT FROM false THEN
        v_kds_rows := v_kds_rows || jsonb_build_array(v_kds_item);
      END IF;
    END LOOP;

    IF jsonb_array_length(v_kds_rows) > 0 THEN
      v_kds_folio := nextval('public.kds_coworking_folio_seq')::integer;
      INSERT INTO public.kds_orders (venta_id, coworking_session_id, folio, tipo_consumo, estado)
      VALUES (NULL, p_session_id, v_kds_folio, 'sitio', 'pendiente'::kds_estado)
      RETURNING id INTO v_kds_order_id;

      INSERT INTO public.kds_order_items (kds_order_id, producto_id, nombre_producto, cantidad, notas)
      SELECT v_kds_order_id, (k->>'producto_id')::uuid,
        CASE WHEN COALESCE((k->>'is_amenity')::boolean, false)
             THEN format('%s ☕ %s', k->>'nombre', v_sufijo)
             ELSE format('%s %s', k->>'nombre', v_sufijo) END,
        (k->>'cantidad')::integer, NULLIF(k->>'notas','')
      FROM jsonb_array_elements(v_kds_rows) AS k;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'coworking_open_account_charge',
    format('Cargo a cuenta abierta de %s · %s líneas · $%s',
           v_session.cliente_nombre, v_lineas, round(v_total::numeric, 2)),
    jsonb_build_object('session_id', p_session_id, 'lineas', v_lineas, 'total', v_total,
      'kds_order_id', v_kds_order_id, 'kds_folio', v_kds_folio, 'transaccional', true));

  RETURN json_build_object('ok', true, 'kds_order_id', v_kds_order_id,
    'kds_folio', v_kds_folio, 'lineas_insertadas', v_lineas, 'total', v_total);
END;
$function$;
