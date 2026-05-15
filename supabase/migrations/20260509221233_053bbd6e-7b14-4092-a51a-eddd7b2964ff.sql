
-- 1. BACKFILL
CREATE TEMP TABLE _csu_to_detalle (
  upsell_id  uuid PRIMARY KEY,
  detalle_id uuid NOT NULL
) ON COMMIT DROP;

WITH inserted AS (
  INSERT INTO public.detalle_ventas (
    venta_id, coworking_session_id, producto_id, cantidad,
    precio_unitario, subtotal, tipo_concepto, descripcion, created_at
  )
  SELECT
    NULL, csu.session_id, csu.producto_id, csu.cantidad,
    csu.precio_especial, csu.precio_especial * csu.cantidad,
    CASE WHEN csu.precio_especial = 0 THEN 'amenity'::tipo_concepto ELSE 'producto'::tipo_concepto END,
    'Migrado desde coworking_session_upsells', csu.created_at
  FROM public.coworking_session_upsells csu
  JOIN public.coworking_sessions cs ON cs.id = csu.session_id
  WHERE cs.estado IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado)
  RETURNING id AS detalle_id, coworking_session_id, producto_id, cantidad, created_at
)
INSERT INTO _csu_to_detalle (upsell_id, detalle_id)
SELECT csu.id, ins.detalle_id
FROM public.coworking_session_upsells csu
JOIN public.coworking_sessions cs ON cs.id = csu.session_id
JOIN inserted ins
  ON ins.coworking_session_id = csu.session_id
 AND ins.producto_id = csu.producto_id
 AND ins.cantidad = csu.cantidad
 AND ins.created_at = csu.created_at
WHERE cs.estado IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado);

-- 2. Renombrar columna upsell_id → detalle_id
ALTER TABLE public.cancelaciones_items_sesion RENAME COLUMN upsell_id TO detalle_id;

UPDATE public.cancelaciones_items_sesion c
   SET detalle_id = m.detalle_id
  FROM _csu_to_detalle m
 WHERE c.detalle_id = m.upsell_id;

-- 3. Drop funciones de stock con CASCADE (elimina sus triggers)
DROP FUNCTION IF EXISTS public.descontar_stock_on_upsell_insert() CASCADE;
DROP FUNCTION IF EXISTS public.ajustar_stock_on_upsell_update() CASCADE;
DROP FUNCTION IF EXISTS public.reintegrar_stock_on_upsell_delete() CASCADE;

-- 4. DROP tabla y columnas obsoletas
DROP TABLE IF EXISTS public.coworking_session_upsells CASCADE;
ALTER TABLE public.coworking_sessions
  DROP COLUMN IF EXISTS upsell_producto_id,
  DROP COLUMN IF EXISTS upsell_precio;

-- 5. validar_stock_disponible
CREATE OR REPLACE FUNCTION public.validar_stock_disponible(p_producto_id uuid, p_cantidad integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_receta RECORD; v_uso_comprometido NUMERIC; v_stock_disponible NUMERIC;
BEGIN
  FOR v_receta IN
    SELECT r.insumo_id, r.cantidad_necesaria, i.stock_actual, i.nombre
    FROM public.recetas r JOIN public.insumos i ON i.id = r.insumo_id
    WHERE r.producto_id = p_producto_id
  LOOP
    SELECT COALESCE(SUM(r_sub.cantidad_necesaria * dv.cantidad), 0) INTO v_uso_comprometido
    FROM public.detalle_ventas dv
    JOIN public.coworking_sessions cs ON cs.id = dv.coworking_session_id
    JOIN public.recetas r_sub ON r_sub.producto_id = dv.producto_id
    WHERE dv.venta_id IS NULL
      AND cs.estado IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado)
      AND r_sub.insumo_id = v_receta.insumo_id;

    v_stock_disponible := v_receta.stock_actual - v_uso_comprometido;
    IF v_stock_disponible < (v_receta.cantidad_necesaria * p_cantidad) THEN
      RETURN json_build_object('valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre || '. Disponible real: ' || v_stock_disponible);
    END IF;
  END LOOP;
  RETURN json_build_object('valido', true);
END;
$function$;

-- 6. validar_stock_carrito
CREATE OR REPLACE FUNCTION public.validar_stock_carrito(p_items jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb; v_uso_acumulado jsonb := '{}'::jsonb; v_receta RECORD;
  v_uso_comprometido NUMERIC; v_stock_disponible NUMERIC; v_uso_carrito NUMERIC;
  v_cant integer; v_prod uuid;
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
    SELECT COALESCE(SUM(r_sub.cantidad_necesaria * dv.cantidad), 0) INTO v_uso_comprometido
    FROM public.detalle_ventas dv
    JOIN public.coworking_sessions cs ON cs.id = dv.coworking_session_id
    JOIN public.recetas r_sub ON r_sub.producto_id = dv.producto_id
    WHERE dv.venta_id IS NULL AND cs.estado = 'activo'::coworking_estado
      AND r_sub.insumo_id = v_receta.insumo_id;

    v_stock_disponible := v_receta.stock_actual - v_uso_comprometido;
    v_uso_carrito := (v_uso_acumulado->>v_receta.insumo_id::text)::numeric;
    IF v_stock_disponible < v_uso_carrito THEN
      RETURN json_build_object('valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre
                 || '. Disponible: ' || v_stock_disponible || ', requerido: ' || v_uso_carrito);
    END IF;
  END LOOP;
  RETURN json_build_object('valido', true);
END;
$function$;

-- 7. cancelar_sesion_coworking
CREATE OR REPLACE FUNCTION public.cancelar_sesion_coworking(
  p_session_id uuid, p_motivo text, p_entregados jsonb,
  p_solicitud_id uuid DEFAULT NULL, p_is_admin boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_session RECORD; v_item jsonb; v_dv RECORD;
  v_receta RECORD; v_entregada_qty integer; v_no_entregada_qty integer;
  v_mermas_creadas integer := 0; v_total_entregados integer := 0;
  v_descripcion_audit text; v_solicitante_id uuid; v_entregados_map jsonb := '{}'::jsonb;
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
    SELECT id, producto_id, cantidad, descripcion, tipo_concepto
    FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id AND venta_id IS NULL
  LOOP
    v_entregada_qty := LEAST(COALESCE((v_entregados_map->>v_dv.producto_id::text)::integer, 0), v_dv.cantidad);
    v_no_entregada_qty := v_dv.cantidad - v_entregada_qty;

    IF v_entregada_qty > 0 AND v_dv.producto_id IS NOT NULL THEN
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

    IF v_no_entregada_qty > 0 AND v_dv.producto_id IS NOT NULL THEN
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id LOOP
        UPDATE public.insumos
          SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_no_entregada_qty)
          WHERE id = v_receta.insumo_id;
      END LOOP;
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

-- 8. solicitar_cancelacion_item_sesion (renombrado p_detalle_id)
DROP FUNCTION IF EXISTS public.solicitar_cancelacion_item_sesion(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.solicitar_cancelacion_item_sesion(
  p_detalle_id uuid, p_cantidad integer, p_motivo text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_dv RECORD; v_producto_nombre text;
  v_kds_item RECORD; v_cancel_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN RAISE EXCEPTION 'El motivo es obligatorio'; END IF;

  SELECT id, coworking_session_id, producto_id, cantidad, descripcion INTO v_dv
  FROM public.detalle_ventas
  WHERE id = p_detalle_id AND venta_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea de cuenta abierta no encontrada'; END IF;
  IF p_cantidad > v_dv.cantidad THEN
    RAISE EXCEPTION 'Cantidad a cancelar (%) excede la cantidad actual (%)', p_cantidad, v_dv.cantidad; END IF;

  SELECT nombre INTO v_producto_nombre FROM public.productos WHERE id = v_dv.producto_id;

  SELECT koi.id AS kds_item_id, ko.id AS kds_order_id, koi.cantidad, koi.cancel_qty INTO v_kds_item
  FROM public.kds_order_items koi
  JOIN public.kds_orders ko ON ko.id = koi.kds_order_id
  WHERE ko.coworking_session_id = v_dv.coworking_session_id
    AND koi.producto_id = v_dv.producto_id
    AND (koi.cantidad - koi.cancel_qty) > 0
  ORDER BY ko.created_at DESC LIMIT 1;

  IF v_kds_item.kds_item_id IS NOT NULL THEN
    UPDATE public.kds_order_items
      SET cancel_requested = true,
          cancel_qty = LEAST(v_kds_item.cantidad, v_kds_item.cancel_qty + p_cantidad)
    WHERE id = v_kds_item.kds_item_id;
  END IF;

  INSERT INTO public.cancelaciones_items_sesion (
    session_id, detalle_id, producto_id, nombre_producto, cantidad,
    kds_order_id, kds_item_id, solicitante_id, motivo
  ) VALUES (
    v_dv.coworking_session_id, v_dv.id, v_dv.producto_id,
    COALESCE(v_producto_nombre, COALESCE(v_dv.descripcion, 'Producto')), p_cantidad,
    v_kds_item.kds_order_id, v_kds_item.kds_item_id, v_user, trim(p_motivo)
  ) RETURNING id INTO v_cancel_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'solicitar_cancelacion_item_sesion',
    format('Solicitud de cancelación: %s ×%s — motivo: %s',
           COALESCE(v_producto_nombre, 'producto'), p_cantidad, trim(p_motivo)),
    jsonb_build_object('cancelacion_id', v_cancel_id, 'session_id', v_dv.coworking_session_id,
      'detalle_id', v_dv.id, 'producto_id', v_dv.producto_id, 'cantidad', p_cantidad,
      'kds_order_id', v_kds_item.kds_order_id, 'transaccional', true));

  RETURN json_build_object('ok', true, 'cancelacion_id', v_cancel_id);
END;
$function$;

-- 9. resolver_cancelacion_item_sesion
CREATE OR REPLACE FUNCTION public.resolver_cancelacion_item_sesion(
  p_cancelacion_id uuid, p_decision text, p_notas text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_cancel RECORD; v_dv RECORD;
  v_nueva_cantidad integer; v_receta RECORD;
  v_total_kds integer; v_cancelados_kds integer; v_mermas integer := 0;
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
    IF v_dv.producto_id IS NOT NULL THEN
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id LOOP
        IF p_decision = 'retornado_stock' THEN
          UPDATE public.insumos
            SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * v_cancel.cantidad)
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

-- 10. ajustar_amenity_sesion
CREATE OR REPLACE FUNCTION public.ajustar_amenity_sesion(
  p_session_id uuid, p_producto_id uuid, p_nueva_cantidad integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_session RECORD; v_existente RECORD;
  v_delta integer; v_receta RECORD; v_nuevo_stock numeric;
  v_nombre_producto text; v_kds_folio integer := NULL;
  v_kds_order_id uuid := NULL; v_requiere_prep boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (public.has_role(v_user, 'administrador'::app_role)
       OR public.has_role(v_user, 'supervisor'::app_role)
       OR public.has_role(v_user, 'caja'::app_role)
       OR public.has_role(v_user, 'recepcion'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE = '42501'; END IF;
  IF p_nueva_cantidad < 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;
  IF v_session.estado NOT IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado) THEN
    RAISE EXCEPTION 'La sesión no acepta cambios (estado: %)', v_session.estado; END IF;

  SELECT nombre, requiere_preparacion INTO v_nombre_producto, v_requiere_prep
    FROM public.productos WHERE id = p_producto_id;
  IF v_nombre_producto IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  SELECT id, cantidad INTO v_existente FROM public.detalle_ventas
    WHERE coworking_session_id = p_session_id AND producto_id = p_producto_id
      AND venta_id IS NULL AND tipo_concepto = 'amenity'::tipo_concepto FOR UPDATE;

  v_delta := p_nueva_cantidad - COALESCE(v_existente.cantidad, 0);
  IF v_delta = 0 THEN RETURN json_build_object('ok', true, 'sin_cambio', true); END IF;

  IF v_delta > 0 THEN
    FOR v_receta IN
      SELECT r.insumo_id, r.cantidad_necesaria, i.nombre AS insumo_nombre
      FROM public.recetas r JOIN public.insumos i ON i.id = r.insumo_id
      WHERE r.producto_id = p_producto_id
    LOOP
      UPDATE public.insumos SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * v_delta)
        WHERE id = v_receta.insumo_id RETURNING stock_actual INTO v_nuevo_stock;
      IF v_nuevo_stock < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para insumo "%"', v_receta.insumo_nombre; END IF;
    END LOOP;
  ELSE
    FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = p_producto_id LOOP
      UPDATE public.insumos SET stock_actual = stock_actual + (v_receta.cantidad_necesaria * abs(v_delta))
        WHERE id = v_receta.insumo_id;
    END LOOP;
  END IF;

  IF v_existente.id IS NULL THEN
    INSERT INTO public.detalle_ventas (
      venta_id, coworking_session_id, producto_id, cantidad,
      precio_unitario, subtotal, tipo_concepto, descripcion
    ) VALUES (
      NULL, p_session_id, p_producto_id, p_nueva_cantidad,
      0, 0, 'amenity'::tipo_concepto,
      format('Amenity (%s)', v_session.cliente_nombre));
  ELSIF p_nueva_cantidad = 0 THEN
    DELETE FROM public.detalle_ventas WHERE id = v_existente.id;
  ELSE
    UPDATE public.detalle_ventas SET cantidad = p_nueva_cantidad WHERE id = v_existente.id;
  END IF;

  IF v_delta > 0 AND v_requiere_prep IS DISTINCT FROM false THEN
    v_kds_folio := nextval('public.kds_coworking_folio_seq')::integer;
    INSERT INTO public.kds_orders (venta_id, coworking_session_id, folio, tipo_consumo, estado)
    VALUES (NULL, p_session_id, v_kds_folio, 'sitio', 'pendiente'::kds_estado)
    RETURNING id INTO v_kds_order_id;
    INSERT INTO public.kds_order_items (kds_order_id, producto_id, nombre_producto, cantidad, notas)
    VALUES (v_kds_order_id, p_producto_id,
      format('%s ☕ (coworking — %s)', v_nombre_producto, v_session.cliente_nombre),
      v_delta, NULL);
  END IF;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'ajustar_amenity_sesion',
    format('Amenity %s: %s → %s (sesión %s)',
           v_nombre_producto, COALESCE(v_existente.cantidad, 0), p_nueva_cantidad, v_session.cliente_nombre),
    jsonb_build_object('session_id', p_session_id, 'producto_id', p_producto_id,
      'cantidad_anterior', COALESCE(v_existente.cantidad, 0), 'cantidad_nueva', p_nueva_cantidad,
      'delta', v_delta, 'kds_folio', v_kds_folio, 'transaccional', true));

  RETURN json_build_object('ok', true,
    'cantidad_anterior', COALESCE(v_existente.cantidad, 0),
    'cantidad_nueva', p_nueva_cantidad, 'delta', v_delta, 'kds_folio', v_kds_folio);
END;
$function$;
