-- Add new columns to insumos for presentation-based purchasing and categories
ALTER TABLE public.insumos
  ADD COLUMN IF NOT EXISTS presentacion text NOT NULL DEFAULT 'Unidad',
  ADD COLUMN IF NOT EXISTS costo_presentacion numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_por_presentacion numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'Otros';
