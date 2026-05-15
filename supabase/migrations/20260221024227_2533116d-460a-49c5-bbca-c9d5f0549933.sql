
-- Enum for billing type
CREATE TYPE public.tipo_cobro AS ENUM ('hora', 'dia', 'mes', 'paquete_horas');

-- Tarifas table
CREATE TABLE public.tarifas_coworking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  tipo_cobro tipo_cobro NOT NULL DEFAULT 'hora',
  precio_base numeric NOT NULL DEFAULT 0,
  areas_aplicables uuid[] NOT NULL DEFAULT '{}',
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tarifas_coworking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tarifas" ON public.tarifas_coworking FOR SELECT USING (true);
CREATE POLICY "Admins can manage tarifas" ON public.tarifas_coworking FOR ALL USING (has_role(auth.uid(), 'administrador'));

CREATE TRIGGER update_tarifas_coworking_updated_at
  BEFORE UPDATE ON public.tarifas_coworking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Amenities incluidos table
CREATE TABLE public.tarifa_amenities_incluidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarifa_id uuid NOT NULL REFERENCES public.tarifas_coworking(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  cantidad_incluida integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tarifa_id, producto_id)
);

ALTER TABLE public.tarifa_amenities_incluidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view amenities" ON public.tarifa_amenities_incluidos FOR SELECT USING (true);
CREATE POLICY "Admins can manage amenities" ON public.tarifa_amenities_incluidos FOR ALL USING (has_role(auth.uid(), 'administrador'));

-- Upsell price on productos
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS precio_upsell_coworking numeric;
