
-- ============================================================
-- D2: Cancelación atómica de sesiones de coworking
-- Función única que ejecuta todo en una transacción:
--   1) Aplica entregas como mermas y descuenta insumos
--   2) Borra upsells de la sesión
--   3) Marca la sesión como cancelada
--   4) (Si aplica) Cierra la solicitud
--   5) Inserta el audit log correspondiente
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancelar_sesion_coworking(
  p_session_id uuid,
  p_motivo text,
  p_entregados jsonb,         -- [{producto_id, nombre, cantidad}]
  p_solicitud_id uuid DEFAULT NULL,  -- presente si admin aprueba solicitud
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
  v_cant_final numeric;
  v_stock_actual numeric;
  v_mermas_creadas integer := 0;
  v_total_entregados integer := 0;
  v_descripcion_audit text;
  v_solicitante_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  -- Validar permisos: admin directo, o dueño de la sesión, o admin aprobando solicitud
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
    -- Operador: solo puede cancelar sus propias sesiones (vía solicitud, ya gestionada por la UI)
    -- Admins también pasan por aquí cuando cancelan directo (sin p_is_admin=true cuando no aprueban solicitud).
    IF v_session.usuario_id <> v_user_id AND NOT public.has_role(v_user_id, 'administrador') THEN
      RAISE EXCEPTION 'No tienes permiso para cancelar esta sesión' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1) Aplicar entregas como mermas + descuento de stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_entregados, '[]'::jsonb))
  LOOP
    v_total_entregados := v_total_entregados + 1;
    FOR v_receta IN
      SELECT r.insumo_id, r.cantidad_necesaria, i.stock_actual, i.nombre AS insumo_nombre
      FROM public.recetas r
      JOIN public.insumos i ON i.id = r.insumo_id
      WHERE r.producto_id = (v_item->>'producto_id')::uuid
    LOOP
      v_cant_descontar := v_receta.cantidad_necesaria * (v_item->>'cantidad')::numeric;
      v_stock_actual := COALESCE(v_receta.stock_actual, 0);
      v_cant_final := LEAST(v_cant_descontar, GREATEST(0, v_stock_actual));

      IF v_cant_final <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
      VALUES (
        v_receta.insumo_id,
        v_cant_final,
        format('Entrega en sesión cancelada — %s (%s ×%s)',
               v_session.cliente_nombre,
               COALESCE(v_item->>'nombre', 'producto'),
               v_item->>'cantidad'),
        v_user_id
      );

      UPDATE public.insumos
      SET stock_actual = stock_actual - v_cant_final
      WHERE id = v_receta.insumo_id;

      v_mermas_creadas := v_mermas_creadas + 1;
    END LOOP;
  END LOOP;

  -- 2) Limpiar upsells de la sesión
  DELETE FROM public.coworking_session_upsells WHERE session_id = p_session_id;

  -- 3) Cancelar la sesión
  UPDATE public.coworking_sessions
  SET estado = 'cancelado',
      monto_acumulado = 0,
      fecha_salida_real = now()
  WHERE id = p_session_id;

  -- 4) Cerrar solicitud si vino de aprobación
  IF p_solicitud_id IS NOT NULL THEN
    UPDATE public.solicitudes_cancelacion_sesiones
    SET estado = 'aprobada',
        revisado_por = v_user_id
    WHERE id = p_solicitud_id
    RETURNING solicitante_id INTO v_solicitante_id;
  END IF;

  -- 5) Audit log
  v_descripcion_audit := CASE
    WHEN p_solicitud_id IS NOT NULL THEN
      format('Cancelación aprobada — Cliente: %s · Entregados: %s item(s) · %s merma(s)',
             v_session.cliente_nombre, v_total_entregados, v_mermas_creadas)
    ELSE
      format('Cancelación directa — Cliente: %s · Entregados: %s item(s) · %s merma(s)',
             v_session.cliente_nombre, v_total_entregados, v_mermas_creadas)
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
      'solicitud_id', p_solicitud_id,
      'aprobado_por', CASE WHEN p_solicitud_id IS NOT NULL THEN v_user_id ELSE NULL END,
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'session_id', p_session_id,
    'mermas_creadas', v_mermas_creadas,
    'entregados_count', v_total_entregados
  );
END;
$$;

-- Permitir invocación desde el cliente autenticado
GRANT EXECUTE ON FUNCTION public.cancelar_sesion_coworking(uuid, text, jsonb, uuid, boolean) TO authenticated;
