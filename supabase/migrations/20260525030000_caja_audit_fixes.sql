-- 1. Agregar el valor 'cancelada' al enum kds_estado si no existe
ALTER TYPE public.kds_estado ADD VALUE IF NOT EXISTS 'cancelada';

-- 2. Permitir que los administradores actualicen cualquier detalle_ventas (para desasociar consumos al cancelar)
DROP POLICY IF EXISTS "Admins can update all detalle_ventas" ON public.detalle_ventas;
CREATE POLICY "Admins can update all detalle_ventas"
  ON public.detalle_ventas FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'))
  WITH CHECK (public.has_role(auth.uid(), 'administrador'));

-- 3. Modificar la función trigger recalc_comisiones_bancarias para que sea dinámica
CREATE OR REPLACE FUNCTION public.recalc_comisiones_bancarias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_tarjeta numeric;
  propina_en_tarjeta numeric;
  v_comision_pct numeric;
BEGIN
  -- Obtener el porcentaje de comisión configurado en la base de datos (con fallback de 3.5%)
  SELECT COALESCE(valor, 3.5) INTO v_comision_pct
    FROM public.configuracion_ventas WHERE clave = 'comision_bancaria_porcentaje';

  IF NEW.metodo_pago IN ('tarjeta', 'mixto') THEN
    propina_en_tarjeta := LEAST(COALESCE(NEW.monto_propina, 0), COALESCE(NEW.monto_tarjeta, 0));
  ELSE
    propina_en_tarjeta := 0;
  END IF;

  base_tarjeta := GREATEST(0, COALESCE(NEW.monto_tarjeta, 0) - propina_en_tarjeta);
  NEW.comisiones_bancarias := ROUND(base_tarjeta * (v_comision_pct / 100.0), 2);
  RETURN NEW;
END;
$$;

-- 4. Modificar políticas RLS de solicitudes_cancelacion para incluir al rol supervisor
DROP POLICY IF EXISTS "Admins can view all solicitudes" ON public.solicitudes_cancelacion;
CREATE POLICY "Admins and supervisors can view all solicitudes"
  ON public.solicitudes_cancelacion FOR SELECT
  USING (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'supervisor'));

DROP POLICY IF EXISTS "Admins can update solicitudes" ON public.solicitudes_cancelacion;
CREATE POLICY "Admins and supervisors can update solicitudes"
  ON public.solicitudes_cancelacion FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrador') OR public.has_role(auth.uid(), 'supervisor'));
