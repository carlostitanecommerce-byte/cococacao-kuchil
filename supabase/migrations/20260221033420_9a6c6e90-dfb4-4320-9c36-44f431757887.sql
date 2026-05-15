
-- Table for manual cash movements (entries/exits)
CREATE TABLE public.movimientos_caja (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  caja_id uuid NOT NULL REFERENCES public.cajas(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  monto numeric NOT NULL DEFAULT 0,
  motivo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.movimientos_caja ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can view movements for open cajas
CREATE POLICY "Authenticated users can view movimientos"
  ON public.movimientos_caja FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own movimientos"
  ON public.movimientos_caja FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY "Admins can delete movimientos"
  ON public.movimientos_caja FOR DELETE
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- Add diferencia column to cajas for storing the count difference
ALTER TABLE public.cajas ADD COLUMN IF NOT EXISTS diferencia numeric DEFAULT 0;
