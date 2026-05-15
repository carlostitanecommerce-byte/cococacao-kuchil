
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS instrucciones_preparacion text;
