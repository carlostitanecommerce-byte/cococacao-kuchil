-- 1. Añadir columna tipo a compras_insumos
ALTER TABLE public.compras_insumos
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'compra';

-- 2. Reemplazar aplicar_auditoria_inventario para registrar ajustes positivos
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

    IF v_diferencia = 0 THEN
      CONTINUE;
    END IF;

    IF v_diferencia < 0 THEN
      -- Diferencia negativa → merma automática (resta stock por trigger interno? no, mermas no resta; aquí se ajusta abajo)
      INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
      VALUES (v_insumo_id, abs(v_diferencia), 'Ajuste por auditoría física', v_user);

      -- Aplicar el ajuste real al stock (la merma es solo registro)
      UPDATE public.insumos
      SET stock_actual = v_fisico
      WHERE id = v_insumo_id;
    ELSE
      -- Diferencia positiva → entrada por ajuste en compras_insumos (sin costo)
      -- El trigger trg_sumar_stock_compra sumará automáticamente v_diferencia al stock
      INSERT INTO public.compras_insumos (
        insumo_id,
        cantidad_presentaciones,
        cantidad_unidades,
        costo_presentacion,
        costo_total,
        nota,
        usuario_id,
        tipo
      ) VALUES (
        v_insumo_id,
        0,
        v_diferencia,
        0,
        0,
        format('Entrada por ajuste de auditoría física (stock %s → %s)', v_anterior, v_fisico),
        v_user,
        'ajuste_positivo'
      );
    END IF;

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
        'tipo_ajuste', CASE WHEN v_diferencia > 0 THEN 'entrada_positiva' ELSE 'merma' END
      )
    );

    v_aplicados := v_aplicados + 1;
  END LOOP;

  RETURN json_build_object('aplicados', v_aplicados);
END;
$$;