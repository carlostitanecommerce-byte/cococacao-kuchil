-- 1) RPC atómica para registrar mermas
CREATE OR REPLACE FUNCTION public.registrar_merma(
  p_insumo_id uuid,
  p_cantidad numeric,
  p_motivo text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_stock numeric;
  v_nombre text;
  v_unidad text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT stock_actual, nombre, unidad_medida
    INTO v_stock, v_nombre, v_unidad
  FROM public.insumos
  WHERE id = p_insumo_id
  FOR UPDATE;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'Insumo no encontrado';
  END IF;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente (disponible: % %)', v_stock, v_unidad;
  END IF;

  INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
  VALUES (p_insumo_id, p_cantidad, trim(p_motivo), v_user);

  UPDATE public.insumos
  SET stock_actual = stock_actual - p_cantidad
  WHERE id = p_insumo_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'registrar_merma',
    format('Merma de %s %s de "%s". Motivo: %s', p_cantidad, v_unidad, v_nombre, trim(p_motivo)),
    jsonb_build_object('insumo_id', p_insumo_id, 'cantidad', p_cantidad, 'motivo', trim(p_motivo), 'transaccional', true)
  );

  RETURN json_build_object('ok', true, 'stock_restante', v_stock - p_cantidad);
END;
$$;

-- 2) Endurecer RLS de compras_insumos: solo admin/supervisor pueden insertar
DROP POLICY IF EXISTS "Users can insert own compras" ON public.compras_insumos;
CREATE POLICY "Admin/Supervisor can insert compras"
ON public.compras_insumos
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = usuario_id
  AND (has_role(auth.uid(), 'administrador'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role))
);
