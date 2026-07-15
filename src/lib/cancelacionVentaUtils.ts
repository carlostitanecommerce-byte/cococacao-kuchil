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
 * Cancela una venta de forma atómica via RPC `cancelar_venta_completa`.
 *
 * Todo ocurre en una sola transacción SQL:
 *  1. Reintegra stock de items POS (no-coworking) via recetas.
 *  2. Reabre líneas de cuenta abierta coworking (venta_id → NULL) sin tocar stock
 *     (su stock ya fue descontado por registrar_consumo_coworking).
 *  3. Cancela órdenes KDS asociadas.
 *  4. Revierte la sesión de coworking a pendiente_pago.
 *  5. Marca la venta como cancelada (el trigger reintegrar_inventario_cancelacion
 *     se encarga de reintegrar stock de items POS restantes).
 *  6. Inserta audit log enriquecido.
 *
 * Si cualquier paso falla, toda la transacción se revierte automáticamente.
 */
export async function ejecutarCancelacionVenta(
  input: CancelacionVentaInput,
): Promise<CancelacionVentaResult> {
  const {
    ventaId,
    motivo,
    postCierre = false,
    cajaFolio = null,
    solicitudId,
    accionOverride,
  } = input;

  const { data, error } = await supabase.rpc('cancelar_venta_completa', {
    p_venta_id: ventaId,
    p_motivo: motivo,
    p_post_cierre: postCierre,
    p_caja_folio: cajaFolio,
    p_solicitud_id: solicitudId ?? null,
    p_accion_override: accionOverride ?? null,
  });

  if (error) throw error;

  const res = data as unknown as {
    ok: boolean;
    lineas_open_account_reabiertas: number;
    stock_revertido: boolean;
    kds_canceladas: number;
    coworking_revertida: boolean;
  };

  return {
    lineasOpenAccountReabiertas: res?.lineas_open_account_reabiertas ?? 0,
    stockRevertido: res?.stock_revertido ?? true,
    kdsCanceladas: res?.kds_canceladas ?? 0,
    coworkingRevertida: res?.coworking_revertida ?? false,
  };
}

