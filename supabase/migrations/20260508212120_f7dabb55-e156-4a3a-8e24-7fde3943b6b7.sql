CREATE OR REPLACE FUNCTION public.crear_venta_completa(
  p_venta jsonb,
  p_detalles jsonb,
  p_audit jsonb DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_venta_id uuid;
  v_folio integer;
  v_coworking_id uuid;
  v_cw_total numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF (p_venta->>'usuario_id')::uuid IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'No puedes crear ventas a nombre de otro usuario' USING ERRCODE = '42501';
  END IF;

  -- 1. Crear venta
  INSERT INTO public.ventas (
    usuario_id, total_bruto, iva, comisiones_bancarias, monto_propina,
    total_neto, metodo_pago, tipo_consumo, estado, fecha,
    monto_efectivo, monto_tarjeta, monto_transferencia,
    coworking_session_id, caja_id
  )
  VALUES (
    v_user,
    (p_venta->>'total_bruto')::numeric,
    (p_venta->>'iva')::numeric,
    COALESCE((p_venta->>'comisiones_bancarias')::numeric, 0),
    COALESCE((p_venta->>'monto_propina')::numeric, 0),
    (p_venta->>'total_neto')::numeric,
    (p_venta->>'metodo_pago')::metodo_pago,
    (p_venta->>'tipo_consumo')::tipo_consumo,
    'completada'::venta_estado,
    COALESCE((p_venta->>'fecha')::timestamptz, now()),
    COALESCE((p_venta->>'monto_efectivo')::numeric, 0),
    COALESCE((p_venta->>'monto_tarjeta')::numeric, 0),
    COALESCE((p_venta->>'monto_transferencia')::numeric, 0),
    NULLIF(p_venta->>'coworking_session_id','')::uuid,
    NULLIF(p_venta->>'caja_id','')::uuid
  )
  RETURNING id, folio INTO v_venta_id, v_folio;

  -- 2. Insertar detalle_ventas (los triggers de inventario validan stock; si falla, todo se revierte)
  INSERT INTO public.detalle_ventas (
    venta_id, producto_id, cantidad, precio_unitario, subtotal,
    tipo_concepto, coworking_session_id, descripcion, paquete_id, paquete_nombre
  )
  SELECT
    v_venta_id,
    NULLIF(d->>'producto_id','')::uuid,
    (d->>'cantidad')::integer,
    (d->>'precio_unitario')::numeric,
    (d->>'subtotal')::numeric,
    (d->>'tipo_concepto')::tipo_concepto,
    NULLIF(d->>'coworking_session_id','')::uuid,
    d->>'descripcion',
    NULLIF(d->>'paquete_id','')::uuid,
    d->>'paquete_nombre'
  FROM jsonb_array_elements(p_detalles) AS d;

  -- 3. Finalizar sesión coworking si aplica
  v_coworking_id := NULLIF(p_venta->>'coworking_session_id','')::uuid;
  IF v_coworking_id IS NOT NULL THEN
    SELECT COALESCE(SUM((d->>'subtotal')::numeric), 0)
      INTO v_cw_total
      FROM jsonb_array_elements(p_detalles) AS d
      WHERE d->>'tipo_concepto' = 'coworking';

    UPDATE public.coworking_sessions
       SET estado = 'finalizado'::coworking_estado,
           fecha_salida_real = now(),
           monto_acumulado = v_cw_total,
           updated_at = now()
     WHERE id = v_coworking_id;
  END IF;

  -- 4. Bitácora
  IF p_audit IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (
      v_user,
      COALESCE(p_audit->>'accion', 'venta_completada'),
      p_audit->>'descripcion',
      COALESCE(p_audit->'metadata', '{}'::jsonb)
        || jsonb_build_object('venta_id', v_venta_id, 'folio', v_folio, 'transaccional', true)
    );
  END IF;

  RETURN json_build_object('id', v_venta_id, 'folio', v_folio);
END;
$$;