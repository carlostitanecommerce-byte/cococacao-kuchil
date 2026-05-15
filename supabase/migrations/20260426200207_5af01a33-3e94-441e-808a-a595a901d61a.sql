-- 1. Eliminar el trigger destructivo: ahora la limpieza es responsabilidad del flujo de cancelación con auditoría de entregas
DROP TRIGGER IF EXISTS trg_cleanup_session_upsells_on_cancel ON public.coworking_sessions;
DROP FUNCTION IF EXISTS public.cleanup_session_upsells_on_cancel();

-- 2. Añadir columna para guardar items entregados en solicitudes de cancelación
ALTER TABLE public.solicitudes_cancelacion_sesiones
ADD COLUMN IF NOT EXISTS items_entregados jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.solicitudes_cancelacion_sesiones.items_entregados IS
  'Array de {producto_id, cantidad} marcados por el solicitante como realmente entregados al cliente. El admin puede ajustarlos antes de aprobar.';