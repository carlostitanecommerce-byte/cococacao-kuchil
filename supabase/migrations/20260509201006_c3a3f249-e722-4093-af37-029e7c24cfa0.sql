-- Tarea 1.1: Delivery
CREATE TABLE public.plataformas_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  comision_porcentaje numeric NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.producto_precios_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  plataforma_id uuid NOT NULL REFERENCES public.plataformas_delivery(id) ON DELETE CASCADE,
  precio_venta numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producto_id, plataforma_id)
);
CREATE INDEX idx_ppd_producto ON public.producto_precios_delivery(producto_id);
CREATE INDEX idx_ppd_plataforma ON public.producto_precios_delivery(plataforma_id);

-- Tarea 1.2: Paquetes dinámicos
CREATE TABLE public.paquete_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paquete_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  nombre_grupo text NOT NULL,
  cantidad_incluida integer NOT NULL DEFAULT 1,
  es_obligatorio boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pg_paquete ON public.paquete_grupos(paquete_id);

CREATE TABLE public.paquete_opciones_grupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL REFERENCES public.paquete_grupos(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  precio_adicional numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grupo_id, producto_id)
);
CREATE INDEX idx_pog_grupo ON public.paquete_opciones_grupo(grupo_id);
CREATE INDEX idx_pog_producto ON public.paquete_opciones_grupo(producto_id);

-- RLS
ALTER TABLE public.plataformas_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_precios_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paquete_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paquete_opciones_grupo ENABLE ROW LEVEL SECURITY;

-- plataformas_delivery
CREATE POLICY "Authenticated can view plataformas_delivery"
  ON public.plataformas_delivery FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage plataformas_delivery"
  ON public.plataformas_delivery FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'administrador'::app_role))
  WITH CHECK (has_role(auth.uid(), 'administrador'::app_role));

-- producto_precios_delivery
CREATE POLICY "Authenticated can view producto_precios_delivery"
  ON public.producto_precios_delivery FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage producto_precios_delivery"
  ON public.producto_precios_delivery FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'administrador'::app_role))
  WITH CHECK (has_role(auth.uid(), 'administrador'::app_role));

-- paquete_grupos
CREATE POLICY "Authenticated can view paquete_grupos"
  ON public.paquete_grupos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage paquete_grupos"
  ON public.paquete_grupos FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'administrador'::app_role))
  WITH CHECK (has_role(auth.uid(), 'administrador'::app_role));

-- paquete_opciones_grupo
CREATE POLICY "Authenticated can view paquete_opciones_grupo"
  ON public.paquete_opciones_grupo FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage paquete_opciones_grupo"
  ON public.paquete_opciones_grupo FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'administrador'::app_role))
  WITH CHECK (has_role(auth.uid(), 'administrador'::app_role));

-- Triggers updated_at
CREATE TRIGGER trg_plataformas_delivery_updated
  BEFORE UPDATE ON public.plataformas_delivery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_producto_precios_delivery_updated
  BEFORE UPDATE ON public.producto_precios_delivery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_paquete_grupos_updated
  BEFORE UPDATE ON public.paquete_grupos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();