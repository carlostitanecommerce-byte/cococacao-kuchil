CREATE OR REPLACE FUNCTION public.registrar_amenity_sesion(
  p_session_id uuid,
  p_producto_id uuid,
  p_cantidad integer DEFAULT 1
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
  v_amenity_match jsonb := NULL;
  v_cantidad_incluida integer := 0;
  v_max_permitido integer := 0;
  v_actual_qty integer := 0;
  v_existing RECORD;
  v_receta RECORD;
  v_stock_actual numeric;
  v_nombre_insumo text;
  v_nombre_producto text;
  v_detalle_id uuid;
  v_new_qty integer;
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
    RAISE EXCEPTION 'Permisos insuficientes para registrar amenity' USING ERRCODE = '42501';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.estado NOT IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado) THEN
    RAISE EXCEPTION 'La sesión no acepta cargos (estado: %)', v_session.estado;
  END IF;

  -- Validar amenity está en el snapshot
  IF v_session.tarifa_snapshot IS NULL OR v_session.tarifa_snapshot->'amenities' IS NULL THEN
    RAISE EXCEPTION 'La sesión no tiene amenities configurados';
  END IF;

  FOR v_amenity IN SELECT * FROM jsonb_array_elements(v_session.tarifa_snapshot->'amenities')
  LOOP
    IF (v_amenity->>'producto_id')::uuid = p_producto_id THEN
      v_amenity_match := v_amenity;
      v_cantidad_incluida := COALESCE((v_amenity->>'cantidad_incluida')::integer, 0);
      EXIT;
    END IF;
  END LOOP;

  IF v_amenity_match IS NULL THEN
    RAISE EXCEPTION 'Este producto no es un amenity de la sesión';
  END IF;

  v_max_permitido := v_cantidad_incluida * v_session.pax_count;

  -- Actual qty (suma de líneas tipo amenity para este producto, sin venta_id)
  SELECT COALESCE(SUM(cantidad), 0) INTO v_actual_qty
    FROM public.detalle_ventas
   WHERE coworking_session_id = p_session_id
     AND venta_id IS NULL
     AND producto_id = p_producto_id
     AND tipo_concepto = 'amenity'::tipo_concepto;

  IF v_actual_qty + p_cantidad > v_max_permitido THEN
    RAISE EXCEPTION 'Excede el máximo de amenities incluidos (% de %)', v_actual_qty + p_cantidad, v_max_permitido;
  END IF;

  -- Validar stock para los insumos del amenity
  FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = p_producto_id
  LOOP
    SELECT stock_actual, nombre INTO v_stock_actual, v_nombre_insumo
      FROM public.insumos WHERE id = v_receta.insumo_id FOR UPDATE;
    IF v_stock_actual < v_receta.cantidad_necesaria * p_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": disponible %, requerido %',
        v_nombre_insumo, v_stock_actual, v_receta.cantidad_necesaria * p_cantidad;
    END IF;
  END LOOP;

  -- Descontar insumos
  FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = p_producto_id
  LOOP
    UPDATE public.insumos
       SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * p_cantidad),
           updated_at = now()
     WHERE id = v_receta.insumo_id;
  END LOOP;

  SELECT nombre INTO v_nombre_producto FROM public.productos WHERE id = p_producto_id;

  -- Buscar línea existente
  SELECT id, cantidad INTO v_existing
    FROM public.detalle_ventas
   WHERE coworking_session_id = p_session_id
     AND venta_id IS NULL
     AND producto_id = p_producto_id
     AND tipo_concepto = 'amenity'::tipo_concepto
   LIMIT 1;

  IF FOUND THEN
    v_new_qty := v_existing.cantidad + p_cantidad;
    UPDATE public.detalle_ventas
       SET cantidad = v_new_qty,
           subtotal = 0,
           precio_unitario = 0
     WHERE id = v_existing.id;
    v_detalle_id := v_existing.id;
  ELSE
    INSERT INTO public.detalle_ventas (
      coworking_session_id, venta_id, producto_id, cantidad,
      precio_unitario, subtotal, tipo_concepto
    ) VALUES (
      p_session_id, NULL, p_producto_id, p_cantidad,
      0, 0, 'amenity'::tipo_concepto
    ) RETURNING id INTO v_detalle_id;
    v_new_qty := p_cantidad;
  END IF;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'amenity_reclamado',
    format('Amenity %s x%s reclamado en sesión %s', COALESCE(v_nombre_producto,'(s/n)'), p_cantidad, v_session.cliente_nombre),
    jsonb_build_object(
      'session_id', p_session_id,
      'producto_id', p_producto_id,
      'cantidad', p_cantidad,
      'detalle_id', v_detalle_id,
      'nueva_cantidad_total', v_new_qty,
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'detalle_id', v_detalle_id,
    'cantidad_total', v_new_qty,
    'cantidad_agregada', p_cantidad,
    'nombre', v_nombre_producto
  );
END;
$function$;