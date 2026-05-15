
CREATE OR REPLACE FUNCTION public.cerrar_cuenta_coworking(
  p_venta jsonb,
  p_detalles_nuevos jsonb,
  p_detalles_open_ids uuid[],
  p_audit jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_venta_id uuid;
  v_folio integer;
  v_coworking_id uuid;
  v_estampadas integer := 0;
  v_session_nombre text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF (p_venta->>'usuario_id')::uuid IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'No puedes crear ventas a nombre de otro usuario' USING ERRCODE = '42501';
  END IF;

  v_coworking_id := NULLIF(p_venta->>'coworking_session_id','')::uuid;
  IF v_coworking_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_cuenta_coworking requiere coworking_session_id' USING ERRCODE = '22023';
  END IF;

  SELECT cliente_nombre INTO v_session_nombre
    FROM coworking_sessions WHERE id = v_coworking_id;
  IF v_session_nombre IS NULL THEN
    RAISE EXCEPTION 'Sesión de coworking no encontrada' USING ERRCODE = 'P0002';
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
    v_coworking_id,
    NULLIF(p_venta->>'caja_id','')::uuid
  )
  RETURNING id, folio INTO v_venta_id, v_folio;

  -- 2. Insertar nuevas líneas (tiempo coworking, excedente, etc.)
  --    El trigger descontar_inventario_venta corre en INSERT pero ignora tipo_concepto='coworking'.
  IF p_detalles_nuevos IS NOT NULL AND jsonb_array_length(p_detalles_nuevos) > 0 THEN
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
    FROM jsonb_array_elements(p_detalles_nuevos) AS d;
  END IF;

  -- 3. Estampar venta_id en líneas abiertas (NO re-descuenta inventario: el trigger es AFTER INSERT)
  IF p_detalles_open_ids IS NOT NULL AND array_length(p_detalles_open_ids, 1) > 0 THEN
    UPDATE public.detalle_ventas
       SET venta_id = v_venta_id
     WHERE id = ANY(p_detalles_open_ids)
       AND venta_id IS NULL
       AND coworking_session_id = v_coworking_id;
    GET DIAGNOSTICS v_estampadas = ROW_COUNT;

    IF v_estampadas <> array_length(p_detalles_open_ids, 1) THEN
      RAISE EXCEPTION 'Algunas líneas abiertas (%/%) no pudieron estamparse a la venta. La cuenta cambió mientras se cobraba.',
        v_estampadas, array_length(p_detalles_open_ids, 1)
        USING ERRCODE = '40001';
    END IF;
  END IF;

  -- 4. Finalizar sesión coworking
  UPDATE public.coworking_sessions
     SET estado = 'finalizado'::coworking_estado,
         fecha_salida_real = COALESCE(fecha_salida_real, now()),
         monto_acumulado = (p_venta->>'total_bruto')::numeric,
         updated_at = now()
   WHERE id = v_coworking_id;

  -- 5. Bitácora
  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    COALESCE(p_audit->>'accion', 'cierre_cuenta_coworking'),
    COALESCE(p_audit->>'descripcion',
      format('Cierre de cuenta coworking %s - $%s', v_session_nombre, p_venta->>'total_bruto')),
    COALESCE(p_audit->'metadata', '{}'::jsonb) || jsonb_build_object(
      'venta_id', v_venta_id,
      'folio', v_folio,
      'coworking_session_id', v_coworking_id,
      'lineas_nuevas', COALESCE(jsonb_array_length(p_detalles_nuevos), 0),
      'lineas_estampadas', v_estampadas,
      'transaccional', true
    )
  );

  RETURN json_build_object('id', v_venta_id, 'folio', v_folio, 'estampadas', v_estampadas);
END;
$function$;
