
-- Enum para estados KDS
CREATE TYPE public.kds_estado AS ENUM ('pendiente', 'listo');

-- Órdenes KDS
CREATE TABLE public.kds_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id uuid NOT NULL REFERENCES ventas(id),
  folio integer NOT NULL,
  tipo_consumo text NOT NULL DEFAULT 'sitio',
  estado kds_estado NOT NULL DEFAULT 'pendiente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kds_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view kds_orders" ON public.kds_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert kds_orders" ON public.kds_orders
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update kds_orders" ON public.kds_orders
  FOR UPDATE TO authenticated USING (true);

-- Items KDS
CREATE TABLE public.kds_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kds_order_id uuid NOT NULL REFERENCES kds_orders(id) ON DELETE CASCADE,
  producto_id uuid REFERENCES productos(id),
  nombre_producto text NOT NULL,
  cantidad integer NOT NULL DEFAULT 1,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kds_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view kds_order_items" ON public.kds_order_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert kds_order_items" ON public.kds_order_items
  FOR INSERT TO authenticated WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.kds_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kds_order_items;

-- Trigger updated_at
CREATE TRIGGER update_kds_orders_updated_at
  BEFORE UPDATE ON public.kds_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
