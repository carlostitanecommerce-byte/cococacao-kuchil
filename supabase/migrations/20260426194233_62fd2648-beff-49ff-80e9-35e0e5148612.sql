-- 1. Cleanup upsells/amenities cuando una sesión se cancela
CREATE OR REPLACE FUNCTION public.cleanup_session_upsells_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.estado = 'cancelado' AND (OLD.estado IS DISTINCT FROM 'cancelado') THEN
    DELETE FROM public.coworking_session_upsells WHERE session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_session_upsells_on_cancel ON public.coworking_sessions;
CREATE TRIGGER trg_cleanup_session_upsells_on_cancel
AFTER UPDATE ON public.coworking_sessions
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_session_upsells_on_cancel();

-- 2. Validación atómica de capacidad al insertar una sesión
CREATE OR REPLACE FUNCTION public.validar_capacidad_sesion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_area RECORD;
  v_ocupacion_actual integer;
BEGIN
  SELECT id, nombre_area, capacidad_pax, es_privado
  INTO v_area
  FROM public.areas_coworking
  WHERE id = NEW.area_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Área de coworking no existe';
  END IF;

  IF v_area.es_privado THEN
    -- Privada: no puede haber otra sesión activa
    IF EXISTS (
      SELECT 1 FROM public.coworking_sessions
      WHERE area_id = NEW.area_id
        AND estado = 'activo'
        AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Área privada "%" ya tiene una sesión activa', v_area.nombre_area;
    END IF;
    IF NEW.pax_count > v_area.capacidad_pax THEN
      RAISE EXCEPTION 'Pax (%) excede la capacidad del área privada "%" (%)',
        NEW.pax_count, v_area.nombre_area, v_area.capacidad_pax;
    END IF;
  ELSE
    -- Pública: suma de pax activos no debe exceder capacidad
    SELECT COALESCE(SUM(pax_count), 0)
    INTO v_ocupacion_actual
    FROM public.coworking_sessions
    WHERE area_id = NEW.area_id
      AND estado = 'activo'
      AND id <> NEW.id;

    IF v_ocupacion_actual + NEW.pax_count > v_area.capacidad_pax THEN
      RAISE EXCEPTION 'Capacidad excedida en "%": ocupación actual % + % nuevos > capacidad %',
        v_area.nombre_area, v_ocupacion_actual, NEW.pax_count, v_area.capacidad_pax;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_capacidad_sesion_insert ON public.coworking_sessions;
CREATE TRIGGER trg_validar_capacidad_sesion_insert
BEFORE INSERT ON public.coworking_sessions
FOR EACH ROW
WHEN (NEW.estado = 'activo')
EXECUTE FUNCTION public.validar_capacidad_sesion();

DROP TRIGGER IF EXISTS trg_validar_capacidad_sesion_update ON public.coworking_sessions;
CREATE TRIGGER trg_validar_capacidad_sesion_update
BEFORE UPDATE OF pax_count, area_id, estado ON public.coworking_sessions
FOR EACH ROW
WHEN (NEW.estado = 'activo')
EXECUTE FUNCTION public.validar_capacidad_sesion();