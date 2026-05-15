
-- =====================================================================
-- 1. Columnas de cancelación en kds_order_items
-- =====================================================================
ALTER TABLE public.kds_order_items
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_qty integer NOT NULL DEFAULT 0;

-- =====================================================================
-- 2. Enum y tabla cancelaciones_items_sesion
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cancelacion_item_estado') THEN
    CREATE TYPE public.cancelacion_item_estado AS ENUM (
      'pendiente_decision',
      'retornado_stock',
      'merma',
      'rechazado'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cancelaciones_items_sesion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL,
  upsell_id       uuid,
  producto_id     uuid NOT NULL,
  nombre_producto text NOT NULL,
  cantidad        integer NOT NULL CHECK (cantidad > 0),
  kds_order_id    uuid,
  kds_item_id     uuid,
  estado          public.cancelacion_item_estado NOT NULL DEFAULT 'pendiente_decision',
  solicitante_id  uuid NOT NULL,
  decidido_por    uuid,
  motivo          text NOT NULL,
  notas_cocina    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cancel_items_session ON public.cancelaciones_items_sesion(session_id);
CREATE INDEX IF NOT EXISTS idx_cancel_items_estado  ON public.cancelaciones_items_sesion(estado);
CREATE INDEX IF NOT EXISTS idx_cancel_items_kds     ON public.cancelaciones_items_sesion(kds_order_id);

ALTER TABLE public.cancelaciones_items_sesion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view cancelaciones items"   ON public.cancelaciones_items_sesion;
DROP POLICY IF EXISTS "Authenticated can insert cancelaciones items" ON public.cancelaciones_items_sesion;
DROP POLICY IF EXISTS "Cocina y admin pueden actualizar cancel"      ON public.cancelaciones_items_sesion;

CREATE POLICY "Authenticated can view cancelaciones items"
  ON public.cancelaciones_items_sesion FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can insert cancelaciones items"
  ON public.cancelaciones_items_sesion FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = solicitante_id);

CREATE POLICY "Cocina y admin pueden actualizar cancel"
  ON public.cancelaciones_items_sesion FOR UPDATE
  TO authenticated USING (
    public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'barista'::app_role)
  );

-- =====================================================================
-- 3. Triggers de stock para coworking_session_upsells
-- =====================================================================

-- Descontar al INSERT
CREATE OR REPLACE FUNCTION public.descontar_stock_on_upsell_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  cantidad_requerida numeric;
  nuevo_stock numeric;
  nombre_insumo text;
BEGIN
  IF current_setting('app.skip_stock_change', true) = 'on' THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT insumo_id, cantidad_necesaria
    FROM public.recetas
    WHERE producto_id = NEW.producto_id
  LOOP
    cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;

    UPDATE public.insumos
       SET stock_actual = stock_actual - cantidad_requerida
     WHERE id = r.insumo_id
     RETURNING stock_actual, nombre INTO nuevo_stock, nombre_insumo;

    IF nuevo_stock < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para insumo "%"', nombre_insumo;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Ajustar diferencia al UPDATE de cantidad
CREATE OR REPLACE FUNCTION public.ajustar_stock_on_upsell_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  delta integer;
  cantidad_requerida numeric;
  nuevo_stock numeric;
  nombre_insumo text;
BEGIN
  IF current_setting('app.skip_stock_change', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.cantidad = OLD.cantidad AND NEW.producto_id = OLD.producto_id THEN
    RETURN NEW;
  END IF;

  -- Si cambia el producto, devolver el viejo y descontar el nuevo
  IF NEW.producto_id <> OLD.producto_id THEN
    -- Reintegrar el viejo
    FOR r IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = OLD.producto_id LOOP
      UPDATE public.insumos SET stock_actual = stock_actual + (r.cantidad_necesaria * OLD.cantidad) WHERE id = r.insumo_id;
    END LOOP;
    -- Descontar el nuevo
    FOR r IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = NEW.producto_id LOOP
      cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;
      UPDATE public.insumos SET stock_actual = stock_actual - cantidad_requerida
        WHERE id = r.insumo_id RETURNING stock_actual, nombre INTO nuevo_stock, nombre_insumo;
      IF nuevo_stock < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para insumo "%"', nombre_insumo;
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  delta := NEW.cantidad - OLD.cantidad;
  IF delta = 0 THEN RETURN NEW; END IF;

  FOR r IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = NEW.producto_id LOOP
    cantidad_requerida := r.cantidad_necesaria * delta;
    UPDATE public.insumos
      SET stock_actual = stock_actual - cantidad_requerida
      WHERE id = r.insumo_id
      RETURNING stock_actual, nombre INTO nuevo_stock, nombre_insumo;
    IF delta > 0 AND nuevo_stock < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para insumo "%"', nombre_insumo;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Reintegrar al DELETE
CREATE OR REPLACE FUNCTION public.reintegrar_stock_on_upsell_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF current_setting('app.skip_stock_change', true) = 'on' THEN
    RETURN OLD;
  END IF;

  FOR r IN SELECT insumo_id, cantidad_necesaria FROM public.recetas WHERE producto_id = OLD.producto_id LOOP
    UPDATE public.insumos
      SET stock_actual = stock_actual + (r.cantidad_necesaria * OLD.cantidad)
      WHERE id = r.insumo_id;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_upsell_stock_insert ON public.coworking_session_upsells;
CREATE TRIGGER trg_upsell_stock_insert
  AFTER INSERT ON public.coworking_session_upsells
  FOR EACH ROW EXECUTE FUNCTION public.descontar_stock_on_upsell_insert();

DROP TRIGGER IF EXISTS trg_upsell_stock_update ON public.coworking_session_upsells;
CREATE TRIGGER trg_upsell_stock_update
  AFTER UPDATE ON public.coworking_session_upsells
  FOR EACH ROW EXECUTE FUNCTION public.ajustar_stock_on_upsell_update();

DROP TRIGGER IF EXISTS trg_upsell_stock_delete ON public.coworking_session_upsells;
CREATE TRIGGER trg_upsell_stock_delete
  AFTER DELETE ON public.coworking_session_upsells
  FOR EACH ROW EXECUTE FUNCTION public.reintegrar_stock_on_upsell_delete();

-- =====================================================================
-- 4. Modificar descontar_inventario_venta para saltar coworking
-- =====================================================================
CREATE OR REPLACE FUNCTION public.descontar_inventario_venta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  cantidad_requerida numeric;
  nuevo_stock numeric;
  nombre_insumo text;
BEGIN
  -- Las líneas originadas de coworking ya descontaron stock al enviarse a cocina
  IF NEW.tipo_concepto = 'coworking'::tipo_concepto THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT recetas.insumo_id, recetas.cantidad_necesaria
    FROM recetas
    WHERE recetas.producto_id = NEW.producto_id
  LOOP
    cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;

    UPDATE insumos
    SET stock_actual = stock_actual - cantidad_requerida
    WHERE id = r.insumo_id;

    SELECT stock_actual, nombre INTO nuevo_stock, nombre_insumo
    FROM insumos WHERE id = r.insumo_id;

    IF nuevo_stock < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para insumo "%"', nombre_insumo;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- =====================================================================
-- 5. Alineación de stock para sesiones activas existentes
--    (descontar una sola vez los upsells ya cargados)
-- =====================================================================
DO $$
DECLARE
  rec RECORD;
  r RECORD;
BEGIN
  FOR rec IN
    SELECT u.producto_id, u.cantidad
    FROM public.coworking_session_upsells u
    JOIN public.coworking_sessions s ON s.id = u.session_id
    WHERE s.estado = 'activo'
  LOOP
    FOR r IN
      SELECT insumo_id, cantidad_necesaria
      FROM public.recetas
      WHERE producto_id = rec.producto_id
    LOOP
      UPDATE public.insumos
        SET stock_actual = stock_actual - (r.cantidad_necesaria * rec.cantidad)
      WHERE id = r.insumo_id;
    END LOOP;
  END LOOP;
END $$;

-- =====================================================================
-- 6. RPC: solicitar_cancelacion_item_sesion
-- =====================================================================
CREATE OR REPLACE FUNCTION public.solicitar_cancelacion_item_sesion(
  p_upsell_id uuid,
  p_cantidad integer,
  p_motivo text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_upsell RECORD;
  v_producto_nombre text;
  v_kds_item RECORD;
  v_cancel_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT * INTO v_upsell FROM public.coworking_session_upsells WHERE id = p_upsell_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ítem de sesión no encontrado';
  END IF;

  IF p_cantidad > v_upsell.cantidad THEN
    RAISE EXCEPTION 'Cantidad a cancelar (%) excede la cantidad actual (%)', p_cantidad, v_upsell.cantidad;
  END IF;

  SELECT nombre INTO v_producto_nombre FROM public.productos WHERE id = v_upsell.producto_id;

  -- Buscar el último kds_order_item asociado a esta sesión y producto que no esté completamente cancelado
  SELECT koi.id AS kds_item_id, ko.id AS kds_order_id, koi.cantidad, koi.cancel_qty
    INTO v_kds_item
  FROM public.kds_order_items koi
  JOIN public.kds_orders ko ON ko.id = koi.kds_order_id
  WHERE ko.coworking_session_id = v_upsell.session_id
    AND koi.producto_id = v_upsell.producto_id
    AND (koi.cantidad - koi.cancel_qty) > 0
  ORDER BY ko.created_at DESC
  LIMIT 1;

  -- Marcar item KDS si existe
  IF v_kds_item.kds_item_id IS NOT NULL THEN
    UPDATE public.kds_order_items
      SET cancel_requested = true,
          cancel_qty = LEAST(v_kds_item.cantidad, v_kds_item.cancel_qty + p_cantidad)
    WHERE id = v_kds_item.kds_item_id;
  END IF;

  INSERT INTO public.cancelaciones_items_sesion (
    session_id, upsell_id, producto_id, nombre_producto, cantidad,
    kds_order_id, kds_item_id, solicitante_id, motivo
  ) VALUES (
    v_upsell.session_id, v_upsell.id, v_upsell.producto_id,
    COALESCE(v_producto_nombre, 'Producto'), p_cantidad,
    v_kds_item.kds_order_id, v_kds_item.kds_item_id, v_user, trim(p_motivo)
  )
  RETURNING id INTO v_cancel_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'solicitar_cancelacion_item_sesion',
    format('Solicitud de cancelación: %s ×%s — motivo: %s', COALESCE(v_producto_nombre,'producto'), p_cantidad, trim(p_motivo)),
    jsonb_build_object(
      'cancelacion_id', v_cancel_id,
      'session_id', v_upsell.session_id,
      'upsell_id', v_upsell.id,
      'producto_id', v_upsell.producto_id,
      'cantidad', p_cantidad,
      'kds_order_id', v_kds_item.kds_order_id,
      'transaccional', true
    )
  );

  RETURN json_build_object('ok', true, 'cancelacion_id', v_cancel_id);
END;
$$;

-- =====================================================================
-- 7. RPC: resolver_cancelacion_item_sesion
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolver_cancelacion_item_sesion(
  p_cancelacion_id uuid,
  p_decision text,
  p_notas text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cancel RECORD;
  v_upsell RECORD;
  v_nueva_cantidad integer;
  v_receta RECORD;
  v_total_kds integer;
  v_cancelados_kds integer;
  v_mermas integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    public.has_role(v_user, 'administrador'::app_role)
    OR public.has_role(v_user, 'supervisor'::app_role)
    OR public.has_role(v_user, 'barista'::app_role)
  ) THEN
    RAISE EXCEPTION 'Permisos insuficientes para resolver cancelación' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('retornado_stock', 'merma', 'rechazado') THEN
    RAISE EXCEPTION 'Decisión inválida: %', p_decision;
  END IF;

  SELECT * INTO v_cancel FROM public.cancelaciones_items_sesion WHERE id = p_cancelacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud de cancelación no encontrada';
  END IF;

  IF v_cancel.estado <> 'pendiente_decision' THEN
    RAISE EXCEPTION 'Esta solicitud ya fue resuelta (estado: %)', v_cancel.estado;
  END IF;

  -- Caso RECHAZADO: sólo limpiar marca KDS
  IF p_decision = 'rechazado' THEN
    IF v_cancel.kds_item_id IS NOT NULL THEN
      UPDATE public.kds_order_items
        SET cancel_qty = GREATEST(0, cancel_qty - v_cancel.cantidad),
            cancel_requested = (GREATEST(0, cancel_qty - v_cancel.cantidad) > 0)
      WHERE id = v_cancel.kds_item_id;
    END IF;

    UPDATE public.cancelaciones_items_sesion
       SET estado = 'rechazado',
           decidido_por = v_user,
           decided_at = now(),
           notas_cocina = p_notas
     WHERE id = p_cancelacion_id;

    INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
    VALUES (v_user, 'resolver_cancelacion_item_sesion',
            format('Cancelación rechazada: %s ×%s', v_cancel.nombre_producto, v_cancel.cantidad),
            jsonb_build_object('cancelacion_id', p_cancelacion_id, 'decision', 'rechazado', 'notas', p_notas));
    RETURN json_build_object('ok', true, 'decision', 'rechazado');
  END IF;

  -- RETORNADO_STOCK o MERMA: ambos reducen el upsell.
  -- Diferencia: retornado deja que el trigger reintegre stock; merma usa bypass.
  IF v_cancel.upsell_id IS NOT NULL THEN
    SELECT * INTO v_upsell FROM public.coworking_session_upsells WHERE id = v_cancel.upsell_id FOR UPDATE;
  END IF;

  IF v_upsell.id IS NULL THEN
    -- El upsell ya no existe (puede haberse eliminado). Tratamos sólo decisión.
    NULL;
  ELSE
    v_nueva_cantidad := v_upsell.cantidad - v_cancel.cantidad;

    IF p_decision = 'merma' THEN
      -- Bypass: no reintegrar stock al borrar/actualizar
      PERFORM set_config('app.skip_stock_change', 'on', true);

      IF v_nueva_cantidad <= 0 THEN
        DELETE FROM public.coworking_session_upsells WHERE id = v_upsell.id;
      ELSE
        UPDATE public.coworking_session_upsells SET cantidad = v_nueva_cantidad WHERE id = v_upsell.id;
      END IF;

      PERFORM set_config('app.skip_stock_change', 'off', true);

      -- Registrar merma por cada insumo de la receta
      FOR v_receta IN
        SELECT r.insumo_id, r.cantidad_necesaria, i.nombre AS insumo_nombre
        FROM public.recetas r
        JOIN public.insumos i ON i.id = r.insumo_id
        WHERE r.producto_id = v_cancel.producto_id
      LOOP
        INSERT INTO public.mermas (insumo_id, cantidad, motivo, usuario_id)
        VALUES (
          v_receta.insumo_id,
          v_receta.cantidad_necesaria * v_cancel.cantidad,
          format('Cancelación coworking — %s ×%s (sesión %s)',
                 v_cancel.nombre_producto, v_cancel.cantidad, v_upsell.session_id),
          v_user
        );
        v_mermas := v_mermas + 1;
      END LOOP;

    ELSE
      -- retornado_stock: dejar que los triggers reintegren
      IF v_nueva_cantidad <= 0 THEN
        DELETE FROM public.coworking_session_upsells WHERE id = v_upsell.id;
      ELSE
        UPDATE public.coworking_session_upsells SET cantidad = v_nueva_cantidad WHERE id = v_upsell.id;
      END IF;
    END IF;
  END IF;

  -- Actualizar item KDS: reducir cantidad y limpiar marca
  IF v_cancel.kds_item_id IS NOT NULL THEN
    SELECT cantidad, cancel_qty INTO v_total_kds, v_cancelados_kds
      FROM public.kds_order_items WHERE id = v_cancel.kds_item_id FOR UPDATE;

    IF v_total_kds IS NOT NULL THEN
      IF (v_total_kds - v_cancel.cantidad) <= 0 THEN
        DELETE FROM public.kds_order_items WHERE id = v_cancel.kds_item_id;
        -- Si la orden queda vacía, eliminarla
        IF NOT EXISTS (SELECT 1 FROM public.kds_order_items WHERE kds_order_id = v_cancel.kds_order_id) THEN
          DELETE FROM public.kds_orders WHERE id = v_cancel.kds_order_id;
        END IF;
      ELSE
        UPDATE public.kds_order_items
          SET cantidad = v_total_kds - v_cancel.cantidad,
              cancel_qty = GREATEST(0, v_cancelados_kds - v_cancel.cantidad),
              cancel_requested = (GREATEST(0, v_cancelados_kds - v_cancel.cantidad) > 0)
        WHERE id = v_cancel.kds_item_id;
      END IF;
    END IF;
  END IF;

  -- Marcar la solicitud
  UPDATE public.cancelaciones_items_sesion
     SET estado = p_decision::public.cancelacion_item_estado,
         decidido_por = v_user,
         decided_at = now(),
         notas_cocina = p_notas
   WHERE id = p_cancelacion_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'resolver_cancelacion_item_sesion',
    format('Cancelación %s: %s ×%s', p_decision, v_cancel.nombre_producto, v_cancel.cantidad),
    jsonb_build_object(
      'cancelacion_id', p_cancelacion_id,
      'decision', p_decision,
      'session_id', v_cancel.session_id,
      'producto_id', v_cancel.producto_id,
      'cantidad', v_cancel.cantidad,
      'mermas_registradas', v_mermas,
      'notas', p_notas,
      'transaccional', true
    )
  );

  RETURN json_build_object('ok', true, 'decision', p_decision, 'mermas', v_mermas);
END;
$$;

-- =====================================================================
-- 8. Realtime para la nueva tabla y kds_order_items
-- =====================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.cancelaciones_items_sesion;
