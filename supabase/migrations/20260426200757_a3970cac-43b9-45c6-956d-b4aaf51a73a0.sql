-- Secuencia exclusiva para folios KDS de coworking (independiente de ventas)
CREATE SEQUENCE IF NOT EXISTS public.kds_coworking_folio_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- Función segura que entrega el siguiente folio
CREATE OR REPLACE FUNCTION public.next_kds_coworking_folio()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nextval('public.kds_coworking_folio_seq')::integer;
$$;

GRANT EXECUTE ON FUNCTION public.next_kds_coworking_folio() TO authenticated;