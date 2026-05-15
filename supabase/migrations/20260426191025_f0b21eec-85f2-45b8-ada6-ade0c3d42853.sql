-- Permitir al rol 'recepcion' insertar órdenes KDS desde el POS
DROP POLICY IF EXISTS "POS staff puede insertar kds_orders" ON public.kds_orders;
CREATE POLICY "POS staff puede insertar kds_orders"
ON public.kds_orders
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'administrador'::app_role)
  OR has_role(auth.uid(), 'caja'::app_role)
  OR has_role(auth.uid(), 'recepcion'::app_role)
);

DROP POLICY IF EXISTS "POS staff puede insertar kds_order_items" ON public.kds_order_items;
CREATE POLICY "POS staff puede insertar kds_order_items"
ON public.kds_order_items
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'administrador'::app_role)
  OR has_role(auth.uid(), 'caja'::app_role)
  OR has_role(auth.uid(), 'recepcion'::app_role)
);