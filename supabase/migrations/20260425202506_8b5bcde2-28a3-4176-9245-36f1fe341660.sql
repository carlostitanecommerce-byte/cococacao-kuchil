
-- Add 'en_preparacion' value to kds_estado enum
ALTER TYPE public.kds_estado ADD VALUE IF NOT EXISTS 'en_preparacion' BEFORE 'listo';

-- Add requiere_preparacion column to productos
ALTER TABLE public.productos
ADD COLUMN IF NOT EXISTS requiere_preparacion boolean NOT NULL DEFAULT true;
