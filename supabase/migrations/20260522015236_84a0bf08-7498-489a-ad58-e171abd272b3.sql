-- Defensa en profundidad: impedir stock negativo a nivel base de datos
ALTER TABLE public.insumos
  ADD CONSTRAINT insumos_stock_no_negativo
  CHECK (stock_actual >= 0)
  NOT VALID;

ALTER TABLE public.insumos
  VALIDATE CONSTRAINT insumos_stock_no_negativo;

-- Reemitir mensaje legible si el constraint llegara a dispararse desde el trigger de ventas
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

    BEGIN
      UPDATE insumos
      SET stock_actual = stock_actual - cantidad_requerida
      WHERE id = r.insumo_id;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": el inventario de "%" quedaría negativo',
        COALESCE(v_nombre_producto, NEW.descripcion, 'producto'),
        v_nombre_insumo;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;