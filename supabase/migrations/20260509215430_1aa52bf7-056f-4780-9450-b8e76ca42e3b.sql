
CREATE OR REPLACE FUNCTION public.registrar_consumo_coworking(
  p_session_id uuid,
  p_items jsonb,
  p_kds_items jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session RECORD;
  v_item jsonb;
  v_kds_item jsonb;
  v_validacion json;
  v_producto_id uuid;
  v_cantidad integer;
  v_tipo_concepto text;
  v_paquete_id uuid;
  v_componentes jsonb;
  v_componente jsonb;
  v_receta RECORD;
  v_nuevo_stock numeric;
  v_nombre_insumo text;
  v_nombre_producto text;
  v_total numeric := 0;
  v_lineas integer := 0;
  v_kds_order_id uuid := NULL;
  v_kds_folio integer := NULL;
  v_requiere_prep boolean;
  v_kds_rows jsonb := '[]'::jsonb;
  v_sufijo text;
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

  -- 1. Validar stock por ítem
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
        v_validacion := public.validar_stock_paquete(v_paquete_id, v_cantidad);
        IF (v_validacion->>'valido')::boolean = false THEN
          RAISE EXCEPTION '%', v_validacion->>'error';
        END IF;
      ELSE
        FOR v_componente IN SELECT * FROM jsonb_array_elements(v_componentes)
        LOOP
          v_validacion := public.validar_stock_disponible(
            (v_componente->>'producto_id')::uuid,
            ((v_componente->>'cantidad')::numeric * v_cantidad)::integer
          );
          IF (v_validacion->>'valido')::boolean = false THEN
            RAISE EXCEPTION '%', v_validacion->>'error';
          END IF;
        END LOOP;
      END IF;
    ELSE
      IF v_producto_id IS NULL THEN
        RAISE EXCEPTION 'Producto sin id';
      END IF;
      v_validacion := public.validar_stock_disponible(v_producto_id, v_cantidad);
      IF (v_validacion->>'valido')::boolean = false THEN
        RAISE EXCEPTION '%', v_validacion->>'error';
      END IF;
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
      NULL,
      v_producto_id,
      v_cantidad,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'subtotal')::numeric,
      v_tipo_concepto::tipo_concepto,
      p_session_id,
      v_item->>'descripcion',
      v_paquete_id,
      v_item->>'paquete_nombre'
    );

    v_total := v_total + (v_item->>'subtotal')::numeric;
    v_lineas := v_lineas + 1;

    -- Descontar inventario manualmente (el trigger ignora venta_id NULL)
    IF v_tipo_concepto = 'paquete' THEN
      IF v_componentes IS NOT NULL AND jsonb_typeof(v_componentes) = 'array' AND jsonb_array_length(v_componentes) > 0 THEN
        FOR v_componente IN SELECT * FROM jsonb_array_elements(v_componentes)
        LOOP
          FOR v_receta IN
            SELECT r.insumo_id, r.cantidad_necesaria, i.nombre AS nombre_insumo
            FROM public.recetas r JOIN public.insumos i ON i.id = r.insumo_id
            WHERE r.producto_id = (v_componente->>'producto_id')::uuid
          LOOP
            UPDATE public.insumos
              SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * (v_componente->>'cantidad')::numeric * v_cantidad)
              WHERE id = v_receta.insumo_id
              RETURNING stock_actual INTO v_nuevo_stock;
            IF v_nuevo_stock < 0 THEN
              RAISE EXCEPTION 'Stock insuficiente para insumo "%"', v_receta.nombre_insumo;
            END IF;
          END LOOP;
        END LOOP;
      ELSE
        -- Fallback: usar paquete_componentes
        FOR v_componente IN
          SELECT jsonb_build_object('producto_id', producto_id, 'cantidad', cantidad) AS j
          FROM public.paquete_componentes WHERE paquete_id = v_paquete_id
        LOOP
          FOR v_receta IN
            SELECT r.insumo_id, r.cantidad_necesaria, i.nombre AS nombre_insumo
            FROM public.recetas r JOIN public.insumos i ON i.id = r.insumo_id
            WHERE r.producto_id = ((v_componente->>'producto_id')::uuid)
          LOOP
            UPDATE public.insumos
              SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * (v_componente->>'cantidad')::numeric * v_cantidad)
              WHERE id = v_receta.insumo_id
              RETURNING stock_actual INTO v_nuevo_stock;
            IF v_nuevo_stock < 0 THEN
              RAISE EXCEPTION 'Stock insuficiente para insumo "%"', v_receta.nombre_insumo;
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    ELSE
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria, i.nombre AS nombre_insumo
        FROM public.recetas r JOIN public.insumos i ON i.id = r.insumo_id
        WHERE r.producto_id = v_producto_id
      LOOP
        UPDATE public.insumos
          SET stock_actual = stock_actual - (v_receta.cantidad_necesaria * v_cantidad)
          WHERE id = v_receta.insumo_id
          RETURNING stock_actual INTO v_nuevo_stock;
        IF v_nuevo_stock < 0 THEN
          RAISE EXCEPTION 'Stock insuficiente para insumo "%"', v_receta.nombre_insumo;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- 3. Crear orden KDS sólo con productos que requieren preparación
  IF p_kds_items IS NOT NULL AND jsonb_typeof(p_kds_items) = 'array' AND jsonb_array_length(p_kds_items) > 0 THEN
    FOR v_kds_item IN SELECT * FROM jsonb_array_elements(p_kds_items)
    LOOP
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
      SELECT
        v_kds_order_id,
        (k->>'producto_id')::uuid,
        CASE WHEN COALESCE((k->>'is_amenity')::boolean, false)
             THEN format('%s ☕ %s', k->>'nombre', v_sufijo)
             ELSE format('%s %s', k->>'nombre', v_sufijo)
        END,
        (k->>'cantidad')::integer,
        NULLIF(k->>'notas','')
      FROM jsonb_array_elements(v_kds_rows) AS k;
    END IF;
  END IF;

  -- 4. Audit log
  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'coworking_open_account_charge',
    format('Cargo a cuenta abierta de %s · %s líneas · $%s',
           v_session.cliente_nombre, v_lineas, round(v_total::numeric, 2)),
    jsonb_build_object(
      'session_id', p_session_id,
      'lineas', v_lineas,
      'total', v_total,
      'kds_order_id', v_kds_order_id,
      'kds_folio', v_kds_folio,
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'kds_order_id', v_kds_order_id,
    'kds_folio', v_kds_folio,
    'lineas_insertadas', v_lineas,
    'total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_consumo_coworking(uuid, jsonb, jsonb) TO authenticated;
