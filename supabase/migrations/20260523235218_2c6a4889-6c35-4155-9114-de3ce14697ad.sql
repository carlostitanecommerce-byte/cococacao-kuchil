
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
  IF v_session.estado NOT IN ('activo', 'pendiente_pago') THEN
    RAISE EXCEPTION 'Solo se pueden cancelar sesiones activas o pendientes de pago (estado actual: %)', v_session.estado
      USING ERRCODE = '22023';
  END IF;

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
    ORDER BY id
  LOOP
    v_entregada_qty := LEAST(COALESCE((v_entregados_map->>COALESCE(v_dv.producto_id::text, v_dv.paquete_id::text))::integer, 0), v_dv.cantidad);
    v_no_entregada_qty := v_dv.cantidad - v_entregada_qty;

    IF v_dv.producto_id IS NOT NULL AND v_dv.paquete_id IS NULL THEN
      IF v_entregada_qty > 0 THEN
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id ORDER BY r.insumo_id LOOP
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
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id ORDER BY r.insumo_id LOOP
          UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_no_entregada_qty)
            WHERE id = v_receta.insumo_id;
        END LOOP;
      END IF;

    ELSIF v_dv.paquete_id IS NOT NULL THEN
      IF v_entregada_qty > 0 THEN
        FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id ORDER BY producto_id LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid ORDER BY r.insumo_id LOOP
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
        FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id ORDER BY producto_id LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid ORDER BY r.insumo_id LOOP
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
