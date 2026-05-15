
-- Tabla maestra de categorías
CREATE TABLE public.categorias_maestras (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.categorias_maestras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view categorias"
  ON public.categorias_maestras FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage categorias"
  ON public.categorias_maestras FOR ALL
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- Trigger updated_at
CREATE TRIGGER update_categorias_maestras_updated_at
  BEFORE UPDATE ON public.categorias_maestras
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: migrar categorías existentes de insumos y productos
INSERT INTO public.categorias_maestras (nombre)
SELECT DISTINCT categoria FROM (
  SELECT categoria FROM public.insumos
  UNION
  SELECT categoria FROM public.productos
) AS all_cats
WHERE categoria IS NOT NULL AND categoria != ''
ON CONFLICT (nombre) DO NOTHING;
