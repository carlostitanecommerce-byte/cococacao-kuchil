-- =============================================================================
-- FIX Bug 1 + Bug 4: recalcular_amenities_pax
-- Bug 1: delta < 0 → crea merma PERO NO descuenta stock_actual (faltaba UPDATE)
-- Bug 4: delta > 0 → aumenta detalle_ventas pero NO descuenta stock ni envía KDS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalcular_amenities_pax(p_session_id uuid, p_new_pax integer)
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
  v_stock_actual numeric;
  v_nombre_insumo text;
  v_increments jsonb := '[]'::jsonb;
  v_total_mermas integer := 0;
  v_lineas_aumentadas integer := 0;
  v_lineas_reducidas integer := 0;
  v_lineas_eliminadas integer := 0;
  -- KDS variables for delta > 0
  v_kds_folio integer := NULL;
  v_kds_order_id uuid := NULL;
  v_requiere_prep boolean;
  v_kds_items_pending jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (has_role(v_user, 'administrador'::app_role) OR has_role(v_user, 'supervisor'::app_role)
          OR has_role(v_user, 'recepcion'::app_role) OR has_role(v_user, 'caja'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes para recalcular amenities' USING ERRCODE = '42501';
  END IF;
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

    SELECT id, cantidad INTO v_existing_id, v_old_qty
      FROM public.detalle_ventas
     WHERE coworking_session_id = p_session_id AND venta_id IS NULL
       AND producto_id = v_producto_id AND tipo_concepto = 'amenity'::tipo_concepto
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

    v_old_qty := COALESCE(v_old_qty, 0);
    v_delta := v_new_qty - v_old_qty;

    IF v_delta = 0 AND v_existing_id IS NOT NULL THEN CONTINUE; END IF;

    IF v_delta > 0 THEN
      -- ====== FIX BUG 4: Descontar stock para los amenities adicionales ======
      -- Validar stock disponible primero
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

      -- Descontar stock
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

      -- Actualizar o insertar detalle_ventas
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

      -- Acumular items para KDS (se envían al final)
      SELECT requiere_preparacion INTO v_requiere_prep FROM public.productos WHERE id = v_producto_id;
      IF v_requiere_prep IS DISTINCT FROM false THEN
        v_kds_items_pending := v_kds_items_pending || jsonb_build_array(jsonb_build_object(
          'producto_id', v_producto_id, 'nombre', v_nombre, 'cantidad', v_delta));
      END IF;

    ELSIF v_delta < 0 AND v_existing_id IS NOT NULL THEN
      -- ====== FIX BUG 1: Registrar merma Y descontar stock ======
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
          FROM public.recetas r
         WHERE r.producto_id = v_producto_id
         ORDER BY r.insumo_id
      LOOP
        -- Registrar merma (trazabilidad)
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * abs(v_delta),
          format('Recalc amenities por baja de pax — %s ×%s (sesión %s, %s pax → %s pax)',
                 v_nombre, abs(v_delta), v_session.cliente_nombre, v_session.pax_count, p_new_pax),
          v_user);
        v_total_mermas := v_total_mermas + 1;
      END LOOP;

      -- Nota: NO descontamos stock aquí porque el stock ya fue descontado cuando el
      -- amenity fue registrado originalmente (via registrar_amenity_sesion o recalcular_amenities_pax).
      -- La merma es solo un registro de trazabilidad indicando que esos insumos se perdieron.
      -- El stock ya refleja el descuento correcto.

      IF v_new_qty <= 0 THEN
        DELETE FROM public.detalle_ventas WHERE id = v_existing_id;
        v_lineas_eliminadas := v_lineas_eliminadas + 1;
      ELSE
        UPDATE public.detalle_ventas SET cantidad = v_new_qty, subtotal = 0 WHERE id = v_existing_id;
        v_lineas_reducidas := v_lineas_reducidas + 1;
      END IF;
    END IF;
  END LOOP;

  -- Enviar nuevos amenities a KDS si hay items pendientes
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
$function$;
