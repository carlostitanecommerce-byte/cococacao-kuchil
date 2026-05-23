-- Fix validar_stock_carrito para expandir paquetes a sus componentes.
-- Antes solo miraba item.producto_id (que para un paquete no tiene recetas),
-- por lo que paquetes pasaban siempre la validación. Ahora, cuando
-- tipo_concepto='paquete', itera sobre item.componentes y suma el uso
-- de insumos por cada producto-componente.
CREATE OR REPLACE FUNCTION public.validar_stock_carrito(p_items jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_comp jsonb;
  v_uso_acumulado jsonb := '{}'::jsonb;
  v_receta RECORD;
  v_uso_comprometido NUMERIC;
  v_stock_disponible NUMERIC;
  v_uso_carrito NUMERIC;
  v_cant integer;
  v_prod uuid;
  v_tipo text;
  v_comp_prod uuid;
  v_comp_cant numeric;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_tipo := COALESCE(v_item->>'tipo_concepto', 'producto');
    v_cant := COALESCE((v_item->>'cantidad')::integer, 0);
    IF v_cant <= 0 THEN CONTINUE; END IF;

    IF v_tipo = 'coworking' THEN
      CONTINUE;
    END IF;

    IF v_tipo = 'paquete' THEN
      -- Sumar uso de insumos a partir de los componentes del paquete
      IF v_item ? 'componentes' AND jsonb_typeof(v_item->'componentes') = 'array' THEN
        FOR v_comp IN SELECT * FROM jsonb_array_elements(v_item->'componentes') LOOP
          v_comp_prod := NULLIF(v_comp->>'producto_id','')::uuid;
          v_comp_cant := COALESCE((v_comp->>'cantidad')::numeric, 0);
          IF v_comp_prod IS NULL OR v_comp_cant <= 0 THEN CONTINUE; END IF;
          FOR v_receta IN
            SELECT insumo_id, cantidad_necesaria
            FROM public.recetas WHERE producto_id = v_comp_prod
          LOOP
            v_uso_acumulado := jsonb_set(
              v_uso_acumulado,
              ARRAY[v_receta.insumo_id::text],
              to_jsonb(
                COALESCE((v_uso_acumulado->>v_receta.insumo_id::text)::numeric, 0)
                + (v_receta.cantidad_necesaria * v_comp_cant * v_cant)
              )
            );
          END LOOP;
        END LOOP;
      END IF;
      CONTINUE;
    END IF;

    -- producto / amenity / otros con receta directa
    v_prod := NULLIF(v_item->>'producto_id','')::uuid;
    IF v_prod IS NULL THEN CONTINUE; END IF;
    FOR v_receta IN
      SELECT insumo_id, cantidad_necesaria
      FROM public.recetas WHERE producto_id = v_prod
    LOOP
      v_uso_acumulado := jsonb_set(
        v_uso_acumulado,
        ARRAY[v_receta.insumo_id::text],
        to_jsonb(
          COALESCE((v_uso_acumulado->>v_receta.insumo_id::text)::numeric, 0)
          + (v_receta.cantidad_necesaria * v_cant)
        )
      );
    END LOOP;
  END LOOP;

  -- Comparar uso acumulado contra stock disponible (descontando coworking abierto)
  FOR v_receta IN
    SELECT i.id AS insumo_id, i.stock_actual, i.nombre
    FROM public.insumos i
    WHERE i.id::text IN (SELECT jsonb_object_keys(v_uso_acumulado))
  LOOP
    SELECT COALESCE(SUM(r_sub.cantidad_necesaria * dv.cantidad), 0)
      INTO v_uso_comprometido
    FROM public.detalle_ventas dv
    JOIN public.coworking_sessions cs ON cs.id = dv.coworking_session_id
    JOIN public.recetas r_sub ON r_sub.producto_id = dv.producto_id
    WHERE dv.venta_id IS NULL
      AND cs.estado IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado)
      AND r_sub.insumo_id = v_receta.insumo_id;

    v_stock_disponible := v_receta.stock_actual - v_uso_comprometido;
    v_uso_carrito := (v_uso_acumulado->>v_receta.insumo_id::text)::numeric;
    IF v_stock_disponible < v_uso_carrito THEN
      RETURN json_build_object(
        'valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre
                 || '. Disponible: ' || v_stock_disponible
                 || ', requerido: ' || v_uso_carrito
      );
    END IF;
  END LOOP;

  RETURN json_build_object('valido', true);
END;
$function$;