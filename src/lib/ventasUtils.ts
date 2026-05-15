import { format } from 'date-fns';

/**
 * Shared sales query utilities to ensure consistency across all report tabs.
 *
 * Definitions (source of truth):
 * - A valid sale: ventas.estado = 'completada'
 * - Ingreso Total = total_neto + monto_propina
 * - Ingreso Gravable = total_neto  (includes IVA)
 * - Propina = monto_propina (non-taxable, separate line)
 * - IVA = total_neto - (total_neto / 1.16)
 * - Efectivo en Caja = monto_apertura + ventas_efectivo + entradas - salidas
 */

/** Build consistent CDMX date range strings for Supabase queries */
export function cdmxDateRange(desde: Date, hasta: Date) {
  return {
    desdeISO: format(desde, 'yyyy-MM-dd') + 'T00:00:00-06:00',
    hastaISO: format(hasta, 'yyyy-MM-dd') + 'T23:59:59-06:00',
  };
}

/** Format currency in MXN */
export function fmtMXN(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
