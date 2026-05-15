CREATE OR REPLACE FUNCTION public.freeze_checkout_coworking(p_session_id uuid)
RETURNS TABLE(id uuid, fecha_salida_real timestamp with time zone, was_frozen_now boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := (now() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City';
  v_existing timestamptz;
BEGIN
  SELECT s.fecha_salida_real INTO v_existing
  FROM public.coworking_sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT p_session_id, v_existing, false;
    RETURN;
  END IF;

  UPDATE public.coworking_sessions AS s
  SET fecha_salida_real = v_now
  WHERE s.id = p_session_id
    AND s.fecha_salida_real IS NULL;

  RETURN QUERY SELECT p_session_id, v_now, true;
END;
$function$;