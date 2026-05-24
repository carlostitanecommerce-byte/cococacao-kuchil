
-- ============================================================================
-- Endurecimiento de mutaciones sensibles en public.insumos
--
-- 1) Trigger BEFORE UPDATE que:
--    a) Recalcula costo_unitario automáticamente desde costo_presentacion /
--       cantidad_por_presentacion (evita que el cliente lo escriba a mano).
--    b) Bloquea cambios directos a stock_actual cuando provienen de roles
--       expuestos vía PostgREST (`authenticated`, `anon`). Las funciones
--       SECURITY DEFINER existentes siguen funcionando porque su
--       `current_user` se promueve al owner (postgres) al ejecutarse.
-- 2) Trigger AFTER UPDATE que escribe audit_logs cuando cambia costo_unitario
--    o se ajusta stock_actual desde una RPC (registra el delta).
-- 3) RPC pública `ajustar_stock_insumo(_insumo_id, _nuevo_stock, _motivo)` —
--    única vía válida para que un administrador ajuste stock manualmente.
--    Atómica: lee FOR UPDATE, valida, actualiza, audita.
-- ============================================================================

-- 1) Trigger BEFORE UPDATE: auto-cálculo costo y guardia stock
CREATE OR REPLACE FUNCTION public.guard_insumos_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- (a) costo_unitario es derivado: ignorar lo que mande el cliente
  NEW.costo_unitario := CASE
    WHEN COALESCE(NEW.cantidad_por_presentacion, 0) > 0
      THEN ROUND((NEW.costo_presentacion / NEW.cantidad_por_presentacion)::numeric, 6)
    ELSE 0
  END;

  -- (b) Bloquear cambios a stock_actual desde el cliente PostgREST
  IF NEW.stock_actual IS DISTINCT FROM OLD.stock_actual THEN
    IF current_user IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION
        'stock_actual no puede modificarse directamente. Usa la función ajustar_stock_insumo, una compra, una merma o el flujo de ventas.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_insumos_sensitive_fields ON public.insumos;
CREATE TRIGGER trg_guard_insumos_sensitive_fields
  BEFORE UPDATE ON public.insumos
  FOR EACH ROW EXECUTE FUNCTION public.guard_insumos_sensitive_fields();


-- 2) Trigger AFTER UPDATE: audita cambios de costo
CREATE OR REPLACE FUNCTION public.audit_insumos_costo_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF NEW.costo_unitario IS DISTINCT FROM OLD.costo_unitario THEN
    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (
      v_uid,
      'cambio_costo_insumo',
      format('Costo unitario actualizado: %s de $%s a $%s/%s',
             NEW.nombre, OLD.costo_unitario, NEW.costo_unitario, NEW.unidad_medida),
      jsonb_build_object(
        'insumo_id', NEW.id,
        'insumo_nombre', NEW.nombre,
        'costo_anterior', OLD.costo_unitario,
        'costo_nuevo', NEW.costo_unitario,
        'transaccional', true
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_insumos_costo_change ON public.insumos;
CREATE TRIGGER trg_audit_insumos_costo_change
  AFTER UPDATE OF costo_presentacion, cantidad_por_presentacion ON public.insumos
  FOR EACH ROW EXECUTE FUNCTION public.audit_insumos_costo_change();


-- 3) RPC para ajuste manual de stock con motivo obligatorio
CREATE OR REPLACE FUNCTION public.ajustar_stock_insumo(
  _insumo_id uuid,
  _nuevo_stock numeric,
  _motivo text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev numeric;
  v_nombre text;
  v_unidad text;
  v_delta numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'administrador') THEN
    RAISE EXCEPTION 'Solo administradores pueden ajustar stock manualmente'
      USING ERRCODE = '42501';
  END IF;
  IF _nuevo_stock IS NULL OR _nuevo_stock < 0 THEN
    RAISE EXCEPTION 'El stock debe ser un número mayor o igual a cero'
      USING ERRCODE = '22023';
  END IF;
  IF _motivo IS NULL OR length(btrim(_motivo)) < 3 THEN
    RAISE EXCEPTION 'Debes capturar un motivo (mínimo 3 caracteres)'
      USING ERRCODE = '22023';
  END IF;

  SELECT stock_actual, nombre, unidad_medida
    INTO v_prev, v_nombre, v_unidad
    FROM public.insumos
    WHERE id = _insumo_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insumo no encontrado' USING ERRCODE = 'P0002';
  END IF;

  v_delta := _nuevo_stock - v_prev;

  IF v_delta = 0 THEN
    RETURN json_build_object('ok', true, 'sin_cambio', true);
  END IF;

  UPDATE public.insumos
    SET stock_actual = _nuevo_stock,
        updated_at = now()
    WHERE id = _insumo_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_uid,
    'ajuste_manual_stock_insumo',
    format('Ajuste manual de stock: %s de %s a %s %s (%s%s) — Motivo: %s',
           v_nombre, v_prev, _nuevo_stock, v_unidad,
           CASE WHEN v_delta > 0 THEN '+' ELSE '' END, v_delta,
           btrim(_motivo)),
    jsonb_build_object(
      'insumo_id', _insumo_id,
      'insumo_nombre', v_nombre,
      'stock_anterior', v_prev,
      'stock_nuevo', _nuevo_stock,
      'diferencia', v_delta,
      'unidad', v_unidad,
      'motivo', btrim(_motivo),
      'transaccional', true
    )
  );

  RETURN json_build_object(
    'ok', true,
    'insumo_id', _insumo_id,
    'stock_anterior', v_prev,
    'stock_nuevo', _nuevo_stock,
    'diferencia', v_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajustar_stock_insumo(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajustar_stock_insumo(uuid, numeric, text) TO authenticated;
