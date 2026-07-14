
DO $$
DECLARE
  v_corte timestamptz := '2026-07-14 02:30:00+00';
  v_venta RECORD;
BEGIN
  -- 1. Revertir stock de ventas completadas en rango
  FOR v_venta IN
    SELECT id FROM public.ventas
    WHERE created_at >= v_corte AND estado = 'completada'::venta_estado
  LOOP
    PERFORM public.revertir_stock_venta(v_venta.id);
  END LOOP;

  -- 2. Borrar detalle_ventas del rango (incluye líneas sin venta ligadas a sesiones de coworking en rango)
  DELETE FROM public.detalle_ventas
   WHERE created_at >= v_corte
      OR venta_id IN (SELECT id FROM public.ventas WHERE created_at >= v_corte)
      OR coworking_session_id IN (SELECT id FROM public.coworking_sessions WHERE created_at >= v_corte);

  -- 3. Borrar ventas
  DELETE FROM public.ventas WHERE created_at >= v_corte;

  -- 4. Borrar sesiones de coworking de prueba
  DELETE FROM public.coworking_sessions WHERE created_at >= v_corte;

  -- 5. Borrar membresías de prueba
  DELETE FROM public.coworking_membresias WHERE created_at >= v_corte;

  -- 6. Borrar órdenes POS pendientes de prueba
  DELETE FROM public.ordenes_pos_pendientes WHERE created_at >= v_corte;

  -- 7. Borrar clientes de prueba (después de membresías/sesiones)
  DELETE FROM public.clientes WHERE created_at >= v_corte;

  -- 8. Borrar la caja folio #68 (ya no tiene ventas ni movimientos)
  DELETE FROM public.cajas WHERE fecha_apertura >= v_corte;

  -- 9. Borrar audit_logs del rango
  DELETE FROM public.audit_logs WHERE created_at >= v_corte;
END $$;
