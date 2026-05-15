CREATE OR REPLACE FUNCTION public.recalcular_amenities_pax(
  p_session_id uuid,
  p_new_pax integer
)
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
  v_increments jsonb := '[]'::jsonb;
  v_total_mermas integer := 0;
  v_lineas_aumentadas integer := 0;
  v_lineas_reducidas integer := 0;
  v_lineas_eliminadas integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_role(v_user, 'administrador'::app_role)
    OR has_role(v_user, 'supervisor'::app_role)
    OR has_role(v_user, 'recepcion'::app_role)
    OR has_role(v_user, 'caja'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes para recalcular amenities' USING ERRCODE = '42501';
  END IF;

  IF p_new_pax IS NULL OR p_new_pax < 0 THEN
    RAISE EXCEPTION 'pax inválido: %', p_new_pax;
  END IF;

  SELECT * INTO v_session
    FROM public.coworking_sessions
   WHERE id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.estado <> 'activo'::coworking_estado THEN
    RAISE EXCEPTION 'Solo se pueden recalcular amenities en sesiones activas (estado: %)', v_session.estado;
  END IF;

  v_amenities := COALESCE(v_session.tarifa_snapshot->'amenities', '[]'::jsonb);
  IF jsonb_typeof(v_amenities) <> 'array' OR jsonb_array_length(v_amenities) = 0 THEN
    RETURN json_build_object('ok', true, 'increments', '[]'::jsonb,
      'mermas_creadas', 0, 'lineas_aumentadas', 0, 'lineas_reducidas', 0, 'lineas_eliminadas', 0);
  END IF;

  FOR v_amenity IN SELECT * FROM jsonb_array_elements(v_amenities)
  LOOP
    v_producto_id := NULLIF(v_amenity->>'producto_id','')::uuid;
    v_cant_incluida := COALESCE((v_amenity->>'cantidad_incluida')::integer, 0);
    v_nombre := COALESCE(v_amenity->>'nombre', 'Amenity');

    IF v_producto_id IS NULL THEN CONTINUE; END IF;

    v_new_qty := v_cant_incluida * p_new_pax;

    -- Buscar línea existente de amenity (precio 0)
    SELECT id, cantidad INTO v_existing_id, v_old_qty
      FROM public.detalle_ventas
     WHERE coworking_session_id = p_session_id
       AND venta_id IS NULL
       AND producto_id = v_producto_id
       AND tipo_concepto = 'amenity'::tipo_concepto
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE;

    v_old_qty := COALESCE(v_old_qty, 0);
    v_delta := v_new_qty - v_old_qty;

    IF v_delta = 0 AND v_existing_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    IF v_delta > 0 THEN
      -- Aumentar (o crear) línea
      IF v_existing_id IS NOT NULL THEN
        UPDATE public.detalle_ventas
          SET cantidad = v_new_qty, subtotal = 0
        WHERE id = v_existing_id;
      ELSE
        INSERT INTO public.detalle_ventas (
          venta_id, producto_id, cantidad, precio_unitario, subtotal,
          tipo_concepto, coworking_session_id
        ) VALUES (
          NULL, v_producto_id, v_new_qty, 0, 0,
          'amenity'::tipo_concepto, p_session_id
        );
      END IF;
      v_lineas_aumentadas := v_lineas_aumentadas + 1;
      v_increments := v_increments || jsonb_build_array(jsonb_build_object(
        'producto_id', v_producto_id,
        'nombre', v_nombre,
        'cantidad', v_delta
      ));

    ELSIF v_delta < 0 AND v_existing_id IS NOT NULL THEN
      -- Reducción: registrar merma por insumos de la diferencia (cocina ya preparó)
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
          FROM public.recetas r
         WHERE r.producto_id = v_producto_id
      LOOP
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (
          v_receta.insumo_id,
          v_receta.cantidad_necesaria * abs(v_delta),
          format('Recalc amenities por baja de pax — %s ×%s (sesión %s, %s pax → %s pax)',
                 v_nombre, abs(v_delta), v_session.cliente_nombre, v_session.pax_count, p_new_pax),
          v_user
        );
        v_total_mermas := v_total_mermas + 1;
      END LOOP;

      IF v_new_qty <= 0 THEN
        DELETE FROM public.detalle_ventas WHERE id = v_existing_id;
        v_lineas_eliminadas := v_lineas_eliminadas + 1;
      ELSE
        UPDATE public.detalle_ventas
          SET cantidad = v_new_qty, subtotal = 0
        WHERE id = v_existing_id;
        v_lineas_reducidas := v_lineas_reducidas + 1;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'recalcular_amenities_pax',
    format('Recalc amenities — %s: %s pax → %s pax · %s aum / %s red / %s elim · %s merma(s)',
           v_session.cliente_nombre, v_session.pax_count, p_new_pax,
           v_lineas_aumentadas, v_lineas_reducidas, v_lineas_eliminadas, v_total_mermas),
    jsonb_build_object(
      'session_id', p_session_id,
      'cliente_nombre', v_session.cliente_nombre,
      'pax_anterior', v_session.pax_count,
      'pax_nuevo', p_new_pax,
      'lineas_aumentadas', v_lineas_aumentadas,
      'lineas_reducidas', v_lineas_reducidas,
      'lineas_eliminadas', v_lineas_eliminadas,
      'mermas_creadas', v_total_mermas,
      'increments', v_increments,
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'increments', v_increments,
    'mermas_creadas', v_total_mermas,
    'lineas_aumentadas', v_lineas_aumentadas,
    'lineas_reducidas', v_lineas_reducidas,
    'lineas_eliminadas', v_lineas_eliminadas
  );
END;
$function$;