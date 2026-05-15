-- M6: Anular compra de insumo (revierte stock y elimina la compra)
CREATE OR REPLACE FUNCTION public.anular_compra_insumo(p_compra_id uuid, p_motivo text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_compra RECORD;
  v_stock_actual numeric;
  v_nombre_insumo text;
  v_unidad text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_user, 'administrador'::app_role) THEN
    RAISE EXCEPTION 'Solo administradores pueden anular compras' USING ERRCODE = '42501';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo de anulación es obligatorio';
  END IF;

  SELECT * INTO v_compra FROM public.compras_insumos WHERE id = p_compra_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra no encontrada';
  END IF;

  SELECT stock_actual, nombre, unidad_medida
    INTO v_stock_actual, v_nombre_insumo, v_unidad
  FROM public.insumos
  WHERE id = v_compra.insumo_id
  FOR UPDATE;

  IF v_stock_actual IS NULL THEN
    RAISE EXCEPTION 'Insumo asociado no existe';
  END IF;

  IF v_stock_actual < v_compra.cantidad_unidades THEN
    RAISE EXCEPTION 'No se puede anular: el insumo "%" tiene stock actual (% %) menor al que aportó la compra (% %). Ya fue consumido parcialmente.',
      v_nombre_insumo, v_stock_actual, v_unidad, v_compra.cantidad_unidades, v_unidad;
  END IF;

  UPDATE public.insumos
  SET stock_actual = stock_actual - v_compra.cantidad_unidades
  WHERE id = v_compra.insumo_id;

  DELETE FROM public.compras_insumos WHERE id = p_compra_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'anular_compra_insumo',
    format('Compra anulada: %s — se descontaron %s %s. Motivo: %s',
           v_nombre_insumo, v_compra.cantidad_unidades, v_unidad, trim(p_motivo)),
    jsonb_build_object(
      'compra_id', p_compra_id,
      'insumo_id', v_compra.insumo_id,
      'insumo_nombre', v_nombre_insumo,
      'cantidad_unidades_revertidas', v_compra.cantidad_unidades,
      'cantidad_presentaciones', v_compra.cantidad_presentaciones,
      'costo_total', v_compra.costo_total,
      'fecha_compra_original', v_compra.fecha,
      'motivo', trim(p_motivo),
      'transaccional', true
    )
  );

  RETURN json_build_object('ok', true, 'stock_resultante', v_stock_actual - v_compra.cantidad_unidades);
END;
$$;

-- M7: Recalcular costo y margen de un producto puntual desde el servidor
CREATE OR REPLACE FUNCTION public.recalcular_costo_producto(p_producto_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_costo_total numeric;
  v_precio numeric;
  v_margen numeric;
BEGIN
  SELECT precio_venta INTO v_precio FROM public.productos WHERE id = p_producto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  SELECT COALESCE(SUM(r.cantidad_necesaria * i.costo_unitario), 0)
  INTO v_costo_total
  FROM public.recetas r
  JOIN public.insumos i ON i.id = r.insumo_id
  WHERE r.producto_id = p_producto_id;

  IF v_precio > 0 THEN
    v_margen := ((v_precio - v_costo_total) / v_precio) * 100;
  ELSE
    v_margen := 0;
  END IF;

  UPDATE public.productos
  SET costo_total = v_costo_total,
      margen = v_margen,
      updated_at = now()
  WHERE id = p_producto_id;

  RETURN json_build_object('ok', true, 'costo_total', v_costo_total, 'margen', v_margen);
END;
$$;