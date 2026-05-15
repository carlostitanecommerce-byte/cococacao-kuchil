-- 1) Crear trigger que invoca cleanup_kds_on_venta_cancel cuando una venta cambia a 'cancelada'
DROP TRIGGER IF EXISTS trg_cleanup_kds_on_venta_cancel ON public.ventas;
CREATE TRIGGER trg_cleanup_kds_on_venta_cancel
AFTER UPDATE ON public.ventas
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_kds_on_venta_cancel();

-- 2) Agregar estado 'expirada' al enum kds_estado para política de retención
ALTER TYPE public.kds_estado ADD VALUE IF NOT EXISTS 'expirada';