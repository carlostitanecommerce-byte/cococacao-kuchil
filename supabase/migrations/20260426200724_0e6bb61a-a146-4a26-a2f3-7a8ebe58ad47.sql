-- Hacer venta_id opcional para soportar órdenes KDS originadas desde coworking
ALTER TABLE public.kds_orders ALTER COLUMN venta_id DROP NOT NULL;

-- Enlazar la orden KDS a la sesión de coworking origen (cuando aplica)
ALTER TABLE public.kds_orders
ADD COLUMN IF NOT EXISTS coworking_session_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_kds_orders_coworking_session
ON public.kds_orders(coworking_session_id)
WHERE coworking_session_id IS NOT NULL;

COMMENT ON COLUMN public.kds_orders.coworking_session_id IS
  'Si la orden se originó desde una sesión de coworking (check-in o adición en vivo), enlaza con coworking_sessions.id. Permite mostrar contexto cliente/área en el KDS.';