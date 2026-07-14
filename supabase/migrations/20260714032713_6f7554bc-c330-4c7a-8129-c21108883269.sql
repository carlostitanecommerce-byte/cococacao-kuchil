DROP POLICY IF EXISTS "clientes_insert_authenticated" ON public.clientes;

CREATE POLICY "clientes_insert_operativos"
  ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  );