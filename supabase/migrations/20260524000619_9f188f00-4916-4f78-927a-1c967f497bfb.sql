-- Fix 1: cajas RLS
DROP POLICY IF EXISTS "Authenticated users can update open caja" ON public.cajas;
CREATE POLICY "Operadores pueden actualizar caja abierta"
  ON public.cajas FOR UPDATE
  TO authenticated
  USING (
    estado = 'abierta'::caja_estado
    AND (
      has_role(auth.uid(), 'administrador'::app_role)
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'caja'::app_role)
      OR has_role(auth.uid(), 'recepcion'::app_role)
    )
  );

DROP POLICY IF EXISTS "Users can insert own cajas" ON public.cajas;
CREATE POLICY "Operadores pueden abrir caja"
  ON public.cajas FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = usuario_id
    AND (
      has_role(auth.uid(), 'administrador'::app_role)
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'caja'::app_role)
      OR has_role(auth.uid(), 'recepcion'::app_role)
    )
  );

-- Fix 2: movimientos_caja RLS
DROP POLICY IF EXISTS "Authenticated users can insert movimientos" ON public.movimientos_caja;
CREATE POLICY "Operadores pueden registrar movimientos"
  ON public.movimientos_caja FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = usuario_id
    AND (
      has_role(auth.uid(), 'administrador'::app_role)
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'caja'::app_role)
      OR has_role(auth.uid(), 'recepcion'::app_role)
    )
    AND EXISTS (
      SELECT 1 FROM public.cajas
      WHERE id = movimientos_caja.caja_id
        AND estado = 'abierta'::caja_estado
    )
  );

-- Fix 3: RPC cerrar_caja (cálculo en servidor + lock)
CREATE OR REPLACE FUNCTION public.cerrar_caja(
  p_caja_id uuid,
  p_monto_cierre numeric,
  p_notas_cierre text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_caja RECORD;
  v_ventas_efectivo numeric;
  v_entradas numeric;
  v_salidas numeric;
  v_esperado numeric;
  v_diferencia numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    has_role(v_user, 'administrador'::app_role) OR
    has_role(v_user, 'supervisor'::app_role) OR
    has_role(v_user, 'caja'::app_role) OR
    has_role(v_user, 'recepcion'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caja FROM public.cajas
  WHERE id = p_caja_id AND estado = 'abierta'::caja_estado
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada o ya cerrada';
  END IF;

  SELECT COALESCE(SUM(monto_efectivo), 0) INTO v_ventas_efectivo
  FROM public.ventas
  WHERE estado = 'completada'::venta_estado
    AND (
      caja_id = p_caja_id
      OR (caja_id IS NULL AND fecha >= v_caja.fecha_apertura)
    );

  SELECT
    COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN monto ELSE 0 END), 0)
  INTO v_entradas, v_salidas
  FROM public.movimientos_caja
  WHERE caja_id = p_caja_id;

  v_esperado   := v_caja.monto_apertura + v_ventas_efectivo + v_entradas - v_salidas;
  v_diferencia := p_monto_cierre - v_esperado;

  UPDATE public.cajas SET
    estado       = 'cerrada'::caja_estado,
    monto_cierre = p_monto_cierre,
    fecha_cierre = now(),
    diferencia   = v_diferencia,
    notas_cierre = p_notas_cierre
  WHERE id = p_caja_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'cierre_caja',
    format('Cierre de caja. Esperado: $%s, Contado: $%s, Diferencia: $%s',
      v_esperado::text, p_monto_cierre::text, v_diferencia::text),
    jsonb_build_object(
      'caja_id', p_caja_id,
      'monto_cierre', p_monto_cierre,
      'esperado', v_esperado,
      'diferencia', v_diferencia,
      'notas_cierre', p_notas_cierre
    )
  );

  RETURN json_build_object(
    'ok', true,
    'esperado', v_esperado,
    'diferencia', v_diferencia
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_caja(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cerrar_caja(uuid, numeric, text) TO authenticated;