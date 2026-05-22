
-- =============================================================================
-- Blindaje anti-deadlock: bloquear insumos siempre por ORDER BY r.insumo_id
-- y pre-bloqueo ordenado en crear_venta_completa.
-- Sólo se añade ORDER BY a los loops de recetas; lógica idéntica.
-- =============================================================================

-- 1) Trigger principal de POS
CREATE OR REPLACE FUNCTION public.descontar_inventario_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cantidad_requerida numeric;
  v_stock_actual numeric;
  v_nombre_insumo text;
  v_nombre_producto text;
BEGIN
  IF NEW.venta_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.tipo_concepto = 'coworking'::tipo_concepto THEN RETURN NEW; END IF;
  IF NEW.tipo_concepto = 'producto'::tipo_concepto AND NEW.producto_id IS NULL THEN
    RAISE EXCEPTION 'Detalle de venta sin producto_id (tipo_concepto=producto). Posible paquete sin opciones expandidas.';
  END IF;
  IF NEW.producto_id IS NULL THEN RETURN NEW; END IF;

  SELECT nombre INTO v_nombre_producto FROM public.productos WHERE id = NEW.producto_id;

  FOR r IN
    SELECT recetas.insumo_id, recetas.cantidad_necesaria
    FROM recetas
    WHERE recetas.producto_id = NEW.producto_id
    ORDER BY recetas.insumo_id
  LOOP
    cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;
    SELECT stock_actual, nombre INTO v_stock_actual, v_nombre_insumo
      FROM insumos WHERE id = r.insumo_id FOR UPDATE;
    IF v_stock_actual < cantidad_requerida THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": falta insumo "%" (disponible: %, requerido: %)',
        COALESCE(v_nombre_producto, NEW.descripcion, 'producto'),
        v_nombre_insumo, v_stock_actual, cantidad_requerida;
    END IF;
    BEGIN
      UPDATE insumos SET stock_actual = stock_actual - cantidad_requerida WHERE id = r.insumo_id;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": el inventario de "%" quedaría negativo',
        COALESCE(v_nombre_producto, NEW.descripcion, 'producto'), v_nombre_insumo;
    END;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- 2) registrar_consumo_coworking
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
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (has_role(v_user, 'administrador'::app_role) OR has_role(v_user, 'caja'::app_role)
          OR has_role(v_user, 'recepcion'::app_role) OR has_role(v_user, 'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes para cargar consumo a coworking' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No hay ítems para cargar';
  END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de coworking no encontrada'; END IF;
  IF v_session.estado NOT IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado) THEN
    RAISE EXCEPTION 'La sesión no acepta cargos (estado: %)', v_session.estado;
  END IF;

  v_sufijo := format('(coworking — %s)', v_session.cliente_nombre);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_tipo_concepto := COALESCE(v_item->>'tipo_concepto', 'producto');
    v_cantidad := COALESCE((v_item->>'cantidad')::integer, 0);
    v_producto_id := NULLIF(v_item->>'producto_id','')::uuid;
    v_paquete_id := NULLIF(v_item->>'paquete_id','')::uuid;
    IF v_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida en ítem'; END IF;

    IF v_tipo_concepto = 'paquete' THEN
      IF v_paquete_id IS NULL THEN RAISE EXCEPTION 'Paquete sin id'; END IF;
      v_componentes := v_item->'componentes';
      IF v_componentes IS NULL OR jsonb_typeof(v_componentes) <> 'array' OR jsonb_array_length(v_componentes) = 0 THEN
        FOR v_componente IN
          SELECT jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad) AS j
          FROM public.paquete_componentes WHERE paquete_id = v_paquete_id
        LOOP
          v_comp_pid := (v_componente->>'producto_id')::uuid;
          v_comp_qty := (v_componente->>'cantidad')::numeric;
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp_pid ORDER BY r.insumo_id LOOP
            v_uso := jsonb_set(v_uso, ARRAY[v_receta.insumo_id::text],
              to_jsonb(COALESCE((v_uso->>v_receta.insumo_id::text)::numeric, 0)
                       + (v_receta.cantidad_necesaria * v_comp_qty * v_cantidad)));
          END LOOP;
        END LOOP;
      ELSE
        FOR v_componente IN SELECT * FROM jsonb_array_elements(v_componentes) LOOP
          v_comp_pid := (v_componente->>'producto_id')::uuid;
          v_comp_qty := (v_componente->>'cantidad')::numeric;
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp_pid ORDER BY r.insumo_id LOOP
            v_uso := jsonb_set(v_uso, ARRAY[v_receta.insumo_id::text],
              to_jsonb(COALESCE((v_uso->>v_receta.insumo_id::text)::numeric, 0)
                       + (v_receta.cantidad_necesaria * v_comp_qty * v_cantidad)));
          END LOOP;
        END LOOP;
      END IF;
    ELSE
      IF v_producto_id IS NULL THEN RAISE EXCEPTION 'Producto sin id'; END IF;
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_producto_id ORDER BY r.insumo_id LOOP
        v_uso := jsonb_set(v_uso, ARRAY[v_receta.insumo_id::text],
          to_jsonb(COALESCE((v_uso->>v_receta.insumo_id::text)::numeric, 0)
                   + (v_receta.cantidad_necesaria * v_cantidad)));
      END LOOP;
    END IF;
  END LOOP;

  -- Bloquear todos los insumos en orden ascendente (anti-deadlock)
  FOR v_insumo_id IN SELECT (k)::uuid FROM jsonb_object_keys(v_uso) AS k ORDER BY (k)::uuid
  LOOP
    SELECT stock_actual, nombre INTO v_stock_actual, v_nombre_insumo
      FROM public.insumos WHERE id = v_insumo_id FOR UPDATE;
    v_uso_total := (v_uso->>v_insumo_id::text)::numeric;
    IF v_stock_actual < v_uso_total THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": disponible %, requerido para este cargo %',
        v_nombre_insumo, v_stock_actual, v_uso_total;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
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
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = (v_componente->>'producto_id')::uuid ORDER BY r.insumo_id LOOP
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
          FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = (v_componente->>'producto_id')::uuid ORDER BY r.insumo_id LOOP
            UPDATE public.insumos
              SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * (v_componente->>'cantidad')::numeric * v_cantidad)
              WHERE id = v_receta.insumo_id;
          END LOOP;
        END LOOP;
      END IF;
    ELSE
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_producto_id ORDER BY r.insumo_id LOOP
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

-- 3) registrar_amenity_sesion
CREATE OR REPLACE FUNCTION public.registrar_amenity_sesion(p_session_id uuid, p_producto_id uuid, p_cantidad integer DEFAULT 1)
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
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (has_role(v_user, 'administrador'::app_role) OR has_role(v_user, 'supervisor'::app_role)
          OR has_role(v_user, 'recepcion'::app_role) OR has_role(v_user, 'caja'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes para registrar amenity' USING ERRCODE = '42501';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;
  IF v_session.estado NOT IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado) THEN
    RAISE EXCEPTION 'La sesión no acepta cargos (estado: %)', v_session.estado;
  END IF;

  IF v_session.tarifa_snapshot IS NULL OR v_session.tarifa_snapshot->'amenities' IS NULL THEN
    RAISE EXCEPTION 'La sesión no tiene amenities configurados';
  END IF;

  FOR v_amenity IN SELECT * FROM jsonb_array_elements(v_session.tarifa_snapshot->'amenities') LOOP
    IF (v_amenity->>'producto_id')::uuid = p_producto_id THEN
      v_amenity_match := v_amenity;
      v_cantidad_incluida := COALESCE((v_amenity->>'cantidad_incluida')::integer, 0);
      EXIT;
    END IF;
  END LOOP;

  IF v_amenity_match IS NULL THEN RAISE EXCEPTION 'Este producto no es un amenity de la sesión'; END IF;

  v_max_permitido := v_cantidad_incluida * v_session.pax_count;

  SELECT COALESCE(SUM(cantidad), 0) INTO v_actual_qty
    FROM public.detalle_ventas
   WHERE coworking_session_id = p_session_id AND venta_id IS NULL
     AND producto_id = p_producto_id AND tipo_concepto = 'amenity'::tipo_concepto;

  IF v_actual_qty + p_cantidad > v_max_permitido THEN
    RAISE EXCEPTION 'Excede el máximo de amenities incluidos (% de %)', v_actual_qty + p_cantidad, v_max_permitido;
  END IF;

  FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = p_producto_id ORDER BY r.insumo_id
  LOOP
    SELECT stock_actual, nombre INTO v_stock_actual, v_nombre_insumo
      FROM public.insumos WHERE id = v_receta.insumo_id FOR UPDATE;
    IF v_stock_actual < v_receta.cantidad_necesaria * p_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": disponible %, requerido %',
        v_nombre_insumo, v_stock_actual, v_receta.cantidad_necesaria * p_cantidad;
    END IF;
  END LOOP;

  FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = p_producto_id ORDER BY r.insumo_id
  LOOP
    UPDATE public.insumos
       SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * p_cantidad),
           updated_at = now()
     WHERE id = v_receta.insumo_id;
  END LOOP;

  SELECT nombre INTO v_nombre_producto FROM public.productos WHERE id = p_producto_id;

  SELECT id, cantidad INTO v_existing
    FROM public.detalle_ventas
   WHERE coworking_session_id = p_session_id AND venta_id IS NULL
     AND producto_id = p_producto_id AND tipo_concepto = 'amenity'::tipo_concepto
   LIMIT 1;

  IF FOUND THEN
    v_new_qty := v_existing.cantidad + p_cantidad;
    UPDATE public.detalle_ventas
       SET cantidad = v_new_qty, subtotal = 0, precio_unitario = 0
     WHERE id = v_existing.id;
    v_detalle_id := v_existing.id;
  ELSE
    INSERT INTO public.detalle_ventas (
      coworking_session_id, venta_id, producto_id, cantidad,
      precio_unitario, subtotal, tipo_concepto
    ) VALUES (
      p_session_id, NULL, p_producto_id, p_cantidad, 0, 0, 'amenity'::tipo_concepto
    ) RETURNING id INTO v_detalle_id;
    v_new_qty := p_cantidad;
  END IF;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'amenity_reclamado',
    format('Amenity %s x%s reclamado en sesión %s', COALESCE(v_nombre_producto,'(s/n)'), p_cantidad, v_session.cliente_nombre),
    jsonb_build_object('session_id', p_session_id, 'producto_id', p_producto_id,
      'cantidad', p_cantidad, 'detalle_id', v_detalle_id,
      'nueva_cantidad_total', v_new_qty, 'transaccional', true));

  RETURN json_build_object('ok', true, 'detalle_id', v_detalle_id,
    'cantidad_total', v_new_qty, 'cantidad_agregada', p_cantidad, 'nombre', v_nombre_producto);
END;
$function$;

-- 4) ajustar_amenity_sesion
CREATE OR REPLACE FUNCTION public.ajustar_amenity_sesion(p_session_id uuid, p_producto_id uuid, p_nueva_cantidad integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      ORDER BY r.insumo_id
    LOOP
      UPDATE public.insumos SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * v_delta)
        WHERE id = v_receta.insumo_id RETURNING stock_actual INTO v_nuevo_stock;
      IF v_nuevo_stock < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para insumo "%"', v_receta.insumo_nombre; END IF;
    END LOOP;
  ELSE
    FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = p_producto_id ORDER BY r.insumo_id LOOP
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

-- 5) reintegrar_inventario_cancelacion
CREATE OR REPLACE FUNCTION public.reintegrar_inventario_cancelacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d RECORD;
  r RECORD;
  v_cant_reintegrada numeric;
  v_nombre_insumo text;
  v_unidad text;
  v_detalle jsonb := '[]'::jsonb;
  v_total_lineas integer := 0;
BEGIN
  IF NEW.estado = 'cancelada' AND (OLD.estado IS DISTINCT FROM 'cancelada') THEN
    FOR d IN
      SELECT producto_id, cantidad
      FROM detalle_ventas
      WHERE venta_id = NEW.id AND producto_id IS NOT NULL
      ORDER BY producto_id
    LOOP
      FOR r IN
        SELECT insumo_id, cantidad_necesaria
        FROM recetas
        WHERE producto_id = d.producto_id
        ORDER BY insumo_id
      LOOP
        v_cant_reintegrada := r.cantidad_necesaria * d.cantidad;
        SELECT nombre, unidad_medida INTO v_nombre_insumo, v_unidad
          FROM public.insumos WHERE id = r.insumo_id FOR UPDATE;
        UPDATE public.insumos
          SET stock_actual = stock_actual + v_cant_reintegrada
          WHERE id = r.insumo_id;
        v_detalle := v_detalle || jsonb_build_object(
          'insumo_id', r.insumo_id, 'insumo_nombre', v_nombre_insumo, 'unidad', v_unidad,
          'producto_id', d.producto_id, 'cantidad_producto', d.cantidad,
          'cantidad_reintegrada', v_cant_reintegrada);
        v_total_lineas := v_total_lineas + 1;
      END LOOP;
    END LOOP;

    IF v_total_lineas > 0 THEN
      INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
      VALUES (COALESCE(auth.uid(), NEW.usuario_id), 'reintegro_inventario_por_cancelacion',
        format('Reintegro automático por cancelación de venta #%s: %s movimiento(s) de insumo',
               LPAD(NEW.folio::text, 4, '0'), v_total_lineas),
        jsonb_build_object('venta_id', NEW.id, 'folio', NEW.folio,
          'motivo_cancelacion', NEW.motivo_cancelacion, 'reintegros', v_detalle, 'transaccional', true));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 6) resolver_cancelacion_item_sesion
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

    IF v_dv.producto_id IS NOT NULL AND v_dv.paquete_id IS NULL THEN
      FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_dv.producto_id ORDER BY r.insumo_id LOOP
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

    ELSIF v_dv.paquete_id IS NOT NULL THEN
      FOR v_comp IN SELECT producto_id AS pid, cantidad AS qty FROM public.paquete_componentes WHERE paquete_id = v_dv.paquete_id ORDER BY producto_id LOOP
        FOR v_receta IN SELECT r.insumo_id, r.cantidad_necesaria FROM public.recetas r WHERE r.producto_id = v_comp.pid ORDER BY r.insumo_id LOOP
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

-- 7) recalcular_amenities_pax
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
  v_increments jsonb := '[]'::jsonb;
  v_total_mermas integer := 0;
  v_lineas_aumentadas integer := 0;
  v_lineas_reducidas integer := 0;
  v_lineas_eliminadas integer := 0;
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

    ELSIF v_delta < 0 AND v_existing_id IS NOT NULL THEN
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria
          FROM public.recetas r
         WHERE r.producto_id = v_producto_id
         ORDER BY r.insumo_id
      LOOP
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (v_receta.insumo_id, v_receta.cantidad_necesaria * abs(v_delta),
          format('Recalc amenities por baja de pax — %s ×%s (sesión %s, %s pax → %s pax)',
                 v_nombre, abs(v_delta), v_session.cliente_nombre, v_session.pax_count, p_new_pax),
          v_user);
        v_total_mermas := v_total_mermas + 1;
      END LOOP;

      IF v_new_qty <= 0 THEN
        DELETE FROM public.detalle_ventas WHERE id = v_existing_id;
        v_lineas_eliminadas := v_lineas_eliminadas + 1;
      ELSE
        UPDATE public.detalle_ventas SET cantidad = v_new_qty, subtotal = 0 WHERE id = v_existing_id;
        v_lineas_reducidas := v_lineas_reducidas + 1;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'recalcular_amenities_pax',
    format('Recalc amenities por cambio de pax (sesión %s, %s → %s pax)',
           v_session.cliente_nombre, v_session.pax_count, p_new_pax),
    jsonb_build_object('session_id', p_session_id, 'old_pax', v_session.pax_count, 'new_pax', p_new_pax,
      'increments', v_increments, 'mermas_creadas', v_total_mermas,
      'lineas_aumentadas', v_lineas_aumentadas, 'lineas_reducidas', v_lineas_reducidas,
      'lineas_eliminadas', v_lineas_eliminadas, 'transaccional', true));

  RETURN json_build_object('ok', true, 'increments', v_increments,
    'mermas_creadas', v_total_mermas, 'lineas_aumentadas', v_lineas_aumentadas,
    'lineas_reducidas', v_lineas_reducidas, 'lineas_eliminadas', v_lineas_eliminadas);
END;
$function$;

-- 8) crear_venta_completa: pre-bloqueo ordenado de TODOS los insumos del ticket
CREATE OR REPLACE FUNCTION public.crear_venta_completa(p_venta jsonb, p_detalles jsonb, p_audit jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_venta_id uuid;
  v_folio integer;
  v_coworking_id uuid;
  v_cw_total numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF (p_venta->>'usuario_id')::uuid IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'No puedes crear ventas a nombre de otro usuario' USING ERRCODE = '42501';
  END IF;

  -- Pre-bloqueo ordenado anti-deadlock: tomar lock sobre TODOS los insumos
  -- que esta venta tocará, en orden ascendente por id. Esto fija el orden
  -- global de adquisición de locks entre transacciones simultáneas.
  PERFORM 1 FROM public.insumos
  WHERE id IN (
    SELECT DISTINCT r.insumo_id
    FROM jsonb_array_elements(p_detalles) AS d
    JOIN public.recetas r ON r.producto_id = NULLIF(d->>'producto_id','')::uuid
    WHERE COALESCE(d->>'tipo_concepto','producto') <> 'coworking'
      AND NULLIF(d->>'producto_id','') IS NOT NULL
  )
  ORDER BY id
  FOR UPDATE;

  -- 1. Crear venta
  INSERT INTO public.ventas (
    usuario_id, total_bruto, iva, comisiones_bancarias, monto_propina,
    total_neto, metodo_pago, tipo_consumo, estado, fecha,
    monto_efectivo, monto_tarjeta, monto_transferencia,
    coworking_session_id, caja_id
  )
  VALUES (
    v_user,
    (p_venta->>'total_bruto')::numeric,
    (p_venta->>'iva')::numeric,
    COALESCE((p_venta->>'comisiones_bancarias')::numeric, 0),
    COALESCE((p_venta->>'monto_propina')::numeric, 0),
    (p_venta->>'total_neto')::numeric,
    (p_venta->>'metodo_pago')::metodo_pago,
    (p_venta->>'tipo_consumo')::tipo_consumo,
    'completada'::venta_estado,
    COALESCE((p_venta->>'fecha')::timestamptz, now()),
    COALESCE((p_venta->>'monto_efectivo')::numeric, 0),
    COALESCE((p_venta->>'monto_tarjeta')::numeric, 0),
    COALESCE((p_venta->>'monto_transferencia')::numeric, 0),
    NULLIF(p_venta->>'coworking_session_id','')::uuid,
    NULLIF(p_venta->>'caja_id','')::uuid
  )
  RETURNING id, folio INTO v_venta_id, v_folio;

  -- 2. Insertar detalles (los triggers descontarán inventario)
  INSERT INTO public.detalle_ventas (
    venta_id, producto_id, cantidad, precio_unitario, subtotal,
    tipo_concepto, coworking_session_id, descripcion, paquete_id, paquete_nombre
  )
  SELECT v_venta_id,
    NULLIF(d->>'producto_id','')::uuid,
    (d->>'cantidad')::integer,
    (d->>'precio_unitario')::numeric,
    (d->>'subtotal')::numeric,
    COALESCE(d->>'tipo_concepto','producto')::tipo_concepto,
    NULLIF(d->>'coworking_session_id','')::uuid,
    d->>'descripcion',
    NULLIF(d->>'paquete_id','')::uuid,
    d->>'paquete_nombre'
  FROM jsonb_array_elements(p_detalles) AS d;

  -- 3. Finalizar sesión coworking si aplica
  v_coworking_id := NULLIF(p_venta->>'coworking_session_id','')::uuid;
  IF v_coworking_id IS NOT NULL THEN
    SELECT COALESCE(SUM((d->>'subtotal')::numeric), 0)
      INTO v_cw_total
      FROM jsonb_array_elements(p_detalles) AS d
      WHERE d->>'tipo_concepto' = 'coworking';

    UPDATE public.coworking_sessions
       SET estado = 'finalizado'::coworking_estado,
           fecha_salida_real = now(),
           monto_acumulado = v_cw_total,
           updated_at = now()
     WHERE id = v_coworking_id;
  END IF;

  -- 4. Bitácora
  IF p_audit IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (
      v_user,
      COALESCE(p_audit->>'accion', 'venta_completada'),
      p_audit->>'descripcion',
      COALESCE(p_audit->'metadata', '{}'::jsonb)
        || jsonb_build_object('venta_id', v_venta_id, 'folio', v_folio, 'transaccional', true)
    );
  END IF;

  RETURN json_build_object('id', v_venta_id, 'folio', v_folio);
END;
$function$;
