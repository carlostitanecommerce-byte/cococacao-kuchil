-- ===== kds_orders =====
DROP POLICY IF EXISTS "Authenticated can insert kds_orders" ON public.kds_orders;
DROP POLICY IF EXISTS "Authenticated can update kds_orders" ON public.kds_orders;
DROP POLICY IF EXISTS "Authenticated can delete kds_orders" ON public.kds_orders;

CREATE POLICY "POS staff puede insertar kds_orders"
  ON public.kds_orders FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'administrador') OR
    public.has_role(auth.uid(), 'caja')
  );

CREATE POLICY "Cocina puede actualizar kds_orders"
  ON public.kds_orders FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'administrador') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'barista')
  );

CREATE POLICY "Solo admin puede borrar kds_orders"
  ON public.kds_orders FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'));

-- ===== kds_order_items =====
DROP POLICY IF EXISTS "Authenticated can insert kds_order_items" ON public.kds_order_items;
DROP POLICY IF EXISTS "Authenticated can delete kds_order_items" ON public.kds_order_items;

CREATE POLICY "POS staff puede insertar kds_order_items"
  ON public.kds_order_items FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'administrador') OR
    public.has_role(auth.uid(), 'caja')
  );

CREATE POLICY "Solo admin puede borrar kds_order_items"
  ON public.kds_order_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'));