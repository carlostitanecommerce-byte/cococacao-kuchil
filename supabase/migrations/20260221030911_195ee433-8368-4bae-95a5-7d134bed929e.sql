
-- Add concept type to detalle_ventas for separating coworking vs products
CREATE TYPE public.tipo_concepto AS ENUM ('producto', 'coworking', 'amenity');

ALTER TABLE public.detalle_ventas 
  ADD COLUMN tipo_concepto public.tipo_concepto NOT NULL DEFAULT 'producto',
  ADD COLUMN coworking_session_id uuid REFERENCES public.coworking_sessions(id) ON DELETE SET NULL,
  ADD COLUMN descripcion text;

-- Add mixed payment fields to ventas
ALTER TABLE public.ventas
  ADD COLUMN monto_efectivo numeric NOT NULL DEFAULT 0,
  ADD COLUMN monto_tarjeta numeric NOT NULL DEFAULT 0,
  ADD COLUMN monto_transferencia numeric NOT NULL DEFAULT 0,
  ADD COLUMN coworking_session_id uuid REFERENCES public.coworking_sessions(id) ON DELETE SET NULL;
