-- Corregir validar_stock_carrito para eliminar el doble conteo de stock
-- (los consumos de coworking ya se descuentan físicamente en registrar_consumo_coworking y registrar_amenity_sesion)

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
  v_uso_carrito NUMERIC;
  v_cant integer;
  v_prod uuid;
  v_tipo text;
  v_comp_prod uuid;
  v_comp_cant numeric;
  v_prod_row RECORD;
  v_recetas_count integer;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_tipo := COALESCE(v_item->>'tipo_concepto', 'producto');
    v_cant := COALESCE((v_item->>'cantidad')::integer, 0);
    IF v_cant <= 0 THEN CONTINUE; END IF;

    IF v_tipo = 'coworking' THEN
      CONTINUE;
    END IF;

    IF v_tipo = 'paquete' THEN
      IF v_item ? 'componentes' AND jsonb_typeof(v_item->'componentes') = 'array' THEN
        FOR v_comp IN SELECT * FROM jsonb_array_elements(v_item->'componentes') LOOP
          v_comp_prod := NULLIF(v_comp->>'producto_id','')::uuid;
          v_comp_cant := COALESCE((v_comp->>'cantidad')::numeric, 0);
          IF v_comp_prod IS NULL OR v_comp_cant <= 0 THEN CONTINUE; END IF;

          -- Validar que el producto del componente exista, esté activo y tenga receta si requiere preparación
          SELECT p.id, p.nombre, p.activo, p.requiere_preparacion
            INTO v_prod_row
          FROM public.productos p WHERE p.id = v_comp_prod;
          IF NOT FOUND THEN
            RETURN json_build_object('valido', false,
              'error', 'Una opción del paquete ya no existe en el catálogo.');
          END IF;
          IF v_prod_row.activo = false THEN
            RETURN json_build_object('valido', false,
              'error', 'La opción "' || v_prod_row.nombre || '" está inactiva.');
          END IF;

          SELECT COUNT(*) INTO v_recetas_count FROM public.recetas WHERE producto_id = v_comp_prod;
          IF v_prod_row.requiere_preparacion = true AND v_recetas_count = 0 THEN
            RETURN json_build_object('valido', false,
              'error', 'La opción "' || v_prod_row.nombre || '" no tiene receta configurada; no se puede validar ni descontar inventario.');
          END IF;

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

    SELECT p.id, p.nombre, p.activo, p.requiere_preparacion
      INTO v_prod_row
    FROM public.productos p WHERE p.id = v_prod;
    IF NOT FOUND THEN
      RETURN json_build_object('valido', false,
        'error', 'Uno de los productos del ticket ya no existe en el catálogo.');
    END IF;
    IF v_prod_row.activo = false THEN
      RETURN json_build_object('valido', false,
        'error', 'El producto "' || v_prod_row.nombre || '" está inactivo.');
    END IF;
    SELECT COUNT(*) INTO v_recetas_count FROM public.recetas WHERE producto_id = v_prod;
    IF v_prod_row.requiere_preparacion = true AND v_recetas_count = 0 THEN
      RETURN json_build_object('valido', false,
        'error', 'El producto "' || v_prod_row.nombre || '" no tiene receta configurada; no se puede validar ni descontar inventario.');
    END IF;

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

  -- Comparar uso acumulado contra el stock_actual físico disponible en DB
  FOR v_receta IN
    SELECT i.id AS insumo_id, i.stock_actual, i.nombre
    FROM public.insumos i
    WHERE i.id::text IN (SELECT jsonb_object_keys(v_uso_acumulado))
  LOOP
    v_uso_carrito := (v_uso_acumulado->>v_receta.insumo_id::text)::numeric;
    IF v_receta.stock_actual < v_uso_carrito THEN
      RETURN json_build_object(
        'valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre
                 || '. Disponible: ' || v_receta.stock_actual
                 || ', requerido: ' || v_uso_carrito
      );
    END IF;
  END LOOP;

  RETURN json_build_object('valido', true);
END;
$function$;
