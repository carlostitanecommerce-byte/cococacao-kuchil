
CREATE OR REPLACE FUNCTION public.reabrir_sesion_coworking(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_estado coworking_estado;
  v_cliente text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF NOT (
    has_role(v_user, 'administrador'::app_role)
    OR has_role(v_user, 'supervisor'::app_role)
    OR has_role(v_user, 'caja'::app_role)
    OR has_role(v_user, 'recepcion'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes para reabrir sesión';
  END IF;

  SELECT estado, cliente_nombre INTO v_estado, v_cliente
  FROM public.coworking_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;

  IF v_estado <> 'pendiente_pago'::coworking_estado THEN
    RAISE EXCEPTION 'Solo sesiones en estado "pendiente de pago" pueden reabrirse (estado actual: %)', v_estado;
  END IF;

  UPDATE public.coworking_sessions
  SET estado = 'activo'::coworking_estado,
      fecha_salida_real = NULL,
      monto_acumulado = 0,
      updated_at = now()
  WHERE id = p_session_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'reabrir_sesion_coworking',
    'Sesión reabierta: ' || COALESCE(v_cliente, '—'),
    jsonb_build_object('session_id', p_session_id)
  );

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reabrir_sesion_coworking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reabrir_sesion_coworking(uuid) TO authenticated;
