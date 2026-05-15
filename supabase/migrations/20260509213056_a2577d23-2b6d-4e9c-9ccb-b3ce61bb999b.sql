
-- 1. venta_id nullable
ALTER TABLE public.detalle_ventas
  ALTER COLUMN venta_id DROP NOT NULL;

-- 2. Coherencia: venta_id o coworking_session_id
ALTER TABLE public.detalle_ventas
  DROP CONSTRAINT IF EXISTS detalle_ventas_venta_o_sesion_chk;
ALTER TABLE public.detalle_ventas
  ADD CONSTRAINT detalle_ventas_venta_o_sesion_chk
  CHECK (venta_id IS NOT NULL OR coworking_session_id IS NOT NULL);

-- 3. Índice de cuentas abiertas
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_session_open
  ON public.detalle_ventas (coworking_session_id)
  WHERE venta_id IS NULL;

-- 4. RLS de INSERT: permitir cuenta abierta
DROP POLICY IF EXISTS "Authenticated users can insert detalle_ventas" ON public.detalle_ventas;

CREATE POLICY "Authenticated users can insert detalle_ventas"
ON public.detalle_ventas FOR INSERT TO authenticated
WITH CHECK (
  (venta_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ventas v
    WHERE v.id = detalle_ventas.venta_id AND v.usuario_id = auth.uid()
  ))
  OR
  (venta_id IS NULL AND coworking_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.coworking_sessions s
    WHERE s.id = detalle_ventas.coworking_session_id
      AND s.estado IN ('activo'::coworking_estado, 'pendiente_pago'::coworking_estado)
  ))
);

-- 5. RLS de UPDATE: permitir ligar venta al cerrar la cuenta
DROP POLICY IF EXISTS "Authenticated can attach venta to open lines" ON public.detalle_ventas;

CREATE POLICY "Authenticated can attach venta to open lines"
ON public.detalle_ventas FOR UPDATE TO authenticated
USING (venta_id IS NULL AND coworking_session_id IS NOT NULL)
WITH CHECK (
  venta_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.ventas v
    WHERE v.id = detalle_ventas.venta_id AND v.usuario_id = auth.uid()
  )
);

-- 6. Trigger de inventario: no descontar si es cuenta abierta
CREATE OR REPLACE FUNCTION public.descontar_inventario_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cantidad_requerida numeric;
  nuevo_stock numeric;
  nombre_insumo text;
BEGIN
  -- Cuenta abierta de coworking: aún no se descuenta inventario
  IF NEW.venta_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Las líneas originadas de coworking ya descontaron stock al enviarse a cocina
  IF NEW.tipo_concepto = 'coworking'::tipo_concepto THEN
    RETURN NEW;
  END IF;

  -- Guardia: detalles tipo 'producto' deben tener producto_id
  IF NEW.tipo_concepto = 'producto'::tipo_concepto AND NEW.producto_id IS NULL THEN
    RAISE EXCEPTION 'Detalle de venta sin producto_id (tipo_concepto=producto). Posible paquete sin opciones expandidas.';
  END IF;

  IF NEW.producto_id IS NULL THEN
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
$function$;
