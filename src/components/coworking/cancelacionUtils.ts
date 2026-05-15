import { supabase } from '@/integrations/supabase/client';

export interface SessionUpsellRow {
  id: string;
  producto_id: string;
  precio_especial: number;
  cantidad: number;
  nombre: string;
  isAmenity: boolean;
}

/**
 * Carga los amenities + extras asociados a una sesión, listos para
 * mostrarse en el diálogo de verificación de entregas.
 */
export async function fetchSessionUpsellsForCancel(
  sessionId: string,
): Promise<SessionUpsellRow[]> {
  const { data, error } = await supabase
    .from('detalle_ventas')
    .select('id, producto_id, precio_unitario, cantidad, tipo_concepto, productos:producto_id(nombre)')
    .eq('coworking_session_id', sessionId)
    .is('venta_id', null)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return (data as any[]).map(u => ({
    id: u.id,
    producto_id: u.producto_id,
    precio_especial: Number(u.precio_unitario) || 0,
    cantidad: u.cantidad,
    nombre: u.productos?.nombre ?? 'Producto',
    isAmenity: u.tipo_concepto === 'amenity' || Number(u.precio_unitario) === 0,
  }));
}

export interface EntregaItem {
  producto_id: string;
  nombre: string;
  cantidad: number;
}

export interface CancelarSesionResult {
  ok: boolean;
  mermasCreadas: number;
  entregadosCount: number;
  error?: string;
}

/**
 * Cancela una sesión de forma atómica vía RPC `cancelar_sesion_coworking`.
 * Toda la lógica (mermas, descuento de stock, limpieza de upsells, update de
 * sesión, cierre de solicitud y audit log) ocurre en una sola transacción
 * en el servidor. Si algo falla, nada se aplica.
 */
export async function cancelarSesionAtomico(params: {
  sessionId: string;
  motivo: string;
  entregados: EntregaItem[];
  isAdmin: boolean;
  solicitudId?: string;
}): Promise<CancelarSesionResult> {
  const { sessionId, motivo, entregados, isAdmin, solicitudId } = params;

  const { data, error } = await supabase.rpc('cancelar_sesion_coworking' as any, {
    p_session_id: sessionId,
    p_motivo: motivo,
    p_entregados: entregados as any,
    p_solicitud_id: solicitudId ?? null,
    p_is_admin: isAdmin,
  });

  if (error) {
    return {
      ok: false,
      mermasCreadas: 0,
      entregadosCount: 0,
      error: error.message,
    };
  }

  const result = data as { ok: boolean; mermas_creadas: number; entregados_count: number };
  return {
    ok: result?.ok === true,
    mermasCreadas: result?.mermas_creadas ?? 0,
    entregadosCount: result?.entregados_count ?? 0,
  };
}
