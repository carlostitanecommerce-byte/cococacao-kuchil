
-- Enums for ventas
CREATE TYPE public.metodo_pago AS ENUM ('efectivo', 'tarjeta', 'transferencia', 'mixto');
CREATE TYPE public.tipo_consumo AS ENUM ('sitio', 'para_llevar', 'delivery');
CREATE TYPE public.venta_estado AS ENUM ('completada', 'cancelada');

-- Tabla ventas
CREATE TABLE public.ventas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id uuid NOT NULL,
  total_bruto numeric NOT NULL DEFAULT 0,
  iva numeric NOT NULL DEFAULT 0,
  comisiones_bancarias numeric NOT NULL DEFAULT 0,
  total_neto numeric NOT NULL DEFAULT 0,
  metodo_pago metodo_pago NOT NULL DEFAULT 'efectivo',
  tipo_consumo tipo_consumo NOT NULL DEFAULT 'sitio',
  estado venta_estado NOT NULL DEFAULT 'completada',
  motivo_cancelacion text,
  fecha timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;

-- RLS: todos los autenticados pueden ver ventas
CREATE POLICY "Authenticated users can view ventas"
  ON public.ventas FOR SELECT
  USING (true);

-- RLS: usuarios autenticados pueden insertar sus propias ventas
CREATE POLICY "Users can insert own ventas"
  ON public.ventas FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

-- RLS: solo el dueño o admin puede actualizar (para cancelar)
CREATE POLICY "Users can update own ventas or admin"
  ON public.ventas FOR UPDATE
  USING ((auth.uid() = usuario_id) OR has_role(auth.uid(), 'administrador'));

-- Prohibir DELETE en ventas
-- (no se crea policy de DELETE, por lo que nadie puede borrar)

-- Trigger updated_at
CREATE TRIGGER update_ventas_updated_at
  BEFORE UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabla detalle_ventas
CREATE TABLE public.detalle_ventas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venta_id uuid NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id),
  cantidad integer NOT NULL DEFAULT 1,
  precio_unitario numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.detalle_ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view detalle_ventas"
  ON public.detalle_ventas FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert detalle_ventas"
  ON public.detalle_ventas FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ventas WHERE id = venta_id AND usuario_id = auth.uid()
  ));

-- No UPDATE ni DELETE en detalle_ventas

-- Función de descuento automático de inventario
CREATE OR REPLACE FUNCTION public.descontar_inventario_venta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  cantidad_requerida numeric;
  nuevo_stock numeric;
BEGIN
  -- Para cada insumo en la receta del producto vendido
  FOR r IN
    SELECT recetas.insumo_id, recetas.cantidad_necesaria
    FROM recetas
    WHERE recetas.producto_id = NEW.producto_id
  LOOP
    cantidad_requerida := r.cantidad_necesaria * NEW.cantidad;
    
    UPDATE insumos
    SET stock_actual = stock_actual - cantidad_requerida
    WHERE id = r.insumo_id;
    
    -- Obtener nuevo stock para verificar
    SELECT stock_actual INTO nuevo_stock
    FROM insumos WHERE id = r.insumo_id;
    
    IF nuevo_stock < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para insumo %', r.insumo_id;
    END IF;
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Trigger que descuenta inventario al insertar detalle de venta
CREATE TRIGGER trigger_descontar_inventario
  AFTER INSERT ON public.detalle_ventas
  FOR EACH ROW
  EXECUTE FUNCTION public.descontar_inventario_venta();

-- Tabla de configuración para comisión bancaria
CREATE TABLE public.configuracion_ventas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clave text NOT NULL UNIQUE,
  valor numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.configuracion_ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view config"
  ON public.configuracion_ventas FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage config"
  ON public.configuracion_ventas FOR ALL
  USING (has_role(auth.uid(), 'administrador'));

-- Insertar comisión bancaria por defecto (3.5%)
INSERT INTO public.configuracion_ventas (clave, valor) VALUES ('comision_bancaria_porcentaje', 3.5);
-- IVA por defecto (16%)
INSERT INTO public.configuracion_ventas (clave, valor) VALUES ('iva_porcentaje', 16);
