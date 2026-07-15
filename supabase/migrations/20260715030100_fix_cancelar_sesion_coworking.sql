-- =============================================================================
-- FIX Bug 2: cancelar_sesion_coworking — doble descuento de stock en entregados
--
-- PROBLEMA: Cuando se cancela una sesión con productos "entregados", la función
-- descuenta stock de nuevo (línea: stock_actual = stock_actual - v_cant_final).
-- Pero el stock ya fue descontado cuando se registraron esos productos via
-- registrar_consumo_coworking o registrar_amenity_sesion.
--
-- ADEMÁS: Los paquetes cargados a cuenta tienen producto_id = NULL y paquete_id set.
-- El código anterior filtraba por producto_id IS NOT NULL, lo que ignoraba paquetes
-- y causaba fugas de inventario permanentes.
--
-- FIX:
-- 1. Los entregados (tanto simples como paquetes) solo registran merma (ya se descontó su stock).
--    Para paquetes, registramos mermas de sus componentes de forma proporcional.
-- 2. Los no entregados reintegran su stock. Si se entregó de forma parcial, reintegramos
--    el stock de la cantidad restante.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancelar_sesion_coworking(
  p_session_id uuid,
  p_motivo text,
  p_entregados jsonb,         -- [{id, producto_id, paquete_id, nombre, cantidad}]
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

  -- 1) Para ENTREGADOS: solo registrar merma (NO descontar stock — ya fue descontado)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb))
  LOOP
    v_total_entregados := v_total_entregados + 1;
    
    -- Si es un paquete, registrar mermas para todos sus componentes
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

          -- Registrar merma sin descontar stock
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
      -- Si es un producto simple, registrar merma
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
        FROM public.recetas r
        WHERE r.producto_id = (v_item->>'producto_id')::uuid
      LOOP
        v_cant_descontar := v_receta.cantidad_necesaria * (v_item->>'cantidad')::numeric;
        IF v_cant_descontar <= 0 THEN CONTINUE; END IF;

        -- Registrar merma sin descontar stock
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

  -- 2) Para NO entregados: reintegrar stock (estos se borraron/cancelaron sin entregar)
  -- Revisar cada detalle de venta abierto de la sesión (incluye paquetes con producto_id = NULL)
  FOR v_dv IN
    SELECT id, producto_id, cantidad, paquete_id, tipo_concepto
    FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id
      AND venta_id IS NULL
    ORDER BY id
  LOOP
    -- Buscar cantidad entregada para esta línea
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
        -- Paquete: reintegrar stock de componentes
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
        -- Producto simple: reintegrar stock
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

  -- 3) Limpiar upsells de la sesión
  DELETE FROM public.coworking_session_upsells WHERE session_id = p_session_id;

  -- 4) Limpiar detalle_ventas abiertos de la sesión
  DELETE FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id AND venta_id IS NULL;

  -- 5) Cancelar la sesión
  UPDATE public.coworking_sessions
  SET estado = 'cancelado',
      monto_acumulado = 0,
      fecha_salida_real = now()
  WHERE id = p_session_id;

  -- 6) Cerrar solicitud si vino de aprobación
  IF p_solicitud_id IS NOT NULL THEN
    UPDATE public.solicitudes_cancelacion_sesiones
    SET estado = 'aprobada',
        revisado_por = v_user_id
    WHERE id = p_solicitud_id
    RETURNING solicitante_id INTO v_solicitante_id;
  END IF;

  -- 7) Audit log
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
