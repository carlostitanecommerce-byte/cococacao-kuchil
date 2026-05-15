CREATE OR REPLACE FUNCTION public.aplicar_auditoria_inventario(p_ajustes jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_item jsonb;
  v_insumo_id uuid;
  v_fisico numeric;
  v_anterior numeric;
  v_diferencia numeric;
  v_nombre text;
  v_unidad text;
  v_aplicados integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_role(v_user, 'administrador'::app_role)
    OR has_role(v_user, 'supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes para aplicar auditoría' USING ERRCODE = '42501';
  END IF;

  IF p_ajustes IS NULL OR jsonb_typeof(p_ajustes) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: se esperaba un arreglo de ajustes';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_ajustes)
  LOOP
    v_insumo_id := (v_item->>'insumo_id')::uuid;
    v_fisico := (v_item->>'stock_fisico')::numeric;

    IF v_insumo_id IS NULL OR v_fisico IS NULL OR v_fisico < 0 THEN
      RAISE EXCEPTION 'Ajuste inválido: %', v_item;
    END IF;

    SELECT stock_actual, nombre, unidad_medida
      INTO v_anterior, v_nombre, v_unidad
      FROM public.insumos
      WHERE id = v_insumo_id
      FOR UPDATE;

    IF v_anterior IS NULL THEN
      RAISE EXCEPTION 'Insumo % no encontrado', v_insumo_id;
    END IF;

    v_diferencia := v_fisico - v_anterior;

    -- Sin cambio: saltar
    IF v_diferencia = 0 THEN
      CONTINUE;
    END IF;

    -- Diferencia negativa → merma automática
    IF v_diferencia < 0 THEN
      INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
      VALUES (v_insumo_id, abs(v_diferencia), 'Ajuste por auditoría física', v_user);
    END IF;

    -- Bitácora del ajuste
    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (
      v_user,
      'ajuste_inventario',
      format('Auditoría física: %s de %s a %s (dif: %s%s) %s',
             v_nombre,
             v_anterior,
             v_fisico,
             CASE WHEN v_diferencia > 0 THEN '+' ELSE '' END,
             round(v_diferencia::numeric, 2),
             COALESCE(v_unidad, '')),
      jsonb_build_object(
        'insumo_id', v_insumo_id,
        'stock_anterior', v_anterior,
        'stock_nuevo', v_fisico,
        'diferencia_stock', v_diferencia,
        'transaccional', true
      )
    );

    -- Actualizar stock real
    UPDATE public.insumos
       SET stock_actual = v_fisico
     WHERE id = v_insumo_id;

    v_aplicados := v_aplicados + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'aplicados', v_aplicados);
END;
$$;