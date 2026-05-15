-- Fase A: Restaurar triggers críticos de integridad operativa
-- Las funciones ya existen pero estaban huérfanas (sin trigger conectado).

-- 1. Descontar inventario al insertar línea de detalle de venta
DROP TRIGGER IF EXISTS trg_descontar_inventario_venta ON public.detalle_ventas;
CREATE TRIGGER trg_descontar_inventario_venta
AFTER INSERT ON public.detalle_ventas
FOR EACH ROW
EXECUTE FUNCTION public.descontar_inventario_venta();

-- 2. Reintegrar inventario al cancelar venta
DROP TRIGGER IF EXISTS trg_reintegrar_inventario_cancelacion ON public.ventas;
CREATE TRIGGER trg_reintegrar_inventario_cancelacion
AFTER UPDATE OF estado ON public.ventas
FOR EACH ROW
EXECUTE FUNCTION public.reintegrar_inventario_cancelacion();

-- 3. Limpiar órdenes KDS al cancelar venta
DROP TRIGGER IF EXISTS trg_cleanup_kds_on_venta_cancel ON public.ventas;
CREATE TRIGGER trg_cleanup_kds_on_venta_cancel
AFTER UPDATE OF estado ON public.ventas
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_kds_on_venta_cancel();

-- 4. Sumar stock al registrar compra de insumo
DROP TRIGGER IF EXISTS trg_sumar_stock_compra ON public.compras_insumos;
CREATE TRIGGER trg_sumar_stock_compra
AFTER INSERT ON public.compras_insumos
FOR EACH ROW
EXECUTE FUNCTION public.sumar_stock_compra();

-- 5. Triggers de updated_at en tablas con esa columna (si faltan)
DROP TRIGGER IF EXISTS trg_update_ventas_updated_at ON public.ventas;
CREATE TRIGGER trg_update_ventas_updated_at
BEFORE UPDATE ON public.ventas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_cajas_updated_at ON public.cajas;
CREATE TRIGGER trg_update_cajas_updated_at
BEFORE UPDATE ON public.cajas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_coworking_sessions_updated_at ON public.coworking_sessions;
CREATE TRIGGER trg_update_coworking_sessions_updated_at
BEFORE UPDATE ON public.coworking_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_kds_orders_updated_at ON public.kds_orders;
CREATE TRIGGER trg_update_kds_orders_updated_at
BEFORE UPDATE ON public.kds_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_insumos_updated_at ON public.insumos;
CREATE TRIGGER trg_update_insumos_updated_at
BEFORE UPDATE ON public.insumos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_productos_updated_at ON public.productos;
CREATE TRIGGER trg_update_productos_updated_at
BEFORE UPDATE ON public.productos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();