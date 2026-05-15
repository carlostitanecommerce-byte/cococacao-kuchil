-- Add es_privado column to areas_coworking
ALTER TABLE public.areas_coworking ADD COLUMN IF NOT EXISTS es_privado boolean NOT NULL DEFAULT false;

-- Mark public areas (es_privado = false): Área pública, Cubículo 1, Cubículo 3
UPDATE public.areas_coworking SET es_privado = false WHERE nombre_area IN ('Área pública', 'Cubículo 1', 'Cubículo 3');

-- Mark private areas (es_privado = true): Cubículo 2, Cubículo 4, Sala de juntas, Oficina BCM
UPDATE public.areas_coworking SET es_privado = true WHERE nombre_area IN ('Cubículo 2', 'Cubículo 4', 'Sala de juntas', 'Oficina BCM');