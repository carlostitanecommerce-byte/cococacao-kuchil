import { supabase } from '@/integrations/supabase/client';

export interface CancelacionVentaInput {
  ventaId: string;
  total: number;
  motivo: string;
  coworkingSessionId: string | null;
  userId: string;
  /** Texto opcional para el log (nombre del admin). */
  actorNombre?: string;
  /** Marca si la venta corresponde a un turno cerrado. */
  postCierre?: boolean;
  cajaFolio?: number | null;
  /** Si la acción nace de aprobar una solicitud, se inyecta en metadata. */
  solicitudId?: string;
  /** Override de la acción que se escribe en audit_logs. */
  accionOverride?: string;
}

export interface CancelacionVentaResult {
  lineasOpenAccountReabiertas: number;
  stockRevertido: boolean;
  kdsCanceladas: number;
  coworkingRevertida: boolean;
}

/**
 * Orquesta una cancelación de venta consistente:
 *  1. Reabre líneas de cuenta abierta (venta_id = NULL).
 *  2. Restituye stock vía RPC `revertir_stock_venta`.
 *  3. Marca KDS ligadas como canceladas.
 *  4. Revierte la sesión de coworking si existe.
 *  5. Marca la venta como cancelada (paso final — antes de éste la venta sigue vigente).
 *  6. Inserta audit log enriquecido.
 *
 * Cada paso falla suave (excepto el 5, que es transaccionalmente la cancelación);
 * el resultado se incluye en el audit log para diagnóstico posterior.
 */
export async function ejecutarCancelacionVenta(
  input: CancelacionVentaInput,
): Promise<CancelacionVentaResult> {
  const {
    ventaId,
    total,
    motivo,
    coworkingSessionId,
    userId,
    actorNombre,
    postCierre = false,
    cajaFolio = null,
    solicitudId,
    accionOverride,
  } = input;

  const result: CancelacionVentaResult = {
    lineasOpenAccountReabiertas: 0,
    stockRevertido: false,
    kdsCanceladas: 0,
    coworkingRevertida: false,
  };

  // 1. Reabrir consumos de cuenta abierta
  try {
    const { data, error } = await supabase
      .from('detalle_ventas')
      .update({ venta_id: null })
      .eq('venta_id', ventaId)
      .not('coworking_session_id', 'is', null)
      .select('id');
    if (error) throw error;
    result.lineasOpenAccountReabiertas = data?.length ?? 0;
  } catch (err) {
    console.error('No se pudieron reabrir consumos de cuenta abierta', err);
  }

  // 2. Restituir stock (delegado de forma atómica al trigger trg_reintegrar_inventario_cancelacion de la BD)
  result.stockRevertido = true;

  // 3. Cancelar KDS
  try {
    const { data, error } = await supabase
      .from('kds_orders')
      .update({ estado: 'cancelada' as any })
      .eq('venta_id', ventaId)
      .select('id');
    if (error) throw error;
    result.kdsCanceladas = data?.length ?? 0;
  } catch (err) {
    console.error('No se pudieron cancelar KDS', err);
  }

  // 4. Revertir coworking
  if (coworkingSessionId) {
    try {
      const { error } = await supabase
        .from('coworking_sessions')
        .update({ estado: 'pendiente_pago' as any, fecha_salida_real: null })
        .eq('id', coworkingSessionId);
      if (error) throw error;
      result.coworkingRevertida = true;
    } catch (err) {
      console.error('No se pudo revertir sesión de coworking', err);
    }
  }

  // 5. Marcar venta como cancelada (paso crítico)
  const { error: ventaErr } = await supabase
    .from('ventas')
    .update({ estado: 'cancelada' as any, motivo_cancelacion: motivo })
    .eq('id', ventaId);
  if (ventaErr) throw ventaErr;

  // 6. Audit log enriquecido
  const accion = accionOverride ?? (postCierre ? 'correccion_post_cierre' : 'cancelar_venta');
  const descripcion = postCierre
    ? `Corrección post-cierre: cancelación de venta $${total.toFixed(2)} (turno ${cajaFolio ? `#${String(cajaFolio).padStart(4, '0')}` : 'cerrado'}) por ${actorNombre ?? 'Admin'}. Motivo: ${motivo}`
    : `Venta $${total.toFixed(2)} cancelada por ${actorNombre ?? 'Admin'}. Motivo: ${motivo}`;

  await supabase.from('audit_logs').insert({
    user_id: userId,
    accion,
    descripcion,
    metadata: {
      venta_id: ventaId,
      total,
      motivo,
      lineas_open_account_reabiertas: result.lineasOpenAccountReabiertas,
      stock_revertido: result.stockRevertido,
      kds_canceladas: result.kdsCanceladas,
      coworking_session_revertida: result.coworkingRevertida,
      correccion_post_cierre: postCierre,
      ...(cajaFolio ? { caja_folio: cajaFolio } : {}),
      ...(solicitudId ? { solicitud_id: solicitudId } : {}),
    },
  });

  return result;
}
