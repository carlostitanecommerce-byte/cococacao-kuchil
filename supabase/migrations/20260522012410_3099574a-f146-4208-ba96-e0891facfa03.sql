CREATE OR REPLACE FUNCTION public.reintegrar_inventario_cancelacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d RECORD;
  r RECORD;
  v_cant_reintegrada numeric;
  v_nombre_insumo text;
  v_unidad text;
  v_detalle jsonb := '[]'::jsonb;
  v_total_lineas integer := 0;
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
        v_cant_reintegrada := r.cantidad_necesaria * d.cantidad;

        -- Bloquear fila del insumo para evitar carreras entre cancelaciones simultáneas
        SELECT nombre, unidad_medida INTO v_nombre_insumo, v_unidad
          FROM public.insumos
          WHERE id = r.insumo_id
          FOR UPDATE;

        UPDATE public.insumos
          SET stock_actual = stock_actual + v_cant_reintegrada
          WHERE id = r.insumo_id;

        v_detalle := v_detalle || jsonb_build_object(
          'insumo_id', r.insumo_id,
          'insumo_nombre', v_nombre_insumo,
          'unidad', v_unidad,
          'producto_id', d.producto_id,
          'cantidad_producto', d.cantidad,
          'cantidad_reintegrada', v_cant_reintegrada
        );
        v_total_lineas := v_total_lineas + 1;
      END LOOP;
    END LOOP;

    IF v_total_lineas > 0 THEN
      INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
      VALUES (
        COALESCE(auth.uid(), NEW.usuario_id),
        'reintegro_inventario_por_cancelacion',
        format('Reintegro automático por cancelación de venta #%s: %s movimiento(s) de insumo',
               LPAD(NEW.folio::text, 4, '0'), v_total_lineas),
        jsonb_build_object(
          'venta_id', NEW.id,
          'folio', NEW.folio,
          'motivo_cancelacion', NEW.motivo_cancelacion,
          'reintegros', v_detalle,
          'transaccional', true
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;