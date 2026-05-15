
-- 1. Trigger para reintegrar inventario al cancelar venta
CREATE OR REPLACE FUNCTION public.reintegrar_inventario_cancelacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  d RECORD;
  r RECORD;
BEGIN
  IF NEW.estado = 'cancelada' AND (OLD.estado IS DISTINCT FROM 'cancelada') THEN
    FOR d IN
      SELECT producto_id, cantidad
      FROM detalle_ventas
      WHERE venta_id = NEW.id AND producto_id IS NOT NULL
    LOOP
      FOR r IN
        SELECT insumo_id, cantidad_necesaria
        FROM recetas
        WHERE producto_id = d.producto_id
      LOOP
        UPDATE insumos
        SET stock_actual = stock_actual + (r.cantidad_necesaria * d.cantidad)
        WHERE id = r.insumo_id;
      END LOOP;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reintegrar_inventario_cancelacion ON public.ventas;
CREATE TRIGGER trg_reintegrar_inventario_cancelacion
AFTER UPDATE ON public.ventas
FOR EACH ROW
EXECUTE FUNCTION public.reintegrar_inventario_cancelacion();

-- 2. Índice único parcial: solo una caja abierta a la vez
CREATE UNIQUE INDEX IF NOT EXISTS cajas_unique_open
ON public.cajas ((1))
WHERE estado = 'abierta';

-- 3. Validación de stock para carrito completo
CREATE OR REPLACE FUNCTION public.validar_stock_carrito(p_items jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item jsonb;
  v_resultado json;
  v_uso_acumulado jsonb := '{}'::jsonb;
  v_receta RECORD;
  v_uso_comprometido NUMERIC;
  v_stock_disponible NUMERIC;
  v_uso_carrito NUMERIC;
  v_cant integer;
  v_prod uuid;
BEGIN
  -- Acumular consumo total por insumo en el carrito
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod := (v_item->>'producto_id')::uuid;
    v_cant := (v_item->>'cantidad')::integer;
    IF v_prod IS NULL THEN CONTINUE; END IF;

    FOR v_receta IN
      SELECT insumo_id, cantidad_necesaria
      FROM recetas WHERE producto_id = v_prod
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

  -- Comparar contra stock real menos compromisos de coworking activos
  FOR v_receta IN
    SELECT i.id AS insumo_id, i.stock_actual, i.nombre
    FROM insumos i
    WHERE i.id::text IN (SELECT jsonb_object_keys(v_uso_acumulado))
  LOOP
    SELECT COALESCE(SUM(r_sub.cantidad_necesaria * csu.cantidad), 0)
    INTO v_uso_comprometido
    FROM coworking_session_upsells csu
    JOIN coworking_sessions cs ON cs.id = csu.session_id
    JOIN recetas r_sub ON r_sub.producto_id = csu.producto_id
    WHERE cs.estado = 'activo' AND r_sub.insumo_id = v_receta.insumo_id;

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
$$;

-- 4. Backfill: corregir total_neto histórico (debe ser subtotal sin propina)
UPDATE public.ventas
SET total_neto = total_neto - COALESCE(monto_propina, 0)
WHERE estado = 'completada'
  AND COALESCE(monto_propina, 0) > 0
  AND total_neto > total_bruto;
