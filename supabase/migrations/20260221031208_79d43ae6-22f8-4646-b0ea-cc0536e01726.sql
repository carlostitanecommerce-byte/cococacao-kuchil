
-- Allow null producto_id for coworking service line items
ALTER TABLE public.detalle_ventas ALTER COLUMN producto_id DROP NOT NULL;
