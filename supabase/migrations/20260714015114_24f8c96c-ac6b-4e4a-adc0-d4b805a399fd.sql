DROP POLICY IF EXISTS "Usuarios autenticados pueden leer/escribir clientes" ON public.clientes;
CREATE POLICY "Usuarios autenticados pueden leer/escribir clientes"
ON public.clientes
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);