CREATE OR REPLACE FUNCTION public.descontar_inventario_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cantidad_requerida numeric;
  nuevo_stock numeric;
  nombre_insumo text;
BEGIN
  -- Las líneas originadas de coworking ya descontaron stock al enviarse a cocina
  IF NEW.tipo_concepto = 'coworking'::tipo_concepto THEN
    RETURN NEW;
  END IF;

  -- Guardia: detalles tipo 'producto' deben tener producto_id
  IF NEW.tipo_concepto = 'producto'::tipo_concepto AND NEW.producto_id IS NULL THEN
    RAISE EXCEPTION 'Detalle de venta sin producto_id (tipo_concepto=producto). Posible paquete sin opciones expandidas.';
  END IF;

  IF NEW.producto_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT recetas.insumo_id, recetas.cantidad_necesaria
    FROM recetas
    WHERE recetas.producto_id = NEW.producto_id
  LOOP
    cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;

    UPDATE insumos
    SET stock_actual = stock_actual - cantidad_requerida
    WHERE id = r.insumo_id;

    SELECT stock_actual, nombre INTO nuevo_stock, nombre_insumo
    FROM insumos WHERE id = r.insumo_id;

    IF nuevo_stock < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para insumo "%"', nombre_insumo;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;