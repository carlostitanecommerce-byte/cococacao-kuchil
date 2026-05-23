import { format } from 'date-fns';

/**
 * Shared sales calculation utilities — SINGLE SOURCE OF TRUTH.
 *
 * Definitions (cobrar al cliente vs. ingreso al negocio):
 * - Cobrado al cliente   = total_bruto + monto_propina   (UI: ticket, historial, diálogos cara al cajero)
 * - Ingreso neto negocio = total_neto  + monto_propina   (reportes contables, cierre de caja)
 * - Subtotal sin IVA     = total_bruto − iva             (base facturable; no se ve afectada por comisión bancaria)
 * - IVA                  = total_bruto − (total_bruto / 1.16)  (16% incluido en total_bruto)
 * - Comisión bancaria    = total_bruto − total_neto      (la come el negocio, NO el cliente)
 *
 * Reglas:
 * - Una venta válida tiene ventas.estado = 'completada'.
 * - monto_propina nunca es gravable y se suma como línea aparte.
 * - Cualquier vista que muestre "lo que pagó el cliente" debe usar montoCobrado().
 *   Cualquier reporte de ingresos para el negocio debe usar ingresoNeto().
 * - Efectivo en Caja = monto_apertura + ventas_efectivo + entradas − salidas.
 */

type VentaTotales = {
  total_bruto?: number | null;
  total_neto?: number | null;
  monto_propina?: number | null;
  iva?: number | null;
};

const n = (v: number | null | undefined): number => Number(v ?? 0);

/** Lo que el cliente pagó en su terminal/efectivo (incluye propina, sin descontar comisión bancaria). */
export function montoCobrado(v: VentaTotales): number {
  return +(n(v.total_bruto) + n(v.monto_propina)).toFixed(2);
}

/** Ingreso real que entra al negocio (después de comisión bancaria, incluye propina). */
export function ingresoNeto(v: VentaTotales): number {
  return +(n(v.total_neto) + n(v.monto_propina)).toFixed(2);
}

/** Subtotal facturable sin IVA, basado en lo cobrado al cliente (no en el neto del negocio). */
export function subtotalSinIva(v: VentaTotales): number {
  return +(n(v.total_bruto) - n(v.iva)).toFixed(2);
}

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
