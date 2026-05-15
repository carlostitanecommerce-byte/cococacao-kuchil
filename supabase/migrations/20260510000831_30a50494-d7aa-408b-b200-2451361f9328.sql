-- O3: Soft-delete para compras_insumos (preservar traza)
ALTER TABLE public.compras_insumos
  ADD COLUMN IF NOT EXISTS anulada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_anulacion text,
  ADD COLUMN IF NOT EXISTS anulada_at timestamptz,
  ADD COLUMN IF NOT EXISTS anulada_por uuid;

-- O3: anular_compra_insumo ahora marca como anulada en vez de DELETE
CREATE OR REPLACE FUNCTION public.anular_compra_insumo(p_compra_id uuid, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_compra RECORD;
  v_stock_actual numeric;
  v_nombre_insumo text;
  v_unidad text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_user, 'administrador'::app_role) THEN
    RAISE EXCEPTION 'Solo administradores pueden anular compras' USING ERRCODE = '42501';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo de anulación es obligatorio';
  END IF;

  SELECT * INTO v_compra FROM public.compras_insumos WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada';
  END IF;

  IF v_compra.anulada THEN
    RAISE EXCEPTION 'Esta compra ya fue anulada';
  END IF;

  SELECT stock_actual, nombre, unidad_medida
    INTO v_stock_actual, v_nombre_insumo, v_unidad
  FROM public.insumos
  WHERE id = v_compra.insumo_id
  FOR UPDATE;

  IF v_stock_actual IS NULL THEN
    RAISE EXCEPTION 'Insumo asociado no existe';
  END IF;

  IF v_stock_actual < v_compra.cantidad_unidades THEN
    RAISE EXCEPTION 'No se puede anular: el insumo "%" tiene stock actual (% %) menor al que aportó la compra (% %). Ya fue consumido parcialmente.',
      v_nombre_insumo, v_stock_actual, v_unidad, v_compra.cantidad_unidades, v_unidad;
  END IF;

  UPDATE public.insumos
  SET stock_actual = stock_actual - v_compra.cantidad_unidades
  WHERE id = v_compra.insumo_id;

  UPDATE public.compras_insumos
     SET anulada = true,
         motivo_anulacion = trim(p_motivo),
         anulada_at = now(),
         anulada_por = v_user
   WHERE id = p_compra_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'anular_compra_insumo',
    format('Compra anulada: %s — se descontaron %s %s. Motivo: %s',
           v_nombre_insumo, v_compra.cantidad_unidades, v_unidad, trim(p_motivo)),
    jsonb_build_object(
      'compra_id', p_compra_id,
      'insumo_id', v_compra.insumo_id,
      'insumo_nombre', v_nombre_insumo,
      'cantidad_unidades_revertidas', v_compra.cantidad_unidades,
      'cantidad_presentaciones', v_compra.cantidad_presentaciones,
      'costo_total', v_compra.costo_total,
      'fecha_compra_original', v_compra.fecha,
      'motivo', trim(p_motivo),
      'transaccional', true
    )
  );

  RETURN json_build_object('ok', true, 'stock_resultante', v_stock_actual - v_compra.cantidad_unidades);
END;
$function$;

-- O3: el trigger de stock NO debe sumar al revertir (la compra se anula, no se inserta de nuevo)
-- pero al insertar una compra que ya viene anulada (caso raro) no debe sumar tampoco
CREATE OR REPLACE FUNCTION public.sumar_stock_compra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.anulada IS TRUE THEN
    RETURN NEW;
  END IF;
  UPDATE insumos
  SET stock_actual = stock_actual + NEW.cantidad_unidades
  WHERE id = NEW.insumo_id;
  RETURN NEW;
END;
$function$;

-- O2: descontar_inventario_venta valida antes del UPDATE con mensaje claro
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
  IF NEW.venta_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo_concepto = 'coworking'::tipo_concepto THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo_concepto = 'producto'::tipo_concepto AND NEW.producto_id IS NULL THEN
    RAISE EXCEPTION 'Detalle de venta sin producto_id (tipo_concepto=producto). Posible paquete sin opciones expandidas.';
  END IF;

  IF NEW.producto_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nombre INTO v_nombre_producto FROM public.productos WHERE id = NEW.producto_id;

  FOR r IN
    SELECT recetas.insumo_id, recetas.cantidad_necesaria
    FROM recetas
    WHERE recetas.producto_id = NEW.producto_id
  LOOP
    cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;

    SELECT stock_actual, nombre INTO v_stock_actual, v_nombre_insumo
      FROM insumos WHERE id = r.insumo_id FOR UPDATE;

    IF v_stock_actual < cantidad_requerida THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": falta insumo "%" (disponible: %, requerido: %)',
        COALESCE(v_nombre_producto, NEW.descripcion, 'producto'),
        v_nombre_insumo, v_stock_actual, cantidad_requerida;
    END IF;

    UPDATE insumos
    SET stock_actual = stock_actual - cantidad_requerida
    WHERE id = r.insumo_id;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- O1: registrar_consumo_coworking acumula uso entre ítems antes de validar
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
  v_nuevo_stock numeric;
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

  -- 1. Acumular uso de insumos para validar el cargo COMPLETO antes de tocar stock
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

  -- Validar stock acumulado
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

  -- 2. Insertar detalle_ventas + descontar inventario
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
      v_tipo_concepto::tipo_concepto, p_session_id,
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

  -- 3. KDS sólo con productos que requieren preparación
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