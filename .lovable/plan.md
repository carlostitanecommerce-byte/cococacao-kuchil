# Plan: Corregir cálculos de totales en Historial de Ventas y Ticket

## Diagnóstico (folio 118 del 22 de mayo)

Datos reales en la base de datos:

| Campo                  | Valor   | Significado                                              |
|------------------------|---------|----------------------------------------------------------|
| `total_bruto`          | 150.00  | Subtotal de productos (paquete), IVA **incluido**        |
| `iva`                  | 20.69   | IVA contenido dentro de `total_bruto` (150 − 150/1.16)   |
| `monto_propina`        | 15.00   | Propina (no gravable)                                    |
| `comisiones_bancarias` | 5.25    | 3.5% sobre `total_bruto` (cobro con tarjeta)             |
| `total_neto`           | 144.75  | `total_bruto − comisiones_bancarias` (lo que entra neto) |
| `monto_tarjeta`        | 165.00  | Lo que realmente cargó el cliente en la terminal         |

**El cliente pagó $165.** El cajero ve **$144.75** en el historial y **$159.75** como TOTAL en el ticket. Ambos son incorrectos para la perspectiva de cobro al cliente.

## Causa raíz

La doctrina del proyecto (`src/lib/ventasUtils.ts`) define dos conceptos legítimos:

- **Cobrado al cliente** = `total_bruto + monto_propina` — lo que pagó el cliente en su terminal/efectivo, indistinto de la comisión que descuente el banco. Aplica en UI cara al cliente/cajero.
- **Ingreso neto del negocio** = `total_neto + monto_propina` — qué entra a la empresa después de la comisión bancaria del adquirente. Aplica en reportes contables.

El error es que en la UI orientada al cliente y al cajero (historial, ticket, diálogos de cambio/cancelación) se está mostrando el **ingreso neto** en lugar del **cobrado al cliente**. Eso confunde porque no coincide con el comprobante físico del POS ni con lo que el cliente recuerda haber pagado.

Adicionalmente, en el ticket reimprimido el "Subtotal (sin IVA)" se calcula como `total_neto − iva` (= 124.06), restando dos veces la comisión bancaria del cálculo: el subtotal facturable debe ser `total_bruto − iva` (= 129.31).

## Cambios

### 1. `src/lib/ventasUtils.ts` — helpers canónicos + doctrina actualizada

Reescribir el comentario doctrinal para que diga **explícitamente**:

```
- Cobrado al cliente   = total_bruto + monto_propina   (UI: ticket, historial, diálogos)
- Ingreso neto negocio = total_neto  + monto_propina   (reportes contables, cierre caja)
- Subtotal sin IVA     = total_bruto − iva             (base facturable)
- IVA                  = total_bruto − (total_bruto / 1.16)
- Comisión bancaria    = total_bruto − total_neto      (la come el negocio, no el cliente)
```

Agregar tres funciones puras (`montoCobrado`, `ingresoNeto`, `subtotalSinIva`) que reciban un objeto con los campos relevantes y devuelvan el número, para que ningún componente reinvente la fórmula.

### 2. `src/components/caja/VentasTurnoPanel.tsx` (línea 267)

Columna "Total" del historial: cambiar `v.total_neto` por `montoCobrado(v)` (= `total_bruto + monto_propina`). Esta es la cifra que cuadra con el ticket y con lo que cargaron al cliente.

### 3. `src/components/caja/TicketReimprimirDialog.tsx`

- Línea 140: `subtotalSinIva = total_bruto − iva` (antes usaba `total_neto`).
- Línea 219 (TOTAL grande del ticket): `total_bruto + monto_propina` en vez de `total_neto + monto_propina`.
- Línea 56 (audit log de reimpresión): mismo ajuste para que el log refleje lo cobrado al cliente.
- Extender la interfaz `VentaResumen` con `total_bruto: number`.

### 4. `src/components/caja/VentasTurnoPanel.tsx` — propagación de `total_bruto`

- **Query Supabase (línea 79):** agregar `total_bruto` al `select(...)`.
- **Interfaz `VentaTurno` (líneas 21-39):** agregar `total_bruto: number`.
- **Propagación a hijos:** confirmar que el objeto `v` se pasa íntegro como prop `venta` a:
  - `<CambiarMetodoPagoDialog venta={editPagoVenta} ... />` (línea 338) — ya pasa el objeto completo, por lo que `total_bruto` viaja gratis al ampliar la interfaz.
  - `<CancelVentaDialog venta={cancelVenta} ... />` (línea 329) — idem.
  - `<TicketReimprimirDialog venta={reprintVenta as any} ... />` (línea 346) — idem; remover el `as any` si las interfaces ya coinciden.

### 5. `src/components/caja/CambiarMetodoPagoDialog.tsx` (línea 51)

- Añadir `total_bruto: number` a la interfaz `VentaResumen` local.
- `totalVenta = total_bruto + monto_propina` (antes usaba `total_neto + monto_propina`). Esto es lo que el cajero ve para validar el desglose mixto: debe coincidir con lo que el cliente paga.

### 6. `src/components/caja/CancelVentaDialog.tsx`

- Añadir `total_bruto: number` (y confirmar `monto_propina: number`) a la interfaz `VentaBasic` local.
- **Panel de resumen visible (línea 144):** mostrar `${(venta.total_bruto + venta.monto_propina).toFixed(2)}` en lugar de `venta.total_neto.toFixed(2)`.
- **`handleSendRequest` (líneas 54, 97-98):** registrar en el audit log y en el campo `total` del payload el monto **cobrado al cliente** (`total_bruto + monto_propina`), porque eso es lo que el cliente espera ver reembolsado o cancelado.

### 7. `src/components/caja/SolicitudesCancelacionPanel.tsx`

- **Query (línea 56):** agregar `total_bruto, monto_propina` al `select('id, total_neto, fecha')` para que `venta_total` se calcule con la cifra correcta.
- **Query (línea 92):** agregar `total_bruto, monto_propina` al select de aprobación.
- Cambiar `ventaMap.get(s.venta_id)?.total_neto ?? 0` y los usos de `ventaData.total_neto` por `total_bruto + monto_propina`.

### 8. `src/components/caja/ConfirmVentaDialog.tsx` (vista de ticket pos-venta, líneas 501, 517-519)

Verificar coherencia con el ticket reimpreso: el "Subtotal (sin IVA)" en `ticket.subtotal − ticket.iva` está correcto aquí porque `ticket.subtotal` ya es el bruto vivo del carrito (`summary.subtotal`), no `total_neto`. El TOTAL ya usa `summary.total = subtotal + propina`, también correcto. **No requiere cambio**, pero se documenta para evitar regresiones.

### Lo que NO se toca

- `total_bruto` y `total_neto` en `ventas` permanecen como están: la separación es correcta y necesaria para contabilidad.
- `GeneralTab.tsx` (reportes) sigue usando `total_neto` para "Ingreso Gravable" — eso es correcto contablemente.
- `CierreCajaDialog.tsx` usa `total_neto` para el resumen del cierre: es el ingreso real para el negocio (el banco deposita el neto, no el bruto). **Es el dato correcto** para arqueo.
- Trigger `recalc_comisiones_bancarias` y migraciones SQL: sin cambios.

## Verificación

Tras los cambios, para folio 118 se debe ver:

- Historial → columna Total: **$165.00**.
- Ticket reimpreso:
  - Subtotal (sin IVA): **$129.31**
  - IVA: $20.69
  - Propina: +$15.00
  - **TOTAL: $165.00**
- Diálogo "Cambiar método": Total a cuadrar = **$165.00**.
- Diálogo "Cancelar venta": resumen = **$165.00**, audit log registra $165.00.
- Panel de solicitudes de cancelación: `venta_total` = **$165.00**.
- Reporte General → Ingreso Gravable sigue mostrando $144.75 (sin cambio, correcto contablemente).

Se valida visualmente abriendo la venta folio 118 en `/caja` y reimprimiendo el ticket.
