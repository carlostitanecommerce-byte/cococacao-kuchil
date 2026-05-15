-- Una sola caja física compartida por todo el equipo del POS

DROP POLICY IF EXISTS "Users can view own cajas" ON public.cajas;
DROP POLICY IF EXISTS "Supervisors can view all cajas" ON public.cajas;
CREATE POLICY "Authenticated users can view cajas"
  ON public.cajas FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can update own cajas" ON public.cajas;
CREATE POLICY "Authenticated users can update open caja"
  ON public.cajas FOR UPDATE
  TO authenticated
  USING (estado = 'abierta'::caja_estado);

DROP POLICY IF EXISTS "Users can insert own movimientos" ON public.movimientos_caja;
CREATE POLICY "Authenticated users can insert movimientos"
  ON public.movimientos_caja FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = usuario_id
    AND EXISTS (
      SELECT 1 FROM public.cajas
      WHERE cajas.id = movimientos_caja.caja_id
        AND cajas.estado = 'abierta'::caja_estado
    )
  );

ALTER TABLE public.movimientos_caja REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.movimientos_caja;