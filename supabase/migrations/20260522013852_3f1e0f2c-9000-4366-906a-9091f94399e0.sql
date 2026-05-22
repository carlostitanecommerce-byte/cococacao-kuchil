
CREATE OR REPLACE FUNCTION public.validar_stock_carrito(p_items jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_subitem jsonb;
  v_uso_acumulado jsonb := '{}'::jsonb;
  v_receta RECORD;
  v_uso_carrito NUMERIC;
  v_cant integer;
  v_sub_cant numeric;
  v_prod uuid;
  v_tipo text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cant := COALESCE((v_item->>'cantidad')::integer, 1);
    v_tipo := COALESCE(v_item->>'tipo_concepto', 'producto');

    IF v_tipo = 'paquete' THEN
      -- Expandir opciones (paquetes dinámicos): 1 unidad por opción
      IF jsonb_typeof(v_item->'opciones') = 'array' THEN
        FOR v_subitem IN SELECT * FROM jsonb_array_elements(v_item->'opciones') LOOP
          v_prod := (v_subitem->>'producto_id')::uuid;
          IF v_prod IS NULL THEN CONTINUE; END IF;
          FOR v_receta IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = v_prod LOOP
            v_uso_acumulado := jsonb_set(v_uso_acumulado, ARRAY[v_receta.insumo_id::text],
              to_jsonb(COALESCE((v_uso_acumulado->>v_receta.insumo_id::text)::numeric, 0)
                       + (v_receta.cantidad_necesaria * v_cant)));
          END LOOP;
        END LOOP;
      -- Expandir componentes (paquetes legacy): cantidad por componente
      ELSIF jsonb_typeof(v_item->'componentes') = 'array' THEN
        FOR v_subitem IN SELECT * FROM jsonb_array_elements(v_item->'componentes') LOOP
          v_prod := (v_subitem->>'producto_id')::uuid;
          v_sub_cant := COALESCE((v_subitem->>'cantidad')::numeric, 1);
          IF v_prod IS NULL THEN CONTINUE; END IF;
          FOR v_receta IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = v_prod LOOP
            v_uso_acumulado := jsonb_set(v_uso_acumulado, ARRAY[v_receta.insumo_id::text],
              to_jsonb(COALESCE((v_uso_acumulado->>v_receta.insumo_id::text)::numeric, 0)
                       + (v_receta.cantidad_necesaria * v_sub_cant * v_cant)));
          END LOOP;
        END LOOP;
      END IF;
    ELSE
      -- Producto simple (comportamiento original)
      v_prod := (v_item->>'producto_id')::uuid;
      IF v_prod IS NULL THEN CONTINUE; END IF;
      FOR v_receta IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = v_prod LOOP
        v_uso_acumulado := jsonb_set(v_uso_acumulado, ARRAY[v_receta.insumo_id::text],
          to_jsonb(COALESCE((v_uso_acumulado->>v_receta.insumo_id::text)::numeric, 0)
                   + (v_receta.cantidad_necesaria * v_cant)));
      END LOOP;
    END IF;
  END LOOP;

  FOR v_receta IN
    SELECT i.id AS insumo_id, i.stock_actual, i.nombre, i.unidad_medida FROM public.insumos i
    WHERE i.id::text IN (SELECT jsonb_object_keys(v_uso_acumulado))
  LOOP
    v_uso_carrito := (v_uso_acumulado->>v_receta.insumo_id::text)::numeric;
    IF v_receta.stock_actual < v_uso_carrito THEN
      RETURN json_build_object('valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre
                 || '. Disponible: ' || v_receta.stock_actual || ' ' || v_receta.unidad_medida
                 || ', requerido: ' || v_uso_carrito || ' ' || v_receta.unidad_medida);
    END IF;
  END LOOP;
  RETURN json_build_object('valido', true);
END;
$function$;
