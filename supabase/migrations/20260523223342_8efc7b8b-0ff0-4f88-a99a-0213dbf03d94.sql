-- 1) Función para restituir stock al cancelar una venta
CREATE OR REPLACE FUNCTION public.revertir_stock_venta(_venta_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.insumos i
    SET stock_actual = i.stock_actual + sub.qty_repuesta,
        updated_at = now()
    FROM (
      SELECT r.insumo_id,
             SUM(r.cantidad_necesaria * dv.cantidad) AS qty_repuesta
      FROM public.detalle_ventas dv
      JOIN public.recetas r ON r.producto_id = dv.producto_id
      WHERE dv.venta_id = _venta_id
        AND dv.tipo_concepto = 'producto'
        AND dv.producto_id IS NOT NULL
      GROUP BY r.insumo_id
    ) sub
    WHERE i.id = sub.insumo_id;
END;
$$;

REVOKE ALL ON FUNCTION public.revertir_stock_venta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revertir_stock_venta(uuid) TO authenticated;

-- 2) Trigger para recalcular comisiones bancarias en cambios de método de pago
CREATE OR REPLACE FUNCTION public.recalc_comisiones_bancarias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_tarjeta numeric;
  propina_en_tarjeta numeric;
BEGIN
  -- Asumimos que cuando la venta incluye tarjeta y hay propina, ésta se
  -- cobra dentro del monto de tarjeta (regla documentada en accounting-export-unified).
  -- Si el método no incluye tarjeta, no hay propina digital sobre tarjeta.
  IF NEW.metodo_pago IN ('tarjeta', 'mixto') THEN
    propina_en_tarjeta := LEAST(COALESCE(NEW.monto_propina, 0), COALESCE(NEW.monto_tarjeta, 0));
  ELSE
    propina_en_tarjeta := 0;
  END IF;

  base_tarjeta := GREATEST(0, COALESCE(NEW.monto_tarjeta, 0) - propina_en_tarjeta);
  NEW.comisiones_bancarias := ROUND(base_tarjeta * 0.035, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_comisiones_bancarias ON public.ventas;
CREATE TRIGGER trg_recalc_comisiones_bancarias
  BEFORE INSERT OR UPDATE OF metodo_pago, monto_tarjeta, monto_propina, monto_efectivo, monto_transferencia
  ON public.ventas
  FOR EACH ROW
  EXECUTE FUNCTION public.recalc_comisiones_bancarias();