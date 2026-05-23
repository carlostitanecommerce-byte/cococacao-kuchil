## Plan: Endurecer "Ticket activo" en /caja (puntos 1-4 de la auditoría)

Alcance: solo los 4 puntos críticos detectados. No se toca diseño general ni flujos no relacionados.

---

### 1. Bloquear edición/eliminación de líneas de cuenta abierta

**Problema:** las líneas importadas desde la cuenta abierta (`open_account_detalle_id` presente) ya viven en `detalle_ventas` con `venta_id NULL`. Hoy el panel solo bloquea por `tipo_concepto === 'coworking'`; un producto/amenity importado se puede editar cantidad (cambia la DB silenciosamente y desincroniza KDS/inventario) o borrar (deja la fila huérfana para siempre).

**Cambio en `src/components/caja/CajaCheckoutPanel.tsx`:**
- Reemplazar la condición `esCoworking` por `esReadOnly = item.tipo_concepto === 'coworking' || !!item.open_account_detalle_id`.
- Para líneas readonly: ocultar +/- y trash, mostrar `×N` y un badge pequeño "Cuenta abierta" (o "Coworking" para las del cargo de tiempo) para que el cajero entienda por qué no son editables.
- Mantener el flujo: si se quiere modificar una línea de cuenta abierta, debe hacerse desde Coworking → ManageSessionAccount o vía la solicitud de cancelación de ítems ya existente.

### 2. Re-validación de stock al subir cantidad en el panel

**Problema:** `updateQty(+1)` aumenta sin llamar a `validar_stock_carrito`. El cajero arma un ticket inválido y solo se entera al cobrar.

**Cambio en `src/components/caja/CajaCheckoutPanel.tsx`:**
- Crear un handler `handleIncrement(item)` que, antes de llamar `updateQty(key, 1)`:
  - Para `tipo_concepto === 'producto'` simple: llamar `verificarStock(producto_id, cantidad + 1)` (hook ya existente, ya distingue red vs. negocio).
  - Para `tipo_concepto === 'paquete'` con `componentes`/`opciones`: llamar `validar_stock_carrito` con el carrito tentativo (mismo patrón que `PosPage.handleUpdateQty`), pasando `coworking_session_id` si aplica para que la RPC reste consumos abiertos.
  - Si falla por negocio: toast con el mensaje devuelto y NO incrementar. Si falla por red: toast de red y no incrementar.
- Saltar la validación para líneas readonly (no aplica, ya bloqueadas en #1).
- Antes de `handleCobrar`, mantener la validación final tal como está como red de seguridad.

### 3. Reset de `propinaEnDigital` y consistencia en mixto

**Problema:** al cambiar de método de pago, `propinaEnDigital` queda con su valor anterior; en "mixto" el checkbox está oculto pero la fórmula `tarjetaBaseProductos` lo sigue consultando, restando comisión bajo un supuesto que el cajero no ve.

**Cambios en `src/components/caja/CajaCheckoutPanel.tsx`:**
- Envolver `setMetodoPago` en un handler que también ejecute `setPropinaEnDigital(false)` cuando el nuevo método sea `efectivo`, `transferencia` o `mixto` (solo `tarjeta` puede mantenerlo `true` por elección explícita).
- Mostrar el checkbox "Propina cobrada por terminal" también en `mixto` cuando `propina > 0` y `mixed.tarjeta > 0`, con etiqueta clara ("Propina incluida en el monto de tarjeta"). Mantener oculto si el cajero pone $0 en tarjeta.
- Ajustar `tarjetaBaseProductos` para usar el flag solo cuando hay monto en tarjeta; documentar con un comentario corto la regla.

### 4. Hardening del `caja_id` en el cobro

**Problema:** si se cierra la caja desde otra pestaña, `cajaAbierta` queda `null` y `caja_id` se envía `undefined`, rompiendo reportes y conciliación.

**Cambio en `src/components/caja/CajaCheckoutPanel.tsx` (`handleCobrar`):**
- Validar al inicio: si `!cajaAbierta?.id`, mostrar toast "La caja se cerró. Reabre una caja para cobrar." y abortar sin abrir `ConfirmVentaDialog`.
- Deshabilitar también el botón "Cobrar" cuando `!cajaAbierta`.
- En `useCajaSession`, si ya hay realtime, asegurar que el cierre en otra pestaña refresque `cajaAbierta` (revisar suscripción; si falta, agregar listener de `postgres_changes` sobre `cajas`).

---

### Archivos a tocar

- `src/components/caja/CajaCheckoutPanel.tsx` (1, 2, 3, 4)
- `src/hooks/useCajaSession.ts` (4, solo si falta listener realtime)
- Sin migraciones; sin cambios de DB.

### Verificación

1. Importar sesión con consumos POS abiertos → intentar +/-/borrar producto importado: botones ausentes; cambiar cantidad solo posible desde Coworking.
2. Producto con stock 2 ya en ticket × 2 → click "+": toast "Sin stock suficiente"; cantidad sigue en 2.
3. Marcar propina digital en tarjeta → cambiar a efectivo → comisión = 0, checkbox resetea. Cambiar a mixto con tarjeta > 0 → checkbox visible y aplica solo si está marcado.
4. Abrir cobro, cerrar caja desde otra pestaña, intentar "Cobrar": botón deshabilitado y toast informativo; no se crea venta sin `caja_id`.
