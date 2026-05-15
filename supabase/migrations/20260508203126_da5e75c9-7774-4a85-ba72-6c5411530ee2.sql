-- Crear bucket público para imágenes de productos
INSERT INTO storage.buckets (id, name, public)
VALUES ('productos', 'productos', true)
ON CONFLICT (id) DO NOTHING;

-- Políticas de acceso
CREATE POLICY "Productos images are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'productos');

CREATE POLICY "Admins can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'productos' AND has_role(auth.uid(), 'administrador'::app_role));

CREATE POLICY "Admins can update product images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'productos' AND has_role(auth.uid(), 'administrador'::app_role));

CREATE POLICY "Admins can delete product images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'productos' AND has_role(auth.uid(), 'administrador'::app_role));