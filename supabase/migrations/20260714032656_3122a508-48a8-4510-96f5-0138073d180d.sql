DROP POLICY IF EXISTS "Usuarios autenticados pueden leer/escribir clientes" ON public.clientes;

CREATE POLICY "clientes_select_authenticated"
  ON public.clientes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "clientes_insert_authenticated"
  ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "clientes_update_operativos"
  ON public.clientes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  );

CREATE POLICY "clientes_delete_admin"
  ON public.clientes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'::app_role));