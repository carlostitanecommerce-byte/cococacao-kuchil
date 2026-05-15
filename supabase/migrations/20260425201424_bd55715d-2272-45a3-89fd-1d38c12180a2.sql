
-- Enable realtime publication for KDS tables
ALTER TABLE public.kds_orders REPLICA IDENTITY FULL;
ALTER TABLE public.kds_order_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'kds_orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.kds_orders';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'kds_order_items'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.kds_order_items';
  END IF;
END $$;

-- Allow deletion of KDS orders (cascade items via FK or manual)
CREATE POLICY "Authenticated can delete kds_orders"
ON public.kds_orders
FOR DELETE
TO authenticated
USING (true);

CREATE POLICY "Authenticated can delete kds_order_items"
ON public.kds_order_items
FOR DELETE
TO authenticated
USING (true);

-- Trigger: when a venta is cancelled, remove its KDS orders
CREATE OR REPLACE FUNCTION public.cleanup_kds_on_venta_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'cancelada' AND (OLD.estado IS DISTINCT FROM 'cancelada') THEN
    DELETE FROM public.kds_order_items
    WHERE kds_order_id IN (SELECT id FROM public.kds_orders WHERE venta_id = NEW.id);
    DELETE FROM public.kds_orders WHERE venta_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_kds_on_venta_cancel ON public.ventas;
CREATE TRIGGER trg_cleanup_kds_on_venta_cancel
AFTER UPDATE ON public.ventas
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_kds_on_venta_cancel();
