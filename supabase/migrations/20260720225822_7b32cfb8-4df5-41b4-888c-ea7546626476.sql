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
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;

  -- Cambio 3: sesión ya cancelada + solicitud pendiente → cerrar idempotentemente
  IF v_session.estado = 'cancelado' AND p_solicitud_id IS NOT NULL THEN
    IF NOT public.has_role(v_user_id,'administrador') THEN
      RAISE EXCEPTION 'Acción restringida a administradores' USING ERRCODE='42501';
    END IF;
    UPDATE public.solicitudes_cancelacion_sesiones
       SET estado='aprobada', revisado_por=v_user_id,
           motivo_rechazo=COALESCE(motivo_rechazo,'Sesión ya cancelada previamente — solicitud cerrada')
     WHERE id=p_solicitud_id RETURNING solicitante_id INTO v_solicitante_id;
    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (v_user_id, 'cerrar_solicitud_obsoleta',
      format('Solicitud cerrada (sesión ya cancelada) — Cliente: %s', v_session.cliente_nombre),
      jsonb_build_object('session_id', p_session_id, 'solicitud_id', p_solicitud_id, 'motivo', p_motivo));
    RETURN json_build_object('ok', true, 'session_id', p_session_id, 'ya_cancelada', true,
      'mermas_creadas', 0, 'entregados_count', 0);
  END IF;

  -- Cambio 1: aceptar activo y pendiente_pago
  IF v_session.estado NOT IN ('activo', 'pendiente_pago') THEN
    RAISE EXCEPTION 'Solo se pueden cancelar sesiones activas o pendientes de pago (estado actual: %)', v_session.estado
      USING ERRCODE = '22023';
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

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb)) LOOP
    v_total_entregados := v_total_entregados + 1;
    IF NULLIF(v_item->>'paquete_id', '') IS NOT NULL THEN
      FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = (v_item->>'paquete_id')::uuid LOOP
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid LOOP
          v_cant_descontar := v_receta.cantidad_necesaria * v_comp.qty * (v_item->>'cantidad')::numeric;
          IF v_cant_descontar <= 0 THEN CONTINUE; END IF;
          INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
          VALUES (v_receta.insumo_id, v_cant_descontar,
            format('Entrega paquete en sesión cancelada — %s (%s · %s ×%s)',
              v_session.cliente_nombre, COALESCE(v_item->>'nombre','paquete'),
              (SELECT nombre FROM public.productos WHERE id = v_comp.pid), (v_item->>'cantidad')),
            v_user_id);
          v_mermas_creadas := v_mermas_creadas + 1;
        END LOOP;
      END LOOP;
    ELSIF NULLIF(v_item->>'producto_id', '') IS NOT NULL THEN
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = (v_item->>'producto_id')::uuid LOOP
        v_cant_descontar := v_receta.cantidad_necesaria * (v_item->>'cantidad')::numeric;
        IF v_cant_descontar <= 0 THEN CONTINUE; END IF;
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (v_receta.insumo_id, v_cant_descontar,
          format('Entrega en sesión cancelada — %s (%s ×%s)',
            v_session.cliente_nombre, COALESCE(v_item->>'nombre','producto'), v_item->>'cantidad'),
          v_user_id);
        v_mermas_creadas := v_mermas_creadas + 1;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_dv IN SELECT id, producto_id, cantidad, paquete_id, tipo_concepto FROM public.detalle_ventas WHERE coworking_session_id = p_session_id AND venta_id IS NULL ORDER BY id LOOP
    v_delivered_qty := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb)) LOOP
      IF NULLIF(v_item->>'id','') = v_dv.id::text THEN
        v_delivered_qty := (v_item->>'cantidad')::numeric; EXIT;
      END IF;
    END LOOP;
    v_cant_reintegrar := v_dv.cantidad - v_delivered_qty;
    IF v_cant_reintegrar > 0 THEN
      IF v_dv.paquete_id IS NOT NULL THEN
        FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id ORDER BY producto_id LOOP
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid ORDER BY r.insumo_id LOOP
            UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_comp.qty * v_cant_reintegrar) WHERE id = v_receta.insumo_id;
            v_stock_reintegrado := v_stock_reintegrado + 1;
          END LOOP;
        END LOOP;
      ELSIF v_dv.producto_id IS NOT NULL THEN
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id ORDER BY r.insumo_id LOOP
          UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_cant_reintegrar) WHERE id = v_receta.insumo_id;
          v_stock_reintegrado := v_stock_reintegrado + 1;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.coworking_session_upsells WHERE session_id = p_session_id;
  DELETE FROM public.detalle_ventas WHERE coworking_session_id = p_session_id AND venta_id IS NULL;

  -- Cambio 2: preservar fecha_salida_real si ya existe
  UPDATE public.coworking_sessions
     SET estado='cancelado', monto_acumulado=0,
         fecha_salida_real = COALESCE(fecha_salida_real, now())
   WHERE id = p_session_id;

  IF p_solicitud_id IS NOT NULL THEN
    UPDATE public.solicitudes_cancelacion_sesiones SET estado='aprobada', revisado_por=v_user_id
    WHERE id=p_solicitud_id RETURNING solicitante_id INTO v_solicitante_id;
  END IF;

  v_descripcion_audit := CASE WHEN p_solicitud_id IS NOT NULL THEN
    format('Cancelación aprobada — Cliente: %s · Entregados: %s item(s) · %s merma(s) · %s reintegro(s)', v_session.cliente_nombre, v_total_entregados, v_mermas_creadas, v_stock_reintegrado)
    ELSE format('Cancelación directa — Cliente: %s · Entregados: %s item(s) · %s merma(s) · %s reintegro(s)', v_session.cliente_nombre, v_total_entregados, v_mermas_creadas, v_stock_reintegrado) END;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user_id, CASE WHEN p_solicitud_id IS NOT NULL THEN 'aprobar_cancelacion_sesion' ELSE 'cancelar_sesion_coworking' END,
    v_descripcion_audit,
    jsonb_build_object('session_id',p_session_id,'area_id',v_session.area_id,'cliente_nombre',v_session.cliente_nombre,
      'pax_count',v_session.pax_count,'motivo',p_motivo,'entregados',p_entregados,
      'mermas_creadas',v_mermas_creadas,'stock_reintegrado',v_stock_reintegrado,
      'solicitud_id',p_solicitud_id,'aprobado_por',CASE WHEN p_solicitud_id IS NOT NULL THEN v_user_id ELSE NULL END,
      'transaccional',true));

  RETURN json_build_object('ok',true,'session_id',p_session_id,'mermas_creadas',v_mermas_creadas,
    'entregados_count',v_total_entregados,'stock_reintegrado',v_stock_reintegrado);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancelar_sesion_coworking(uuid, text, jsonb, uuid, boolean) TO authenticated;