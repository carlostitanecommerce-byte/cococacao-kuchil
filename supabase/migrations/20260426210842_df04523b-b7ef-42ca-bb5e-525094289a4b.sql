-- Función para recalcular costos y márgenes de productos basados en sus recetas
CREATE OR REPLACE FUNCTION public.recalcular_costos_productos(p_insumo_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producto record;
  v_costo_total numeric;
  v_margen numeric;
  v_count integer := 0;
BEGIN
  -- Iterar sobre los productos afectados
  FOR v_producto IN
    SELECT DISTINCT p.id, p.precio_venta
    FROM public.productos p
    JOIN public.recetas r ON r.producto_id = p.id
    WHERE p_insumo_id IS NULL OR r.insumo_id = p_insumo_id
  LOOP
    -- Calcular costo total sumando (cantidad_necesaria * costo_unitario) de cada insumo
    SELECT COALESCE(SUM(r.cantidad_necesaria * i.costo_unitario), 0)
    INTO v_costo_total
    FROM public.recetas r
    JOIN public.insumos i ON i.id = r.insumo_id
    WHERE r.producto_id = v_producto.id;

    -- Calcular margen %
    IF v_producto.precio_venta > 0 THEN
      v_margen := ((v_producto.precio_venta - v_costo_total) / v_producto.precio_venta) * 100;
    ELSE
      v_margen := 0;
    END IF;

    UPDATE public.productos
    SET costo_total = v_costo_total,
        margen = v_margen,
        updated_at = now()
    WHERE id = v_producto.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Trigger que recalcula automáticamente cuando cambia el costo unitario de un insumo
CREATE OR REPLACE FUNCTION public.trigger_recalcular_costos_insumo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.costo_unitario IS DISTINCT FROM OLD.costo_unitario THEN
    PERFORM public.recalcular_costos_productos(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcular_costos_insumo ON public.insumos;
CREATE TRIGGER trg_recalcular_costos_insumo
AFTER UPDATE OF costo_unitario ON public.insumos
FOR EACH ROW
EXECUTE FUNCTION public.trigger_recalcular_costos_insumo();

-- Índice único en nombre de insumos (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS insumos_nombre_unique_idx
ON public.insumos (LOWER(TRIM(nombre)));

-- Índice único en nombre de productos (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS productos_nombre_unique_idx
ON public.productos (LOWER(TRIM(nombre)));