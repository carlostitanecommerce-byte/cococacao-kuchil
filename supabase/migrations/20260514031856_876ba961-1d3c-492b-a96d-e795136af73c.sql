-- 1. Schema: producto_id nullable + add paquete_id + check constraint
ALTER TABLE public.cancelaciones_items_sesion
  ALTER COLUMN producto_id DROP NOT NULL;

ALTER TABLE public.cancelaciones_items_sesion
  ADD COLUMN IF NOT EXISTS paquete_id uuid;

ALTER TABLE public.cancelaciones_items_sesion
  DROP CONSTRAINT IF EXISTS cancelaciones_items_sesion_target_chk;

ALTER TABLE public.cancelaciones_items_sesion
  ADD CONSTRAINT cancelaciones_items_sesion_target_chk
    CHECK (producto_id IS NOT NULL OR paquete_id IS NOT NULL);

-- 2. Drop legacy 3-arg overload (had same paquete bug)
DROP FUNCTION IF EXISTS public.solicitar_cancelacion_item_sesion(uuid, integer, text);

-- 3. Replace 4-arg RPC with paquete-aware logic
CREATE OR REPLACE FUNCTION public.solicitar_cancelacion_item_sesion(
  p_session_id uuid,
  p_detalle_id uuid,
  p_cantidad integer,
  p_motivo text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_dv RECORD;
  v_pendientes integer;
  v_disponible integer;
  v_nombre text;
  v_kds_order_id uuid := NULL;
  v_kds_item_id uuid := NULL;
  v_id uuid;
  v_es_paquete boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 4 THEN
    RAISE EXCEPTION 'Motivo requerido (mínimo 4 caracteres)';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad < 1 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  SELECT * INTO v_dv
    FROM public.detalle_ventas
   WHERE id = p_detalle_id
     AND coworking_session_id = p_session_id
     AND venta_id IS NULL
   FOR UPDATE;

  IF v_dv.id IS NULL THEN
    RAISE EXCEPTION 'Línea no encontrada o ya facturada';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0) INTO v_pendientes
    FROM public.cancelaciones_items_sesion
   WHERE detalle_id = p_detalle_id
     AND estado = 'pendiente_decision';

  v_disponible := v_dv.cantidad - v_pendientes;
  IF p_cantidad > v_disponible THEN
    RAISE EXCEPTION 'Cantidad excede lo disponible para cancelar (máx %)', v_disponible;
  END IF;

  v_es_paquete := v_dv.paquete_id IS NOT NULL;

  -- Resolver nombre legible
  IF v_es_paquete THEN
    v_nombre := COALESCE(v_dv.paquete_nombre, v_dv.descripcion, 'Paquete');
  ELSE
    IF v_dv.producto_id IS NOT NULL THEN
      SELECT nombre INTO v_nombre FROM public.productos WHERE id = v_dv.producto_id;
    END IF;
    v_nombre := COALESCE(v_nombre, v_dv.descripcion, 'Producto');
  END IF;

  -- Enlazar KDS solo para producto simple
  IF NOT v_es_paquete AND v_dv.producto_id IS NOT NULL THEN
    SELECT koi.id, koi.kds_order_id
      INTO v_kds_item_id, v_kds_order_id
      FROM public.kds_order_items koi
      JOIN public.kds_orders ko ON ko.id = koi.kds_order_id
     WHERE ko.coworking_session_id = p_session_id
       AND koi.producto_id = v_dv.producto_id
       AND ko.estado <> 'listo'
     ORDER BY koi.created_at DESC
     LIMIT 1;
  END IF;

  INSERT INTO public.cancelaciones_items_sesion (
    session_id, detalle_id, producto_id, paquete_id, nombre_producto,
    cantidad, motivo, solicitante_id, kds_order_id, kds_item_id
  ) VALUES (
    p_session_id, p_detalle_id, v_dv.producto_id, v_dv.paquete_id, v_nombre,
    p_cantidad, p_motivo, v_user, v_kds_order_id, v_kds_item_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, accion, descripcion, metadata)
  VALUES (
    v_user,
    'solicitar_cancelacion_item_sesion',
    format('Solicitud cancelación: %s ×%s', v_nombre, p_cantidad),
    jsonb_build_object(
      'cancelacion_id', v_id,
      'detalle_id', p_detalle_id,
      'session_id', p_session_id,
      'cantidad', p_cantidad,
      'producto_id', v_dv.producto_id,
      'paquete_id', v_dv.paquete_id,
      'kds_item_id', v_kds_item_id,
      'transaccional', true
    )
  );

  RETURN json_build_object('ok', true, 'cancelacion_id', v_id);
END;
$function$;