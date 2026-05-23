## Plan: Refinamientos finales del "Ticket activo" en /caja (puntos 5-8)

Alcance: solo los 4 puntos recomendados de la auditoría. Sin cambios de diseño global ni en flujos no relacionados.

---

### 5. Documentar y exponer la regla de propina en pago mixto

**Problema:** la fórmula `tarjetaBaseProductos` asume que la propina digital va dentro de `mixed.tarjeta` cuando `propinaEnDigital === true`, pero el cajero no ve esa suposición y puede armar mixtos donde la propina realmente se cobró en otro canal.

**Cambios en `src/components/caja/CajaCheckoutPanel.tsx`:**
- Bajo la grilla de distribución mixta, cuando `propinaEnDigital === true` y `mixed.tarjeta > 0`, mostrar una nota pequeña: "Se asume que los $X de propina están incluidos en el monto de tarjeta. La comisión bancaria se calcula sobre el resto."
- Validar antes de habilitar "Cobrar": si `propinaEnDigital === true` en mixto y `mixed.tarjeta < propina`, marcar mixto inválido con mensaje "El monto de tarjeta debe cubrir al menos la propina digital ($X)".
- Comentar la regla en el bloque de `tarjetaBaseProductos` para documentar la fuente de verdad.

### 6. Límites y alertas en propina manual

**Problema:** la propina manual acepta cualquier número, incluso valores absurdos (ej. 100x el subtotal) sin advertencia.

**Cambios en `src/components/caja/CajaCheckoutPanel.tsx`:**
- Calcular `propinaPctSobreSubtotal = subtotal > 0 ? propina / subtotal * 100 : 0`.
- Si `propinaPctSobreSubtotal > 50`, mostrar warning amarillo bajo el input manual: "Propina inusualmente alta (X% del subtotal). Confirma con el cliente." (no bloquea, solo alerta).
- Si `propina > subtotal`, mostrar error rojo y deshabilitar "Cobrar": "La propina no puede exceder el subtotal del ticket."
- Mantener `min={0}` y agregar tope duro razonable (p. ej. `max={subtotal * 2}`) solo como hint del input, pero la validación efectiva la hace el chequeo de arriba.

### 7. Indicador visual de líneas de cuenta abierta

**Estado:** ya implementado en el cambio previo (badge "Cuenta abierta" con ícono de candado en cada línea con `open_account_detalle_id`, y badge "Coworking" en cargos de tiempo).

**Refinamiento adicional:**
- Agregar un encabezado/contador discreto arriba de la lista cuando hay líneas readonly: "N línea(s) de cuenta abierta (no editables aquí)" con tooltip que explique que deben modificarse desde Coworking → Administrar cuenta.
- Aplicar un fondo sutil (`bg-muted/30`) a las líneas readonly para reforzar la diferenciación visual a un golpe de vista.

### 8. `clear()` deja líneas huérfanas de cuenta abierta

**Problema:** al pulsar "Limpiar" con una sesión de coworking importada, el carrito local se vacía pero las filas en `detalle_ventas` (con `venta_id NULL` y `coworking_session_id` apuntando a la sesión) siguen vivas. Si después se vuelve a importar la sesión, reaparecen — eso es correcto. Pero si el cajero entiende "Limpiar" como "cancelar/abandonar el cobro", queda confundido sobre el estado.

**Cambios:**

**8.a `src/components/caja/CajaCheckoutPanel.tsx`:**
- Reemplazar `onClick={clear}` por un handler `handleLimpiar` que:
  - Si hay `coworkingSessionId` y al menos una línea con `open_account_detalle_id`: abrir `AlertDialog` de confirmación con texto: "El ticket contiene consumos de la cuenta abierta de **{clienteNombre}**. Limpiar solo descarta esta vista; los consumos siguen registrados en la sesión y se podrán cobrar más tarde. ¿Continuar?" + botones [Cancelar] [Sí, descartar vista].
  - Si no hay sesión importada: `clear()` directo como hoy.
- Después de confirmar: `clear()` (que ya resetea `coworkingSessionId` y `clienteNombre` en el store).

**8.b `src/stores/cartStore.ts`:**
- (Sin cambios estructurales.) Documentar con comentario sobre `clear()` que NO toca DB; eliminar consumos de la cuenta abierta requiere flujo de cancelación (`solicitudes_cancelacion_sesiones` / `cancelaciones_items_sesion`), no `clear()`.

---

### Archivos a tocar

- `src/components/caja/CajaCheckoutPanel.tsx` (5, 6, 7-refinamiento, 8.a)
- `src/stores/cartStore.ts` (8.b, solo comentario)
- Sin migraciones, sin cambios de DB.

### Verificación

- 5: mixto con propina 10% + checkbox digital encendido + tarjeta < propina → mixto inválido, no cobra; tarjeta ≥ propina → nota visible y comisión calcula sobre `tarjeta - propina`.
- 6: ticket subtotal $100, propina manual $60 → warning amarillo. Propina $120 → error rojo, botón cobrar deshabilitado.
- 7: importar sesión con 3 consumos → encabezado "3 líneas de cuenta abierta", fondo distinto, badge + candado por línea.
- 8: con sesión importada → click "Limpiar" abre confirmación; aceptar limpia la vista; los consumos siguen en `detalle_ventas` y reaparecen al re-importar la sesión.
