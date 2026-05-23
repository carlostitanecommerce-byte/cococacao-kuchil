# Plan P0 — Historial de Ventas Procesadas (2 sprints)

Ejecuta los 6 puntos P0 de la auditoría, ajustando P0.1 + P0.3 al modelo "admin sin restricciones / operativo acotado al turno activo" que pediste. Sin cambios de diseño global.

---

## Sprint 1 — Visibilidad, permisos y auditoría (P0.1, P0.3, P0.5, P0.6)

Objetivo: que cada rol vea y pueda actuar solo sobre lo que le corresponde, y que toda acción quede trazada.

### S1.1 Filtro por rol en `VentasTurnoPanel.tsx` (sustituye P0.1 + P0.3)

- Recibir `cajaAbierta` como prop desde `CajaPage` (ya disponible en el page).
- Lógica de query según rol:
  - **Admin:** sin filtro por `caja_id`. Date picker libre (cualquier fecha pasada). Comportamiento actual extendido.
  - **No-admin (caja/recepción/supervisor operativo):** forzar `eq('caja_id', cajaAbierta.id)`. Date picker oculto o fijado a "Turno actual" (no se permite navegar a otras fechas).
- Traer `caja_id` en el select y, para admins, también el `estado` de la caja asociada (join en memoria con un fetch paralelo de cajas por id, o `select('*, cajas:caja_id(estado, folio)')`).
- Renombrar dinámicamente el título:
  - Admin: "Historial de Ventas" (con selector de fecha).
  - No-admin: "Ventas del turno actual (#folio)".
- Mostrar columna/badge `#caja.folio` cuando el rol es admin (trazabilidad cruzada de turnos).

### S1.2 Permisos de acciones por rol y estado de caja

- **Admin:**
  - Cancelar y cambiar método: siempre habilitados.
  - Si la venta pertenece a un **turno cerrado**, los diálogos se abren en modo "Corrección post-cierre":
    - Banner amarillo de advertencia: "Esta venta pertenece a un turno ya cerrado. El cambio afecta reportes históricos y se registrará como corrección."
    - Motivo **obligatorio** y con `minLength = 10` (refuerzo sobre el actual `trim() > 0`).
    - Audit log con `accion = 'correccion_post_cierre'` y `metadata.tipo_correccion = 'cancelacion' | 'cambio_metodo_pago'`, `metadata.caja_id`, `metadata.caja_estado_al_momento = 'cerrada'`.
  - Si la venta es del turno abierto: audit log con la acción normal (`cancelar_venta` / `cambio_metodo_pago`) como hoy.
- **No-admin:**
  - Solo botón "Solicitar cancelación" (reutiliza `CancelVentaDialog` rama `handleSendRequest`, que ya existe).
  - Nunca botón cancelar directo ni cambiar método (esos quedan ocultos para no-admin).
  - Como solo ve su turno activo, no puede tocar ventas históricas.

### S1.3 Auditoría de reimpresiones (P0.5) en `TicketReimprimirDialog.tsx`

- En el handler de `window.print()`, insertar antes de imprimir:
  ```ts
  supabase.from('audit_logs').insert({
    user_id: user.id,
    accion: 'reimpresion_ticket',
    descripcion: `Reimpresión de ticket #${folio} ($${total})`,
    metadata: { venta_id, folio, total_neto, monto_propina, usuario_atendio: usuarioNombre },
  });
  ```
- Sin bloquear la impresión si el insert falla (log a consola). Mostrar toast informativo "Reimpresión registrada".

### S1.4 Solicitud de cancelación para no-admin (P0.6)

- Cubierto por S1.1 + S1.2 (el botón aparece para no-admin con `isAdmin=false` ya implementado en `CancelVentaDialog`).
- Verificación: roles operativos pueden iniciar el flujo de `solicitudes_cancelacion` desde Caja sin pasar por POS.

### Archivos sprint 1

- `src/components/caja/VentasTurnoPanel.tsx`
- `src/components/caja/CajaCheckoutPanel` (no se toca)
- `src/components/caja/CancelVentaDialog.tsx` (añadir `cajaEstado?: 'abierta' | 'cerrada'` prop + lógica post-cierre)
- `src/components/caja/CambiarMetodoPagoDialog.tsx` (mismo prop + banner post-cierre)
- `src/components/caja/TicketReimprimirDialog.tsx` (audit insert + necesita `useAuth`)
- `src/pages/CajaPage.tsx` (pasar `cajaAbierta` al panel)

### Verificación sprint 1

- Login como **caja** con caja abierta: solo ve ventas del turno actual, sin selector de fecha, único botón = "Solicitar cancelación".
- Login como **admin**: ve todas las ventas, navega fechas, ve folio de caja en la tabla. Edita una venta del turno cerrado → aparece banner amarillo, motivo mínimo 10 chars, audit log con `accion='correccion_post_cierre'`.
- Reimprimir ticket → fila nueva en `audit_logs` con `accion='reimpresion_ticket'`.

---

## Sprint 2 — Integridad transaccional (P0.2, P0.4)

Objetivo: que cancelar o cambiar método de pago deje el sistema consistente (caja, stock, coworking, KDS, comisiones).

### S2.1 Recalcular comisiones bancarias en cambio de método (P0.2)

- Crear helper `src/lib/ventasUtils.ts → calcularComisionBancaria(montoTarjeta: number, propinaEnTarjeta: number): number` aplicando 3.5% sobre `max(0, montoTarjeta - propinaEnTarjeta)` (regla ya documentada en memory `accounting-export-unified`).
- En `CambiarMetodoPagoDialog.handleConfirm`:
  - Calcular `comisiones_bancarias` nuevo (suponer que en mixto la propina sigue siendo digital si el método nuevo incluye tarjeta; reusar valor existente de `venta.monto_propina`).
  - Incluir el campo en el `update` a `ventas`.
- Migración red de seguridad: trigger `BEFORE UPDATE OF metodo_pago, monto_tarjeta, monto_propina ON ventas` que recalcula `comisiones_bancarias` usando la misma fórmula. Garantiza consistencia si en el futuro otro flujo edita la venta.

### S2.2 Cancelación de venta robusta (P0.4) en `CancelVentaDialog.handleAdminCancel`

Orquestar en este orden (con manejo de errores y rollback parcial vía toasts):

1. **Reabrir consumos de cuenta abierta:**
   ```sql
   UPDATE detalle_ventas
     SET venta_id = NULL
     WHERE venta_id = :venta_id
       AND open_account_detalle_id IS NOT NULL;
   ```
   (vía supabase client). Las líneas quedan disponibles para reimportarse desde la sesión.

2. **Restituir stock** — nueva función SQL:
   ```sql
   CREATE OR REPLACE FUNCTION public.revertir_stock_venta(_venta_id uuid)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
   BEGIN
     UPDATE insumos i
       SET stock_actual = stock_actual + sub.qty_repuesta
       FROM (
         SELECT r.insumo_id, SUM(r.cantidad_necesaria * dv.cantidad) AS qty_repuesta
         FROM detalle_ventas dv
         JOIN recetas r ON r.producto_id = dv.producto_id
         WHERE dv.venta_id = _venta_id
           AND dv.tipo_concepto = 'producto'
         GROUP BY r.insumo_id
       ) sub
       WHERE i.id = sub.insumo_id;
   END;
   $$;
   ```
   Llamar via `supabase.rpc('revertir_stock_venta', { _venta_id })`.

3. **Revertir KDS:** `UPDATE kds_orders SET estado='cancelada' WHERE venta_id = :venta_id` (cocina recibe la reversa por realtime ya existente).

4. **Revertir coworking session** (ya existe): a `pendiente_pago` + `fecha_salida_real = null`. Mantener `monto_acumulado` tal cual (lo que pague el cliente al re-cobrarse se recalculará en el próximo checkout).

5. **Update venta** a `cancelada` + `motivo_cancelacion`.

6. **Audit log enriquecido:**
   ```ts
   metadata: {
     venta_id, total: venta.total_neto, motivo,
     lineas_open_account_reabiertas: <count>,
     stock_revertido: true,
     kds_canceladas: <count>,
     coworking_session_revertida: !!venta.coworking_session_id,
     correccion_post_cierre: caja.estado === 'cerrada',
   }
   ```

Ejecutar pasos 1-5 secuencialmente con `try/catch`; si falla el paso 5 (update venta) se notifica al admin con el detalle de qué pasos sí se aplicaron para revisión manual (no hay transacciones cliente, por eso es importante el orden: la venta queda como `completada` hasta el final).

### S2.3 Aceptación admin de solicitudes de cancelación

- `SolicitudesCancelacionPanel` debe reusar `handleAdminCancel` (mismo helper extraído) para que al aprobar una solicitud también se ejecuten los pasos 1-4. Extraer la lógica a `src/lib/cancelacionVentaUtils.ts → ejecutarCancelacionVenta(venta, motivo, user)`.

### Archivos sprint 2

- `src/lib/ventasUtils.ts` (helper comisión)
- `src/lib/cancelacionVentaUtils.ts` (nuevo, orquestación reutilizable)
- `src/components/caja/CambiarMetodoPagoDialog.tsx`
- `src/components/caja/CancelVentaDialog.tsx`
- `src/components/caja/SolicitudesCancelacionPanel.tsx`
- Migraciones SQL:
  - función `revertir_stock_venta(uuid)`
  - trigger `recalc_comisiones_bancarias` sobre `ventas`

### Verificación sprint 2

- Cambiar método de venta tarjeta→efectivo: `comisiones_bancarias` pasa a 0 en DB. Reporte contable refleja el cambio.
- Cambiar método efectivo→tarjeta $500 con propina $50: `comisiones_bancarias = (500-50) * 0.035 = 15.75`.
- Cancelar venta con consumos de cuenta abierta: `detalle_ventas.venta_id` queda NULL para esas líneas, `coworking_sessions.estado='pendiente_pago'`, al re-importar la sesión los consumos reaparecen.
- Cancelar venta de producto con receta: `insumos.stock_actual` aumenta por la cantidad consumida.
- Cancelar venta con KDS: tarjeta cocina pasa a `cancelada`.
- Admin aprueba una solicitud pendiente: mismos efectos.

---

## Resumen de entregables

```text
Sprint 1 (UX + permisos + trazabilidad)
  6 archivos tocados, 0 migraciones.
  Riesgo: bajo. Cambios aislados al panel de caja.

Sprint 2 (integridad de datos)
  5 archivos + 2 migraciones (función SQL + trigger).
  Riesgo: medio. Requiere prueba en staging con ventas de prueba que cubran:
    - venta simple efectivo
    - venta mixta con propina
    - venta con cuenta abierta de coworking
    - venta de productos con receta multi-insumo
```

Confirma para arrancar Sprint 1, o pide ajustes (p.ej. qué roles consideras "operativos" para el filtro estricto, o si supervisor debe ver todas las ventas como admin).
