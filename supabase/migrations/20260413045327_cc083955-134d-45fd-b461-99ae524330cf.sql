CREATE TRIGGER trigger_descontar_inventario
AFTER INSERT ON public.detalle_ventas
FOR EACH ROW
EXECUTE FUNCTION public.descontar_inventario_venta();