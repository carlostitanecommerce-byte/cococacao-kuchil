
-- Tabla de compras de insumos
CREATE TABLE public.compras_insumos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE RESTRICT,
  cantidad_presentaciones numeric NOT NULL DEFAULT 1,
  cantidad_unidades numeric NOT NULL DEFAULT 0,
  costo_total numeric NOT NULL DEFAULT 0,
  costo_presentacion numeric NOT NULL DEFAULT 0,
  nota text,
  usuario_id uuid NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.compras_insumos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage compras"
  ON public.compras_insumos FOR ALL
  USING (has_role(auth.uid(), 'administrador'::app_role));

CREATE POLICY "Authenticated users can view compras"
  ON public.compras_insumos FOR SELECT
  USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Users can insert own compras"
  ON public.compras_insumos FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

-- Trigger: sumar stock al insertar compra
CREATE OR REPLACE FUNCTION public.sumar_stock_compra()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE insumos
  SET stock_actual = stock_actual + NEW.cantidad_unidades
  WHERE id = NEW.insumo_id;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_sumar_stock_compra
  AFTER INSERT ON public.compras_insumos
  FOR EACH ROW
  EXECUTE FUNCTION public.sumar_stock_compra();
