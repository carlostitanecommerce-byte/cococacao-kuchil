CREATE OR REPLACE FUNCTION public.sanear_tarifa_snapshot_sesion(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session RECORD;
  v_tarifa RECORD;
  v_area RECORD;
  v_snapshot jsonb;
  v_origen text;
  v_nombre text;
  v_precio numeric;
  v_metodo text;
  v_tolerancia integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (has_role(v_user,'administrador'::app_role) OR has_role(v_user,'supervisor'::app_role)
          OR has_role(v_user,'caja'::app_role) OR has_role(v_user,'recepcion'::app_role)) THEN
    RAISE EXCEPTION 'Permisos insuficientes para sanear tarifa' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session FROM public.coworking_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada'; END IF;

  -- Idempotencia: si ya tiene snapshot, devolver el existente sin tocar nada.
  IF v_session.tarifa_snapshot IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'ya_tenia', true, 'snapshot', v_session.tarifa_snapshot);
  END IF;

  -- Solo estados operables.
  IF v_session.estado NOT IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado) THEN
    RAISE EXCEPTION 'La sesión no admite saneo (estado: %)', v_session.estado;
  END IF;

  -- Ruta 1: tarifa_id presente → reconstruir desde tarifas_coworking.
  IF v_session.tarifa_id IS NOT NULL THEN
    SELECT * INTO v_tarifa FROM public.tarifas_coworking WHERE id = v_session.tarifa_id;
    IF FOUND THEN
      v_origen := 'tarifa_id';
      v_nombre := v_tarifa.nombre;
      v_precio := v_tarifa.precio_base;
      v_metodo := COALESCE(v_tarifa.metodo_fraccion, '15_min');
      v_tolerancia := COALESCE(v_tarifa.minutos_tolerancia, 0);
      v_snapshot := jsonb_build_object(
        'nombre', v_nombre,
        'precio_base', v_precio,
        'tipo_cobro', v_tarifa.tipo_cobro::text,
        'metodo_fraccion', v_metodo,
        'minutos_tolerancia', v_tolerancia,
        'amenities', '[]'::jsonb,
        'upsells_disponibles', '[]'::jsonb,
        'reconstruido', true,
        'origen', v_origen,
        'snapshot_at', now()
      );
    END IF;
  END IF;

  -- Ruta 2: fallback por precio de área (tarifa_id null o tarifa borrada).
  IF v_snapshot IS NULL THEN
    SELECT * INTO v_area FROM public.areas_coworking WHERE id = v_session.area_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Área de la sesión no encontrada'; END IF;
    v_origen := 'area_fallback';
    v_snapshot := jsonb_build_object(
      'nombre', 'Tarifa por hora (' || v_area.nombre_area || ')',
      'precio_base', v_area.precio_por_hora,
      'tipo_cobro', 'hora',
      'metodo_fraccion', '15_min',
      'minutos_tolerancia', 0,
      'amenities', '[]'::jsonb,
      'upsells_disponibles', '[]'::jsonb,
      'reconstruido', true,
      'origen', v_origen,
      'snapshot_at', now()
    );
  END IF;

  UPDATE public.coworking_sessions
     SET tarifa_snapshot = v_snapshot, updated_at = now()
   WHERE id = p_session_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (v_user, 'sanear_tarifa_snapshot',
    format('Tarifa reconstruida (%s) para sesión %s — precio_base $%s',
           v_origen, v_session.cliente_nombre, (v_snapshot->>'precio_base')),
    jsonb_build_object('session_id', p_session_id, 'origen', v_origen,
      'snapshot', v_snapshot, 'transaccional', true));

  RETURN json_build_object('ok', true, 'ya_tenia', false, 'origen', v_origen, 'snapshot', v_snapshot);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sanear_tarifa_snapshot_sesion(uuid) TO authenticated;
