-- Trigger para limpiar montos cobrados cuando una venta se cancela
CREATE OR REPLACE FUNCTION public.zero_montos_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'cancelada'
     AND (OLD.estado IS DISTINCT FROM 'cancelada') THEN
    NEW.monto_efectivo       := 0;
    NEW.monto_tarjeta        := 0;
    NEW.monto_transferencia  := 0;
    NEW.comisiones_bancarias := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zero_montos_on_cancel ON public.ventas;

CREATE TRIGGER trg_zero_montos_on_cancel
BEFORE UPDATE ON public.ventas
FOR EACH ROW
EXECUTE FUNCTION public.zero_montos_on_cancel();