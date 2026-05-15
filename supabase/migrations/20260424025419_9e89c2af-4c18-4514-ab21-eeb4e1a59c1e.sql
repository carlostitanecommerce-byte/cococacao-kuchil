-- 1. Add tipo column to productos
ALTER TABLE public.productos
ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'simple';

-- Backfill existing rows (defensive)
UPDATE public.productos SET tipo = 'simple' WHERE tipo IS NULL OR tipo = '';

-- Optional check constraint
ALTER TABLE public.productos
DROP CONSTRAINT IF EXISTS productos_tipo_check;
ALTER TABLE public.productos
ADD CONSTRAINT productos_tipo_check CHECK (tipo IN ('simple', 'paquete'));

-- 2. Create paquete_componentes table
CREATE TABLE IF NOT EXISTS public.paquete_componentes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  paquete_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad numeric NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paquete_componentes_paquete ON public.paquete_componentes(paquete_id);
CREATE INDEX IF NOT EXISTS idx_paquete_componentes_producto ON public.paquete_componentes(producto_id);

ALTER TABLE public.paquete_componentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view paquete_componentes" ON public.paquete_componentes;
CREATE POLICY "Authenticated can view paquete_componentes"
ON public.paquete_componentes
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage paquete_componentes" ON public.paquete_componentes;
CREATE POLICY "Admins can manage paquete_componentes"
ON public.paquete_componentes
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'administrador'::app_role))
WITH CHECK (has_role(auth.uid(), 'administrador'::app_role));

-- 3. Add traceability columns to detalle_ventas
ALTER TABLE public.detalle_ventas
ADD COLUMN IF NOT EXISTS paquete_id uuid NULL,
ADD COLUMN IF NOT EXISTS paquete_nombre text NULL;

CREATE INDEX IF NOT EXISTS idx_detalle_ventas_paquete ON public.detalle_ventas(paquete_id);

-- 4. validar_stock_paquete function
CREATE OR REPLACE FUNCTION public.validar_stock_paquete(p_paquete_id uuid, p_cantidad integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_resultado json;
  v_cant_total integer;
BEGIN
  FOR v_comp IN
    SELECT producto_id, cantidad
    FROM paquete_componentes
    WHERE paquete_id = p_paquete_id
  LOOP
    v_cant_total := CEIL(v_comp.cantidad * p_cantidad)::integer;
    v_resultado := validar_stock_disponible(v_comp.producto_id, v_cant_total);
    IF (v_resultado->>'valido')::boolean = false THEN
      RETURN v_resultado;
    END IF;
  END LOOP;

  RETURN json_build_object('valido', true);
END;
$function$;