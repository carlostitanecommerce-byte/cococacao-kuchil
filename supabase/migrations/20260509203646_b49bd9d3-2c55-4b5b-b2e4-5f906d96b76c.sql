ALTER TABLE public.categorias_maestras
  ADD COLUMN IF NOT EXISTS ambito text;

UPDATE public.categorias_maestras cm
SET ambito = CASE
  WHEN EXISTS (SELECT 1 FROM public.insumos i WHERE i.categoria = cm.nombre)
       AND NOT EXISTS (SELECT 1 FROM public.productos p WHERE p.categoria = cm.nombre)
    THEN 'insumo'
  ELSE 'producto'
END
WHERE ambito IS NULL;

ALTER TABLE public.categorias_maestras
  ALTER COLUMN ambito SET DEFAULT 'producto',
  ALTER COLUMN ambito SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categorias_maestras_ambito_check') THEN
    ALTER TABLE public.categorias_maestras
      ADD CONSTRAINT categorias_maestras_ambito_check
      CHECK (ambito IN ('insumo','producto','paquete'));
  END IF;
END$$;

ALTER TABLE public.categorias_maestras
  DROP CONSTRAINT IF EXISTS categorias_maestras_nombre_key;

CREATE UNIQUE INDEX IF NOT EXISTS categorias_maestras_nombre_ambito_uniq
  ON public.categorias_maestras (nombre, ambito);

CREATE INDEX IF NOT EXISTS categorias_maestras_ambito_idx
  ON public.categorias_maestras (ambito);