-- Backfill defensivo
UPDATE public.productos SET tipo = 'simple' WHERE tipo IS NULL OR tipo NOT IN ('simple','paquete');

-- CHECK constraint
ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_tipo_check;
ALTER TABLE public.productos ADD CONSTRAINT productos_tipo_check CHECK (tipo IN ('simple','paquete'));

-- Refactor: validar_stock_paquete asume cantidades enteras
CREATE OR REPLACE FUNCTION public.validar_stock_paquete(p_paquete_id uuid, p_cantidad integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_resultado json;
  v_cant_total integer;
BEGIN
  FOR v_comp IN
    SELECT producto_id, cantidad
    FROM paquete_componentes
    WHERE paquete_id = p_paquete_id
  LOOP
    v_cant_total := (v_comp.cantidad * p_cantidad)::integer;
    v_resultado := validar_stock_disponible(v_comp.producto_id, v_cant_total);
    IF (v_resultado->>'valido')::boolean = false THEN
      RETURN v_resultado;
    END IF;
  END LOOP;

  RETURN json_build_object('valido', true);
END;
$function$;