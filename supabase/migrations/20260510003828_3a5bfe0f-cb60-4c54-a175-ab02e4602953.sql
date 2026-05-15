CREATE OR REPLACE FUNCTION public.unfreeze_checkout_coworking(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE coworking_sessions
  SET fecha_salida_real = NULL,
      updated_at = now()
  WHERE id = p_session_id
    AND estado = 'activo'
    AND fecha_salida_real IS NOT NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unfreeze_checkout_coworking(uuid) TO authenticated;

-- One-shot fix: liberar sesiones activas que quedaron congeladas
UPDATE public.coworking_sessions
SET fecha_salida_real = NULL, updated_at = now()
WHERE estado = 'activo' AND fecha_salida_real IS NOT NULL;