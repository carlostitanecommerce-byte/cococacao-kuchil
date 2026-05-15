CREATE OR REPLACE FUNCTION public.actualizar_estado_kds_orden(
  p_order_id uuid,
  p_nuevo_estado kds_estado
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_estado_anterior kds_estado;
  v_folio integer;
  v_created_at timestamptz;
  v_duracion_min numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    public.has_role(v_user, 'administrador'::app_role)
    OR public.has_role(v_user, 'supervisor'::app_role)
    OR public.has_role(v_user, 'barista'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes para actualizar orden de cocina' USING ERRCODE = '42501';
  END IF;

  IF p_nuevo_estado NOT IN ('pendiente'::kds_estado, 'en_preparacion'::kds_estado, 'listo'::kds_estado) THEN
    RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
  END IF;

  SELECT estado, folio, created_at
    INTO v_estado_anterior, v_folio, v_created_at
  FROM public.kds_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de cocina no encontrada';
  END IF;

  IF v_estado_anterior = p_nuevo_estado THEN
    RETURN json_build_object('ok', true, 'sin_cambio', true);
  END IF;

  UPDATE public.kds_orders
     SET estado = p_nuevo_estado,
         updated_at = now()
   WHERE id = p_order_id;

  v_duracion_min := EXTRACT(EPOCH FROM (now() - v_created_at)) / 60.0;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'kds_orden_estado',
    format('KDS #%s: %s → %s', LPAD(v_folio::text, 4, '0'), v_estado_anterior, p_nuevo_estado),
    jsonb_build_object(
      'order_id', p_order_id,
      'folio', v_folio,
      'estado_anterior', v_estado_anterior,
      'estado_nuevo', p_nuevo_estado,
      'duracion_min', round(v_duracion_min::numeric, 2),
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'estado_anterior', v_estado_anterior,
    'estado_nuevo', p_nuevo_estado,
    'duracion_min', round(v_duracion_min::numeric, 2)
  );
END;
$$;