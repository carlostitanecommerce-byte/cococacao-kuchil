CREATE OR REPLACE FUNCTION public.descontar_horas_membresia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo_cobro text;
  v_horas_consumidas numeric;
  v_saldo_anterior numeric;
  v_saldo_nuevo numeric;
BEGIN
  IF NEW.membresia_id IS NULL OR NEW.fecha_salida_real IS NULL OR NEW.fecha_inicio IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.tipo_cobro, m.horas_disponibles
    INTO v_tipo_cobro, v_saldo_anterior
  FROM public.coworking_membresias m
  JOIN public.tarifas_coworking t ON t.id = m.tarifa_id
  WHERE m.id = NEW.membresia_id
  FOR UPDATE OF m;

  IF v_tipo_cobro IS DISTINCT FROM 'paquete_horas' THEN
    RETURN NEW;
  END IF;

  v_horas_consumidas := EXTRACT(EPOCH FROM (NEW.fecha_salida_real - NEW.fecha_inicio)) / 3600.0;
  IF v_horas_consumidas IS NULL OR v_horas_consumidas <= 0 THEN
    RETURN NEW;
  END IF;

  v_saldo_nuevo := GREATEST(0, COALESCE(v_saldo_anterior, 0) - v_horas_consumidas);

  UPDATE public.coworking_membresias
     SET horas_disponibles = v_saldo_nuevo,
         updated_at = now()
   WHERE id = NEW.membresia_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    COALESCE(auth.uid(), NEW.usuario_id),
    'descontar_horas_membresia',
    format('Descuento automático: %s hrs consumidas (saldo %s → %s)',
           round(v_horas_consumidas::numeric, 2),
           round(COALESCE(v_saldo_anterior, 0)::numeric, 2),
           round(v_saldo_nuevo::numeric, 2)),
    jsonb_build_object(
      'session_id', NEW.id,
      'membresia_id', NEW.membresia_id,
      'horas_consumidas', v_horas_consumidas,
      'saldo_anterior', v_saldo_anterior,
      'saldo_nuevo', v_saldo_nuevo,
      'transaccional', true
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_descontar_horas_membresia ON public.coworking_sessions;

CREATE TRIGGER trg_descontar_horas_membresia
AFTER UPDATE OF estado ON public.coworking_sessions
FOR EACH ROW
WHEN (NEW.estado = 'finalizado'::coworking_estado AND OLD.estado IS DISTINCT FROM 'finalizado'::coworking_estado)
EXECUTE FUNCTION public.descontar_horas_membresia();