
-- =============================================
-- SPRINT 3: Chocolatería e Inventarios
-- =============================================

-- 1. Tabla insumos (materia prima)
CREATE TABLE public.insumos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre text NOT NULL,
  unidad_medida text NOT NULL DEFAULT 'gr', -- gr, ml, pza
  stock_actual numeric NOT NULL DEFAULT 0,
  stock_minimo numeric NOT NULL DEFAULT 0,
  costo_unitario numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;

-- Todos los autenticados pueden ver insumos
CREATE POLICY "Authenticated users can view insumos"
  ON public.insumos FOR SELECT
  USING (auth.role() = 'authenticated');

-- Solo administrador puede insertar/actualizar/borrar insumos
CREATE POLICY "Admins can manage insumos"
  ON public.insumos FOR ALL
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- 2. Tabla productos (productos finales)
CREATE TABLE public.productos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre text NOT NULL,
  categoria text NOT NULL DEFAULT 'Alimentos', -- Alimentos, Bebidas
  precio_venta numeric NOT NULL DEFAULT 0,
  costo_total numeric NOT NULL DEFAULT 0,    -- calculado desde recetas
  margen numeric NOT NULL DEFAULT 0,          -- calculado: (precio_venta - costo_total) / precio_venta * 100
  imagen_url text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

-- Todos los autenticados pueden ver productos
CREATE POLICY "Authenticated users can view productos"
  ON public.productos FOR SELECT
  USING (auth.role() = 'authenticated');

-- Solo admin puede modificar productos (costos y márgenes son sensibles)
CREATE POLICY "Admins can manage productos"
  ON public.productos FOR ALL
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- 3. Tabla recetas (vincula productos con insumos)
CREATE TABLE public.recetas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE RESTRICT,
  cantidad_necesaria numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (producto_id, insumo_id)
);

ALTER TABLE public.recetas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view recetas"
  ON public.recetas FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage recetas"
  ON public.recetas FOR ALL
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- 4. Tabla mermas (registro de pérdidas de insumos)
CREATE TABLE public.mermas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE RESTRICT,
  cantidad numeric NOT NULL DEFAULT 0,
  motivo text NOT NULL,
  usuario_id uuid NOT NULL,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.mermas ENABLE ROW LEVEL SECURITY;

-- Administradores y supervisores pueden ver mermas
CREATE POLICY "Admins and supervisors can view mermas"
  ON public.mermas FOR SELECT
  USING (
    has_role(auth.uid(), 'administrador'::app_role) OR
    has_role(auth.uid(), 'supervisor'::app_role)
  );

-- Cualquier autenticado puede insertar mermas (trazabilidad)
CREATE POLICY "Authenticated users can insert mermas"
  ON public.mermas FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

-- Solo admins pueden eliminar mermas
CREATE POLICY "Admins can delete mermas"
  ON public.mermas FOR DELETE
  USING (has_role(auth.uid(), 'administrador'::app_role));

-- 5. Trigger updated_at para insumos y productos
CREATE TRIGGER update_insumos_updated_at
  BEFORE UPDATE ON public.insumos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_productos_updated_at
  BEFORE UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
