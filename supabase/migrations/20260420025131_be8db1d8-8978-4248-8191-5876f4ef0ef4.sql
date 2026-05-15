CREATE OR REPLACE FUNCTION public.validar_stock_disponible(
  p_producto_id UUID,
  p_cantidad INT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receta RECORD;
  v_uso_comprometido NUMERIC;
  v_stock_disponible NUMERIC;
BEGIN
  FOR v_receta IN 
    SELECT r.insumo_id, r.cantidad_necesaria, i.stock_actual, i.nombre
    FROM recetas r
    JOIN insumos i ON i.id = r.insumo_id
    WHERE r.producto_id = p_producto_id
  LOOP
    SELECT COALESCE(SUM(r_sub.cantidad_necesaria * csu.cantidad), 0)
    INTO v_uso_comprometido
    FROM coworking_session_upsells csu
    JOIN coworking_sessions cs ON cs.id = csu.session_id
    JOIN recetas r_sub ON r_sub.producto_id = csu.producto_id
    WHERE cs.estado = 'activo' AND r_sub.insumo_id = v_receta.insumo_id;

    v_stock_disponible := v_receta.stock_actual - v_uso_comprometido;

    IF v_stock_disponible < (v_receta.cantidad_necesaria * p_cantidad) THEN
      RETURN json_build_object(
        'valido', false,
        'error', 'Stock insuficiente de ' || v_receta.nombre || '. Disponible real: ' || v_stock_disponible
      );
    END IF;
  END LOOP;

  RETURN json_build_object('valido', true);
END;
$$;