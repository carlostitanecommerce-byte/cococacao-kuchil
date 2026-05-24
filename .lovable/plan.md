## Fase 4 + 5: Cola de órdenes POS pendientes en Caja

### Fase 4 — UI de selección en Caja

**1. Nuevo componente `src/components/caja/OrdenesPosSelector.tsx`**

Modelado sobre `CoworkingSessionSelector.tsx` (mismo look & feel, Card + lista compacta).

- Query: `select id, folio, cliente_nombre, items, total, created_at, usuario_id, caja_id from ordenes_pos_pendientes where estado = 'pendiente' order by created_at asc`.
- Suscripción Realtime al canal `postgres_changes` sobre `ordenes_pos_pendientes` (igual patrón que el selector de coworking) para refrescar al insertarse/cancelarse/cobrarse una orden.
- Cada tarjeta muestra: folio (#0001), nombre del cliente (o "Sin nombre"), número de items, total, tiempo transcurrido (`formatDistanceToNow` en es), y badge con nombre del cajero que la dejó pendiente (resuelto vía join a `profiles` por `usuario_id`).
- Botón principal **"Importar a ticket"**. Acción:
  - Si `useCartStore(s => s.items.length) > 0` → abrir `AlertDialog` con título "Tienes un ticket en progreso" y texto: *"Cóbralo o presiona Limpiar antes de importar una nueva orden."* Solo botón "Entendido". No importa nada.
  - Si carrito vacío → llamar `onImport(orden)` provisto por el padre.
- Buscador opcional por nombre/folio (mismo input que el selector existente, omitible si simplifica).
- Estado vacío: "Sin órdenes pendientes en cola." centrado en la card.

**2. Integración en `src/pages/CajaPage.tsx`**

- Importar y renderizar `OrdenesPosSelector` **encima** de `CoworkingSessionSelector` dentro del bloque `cajaAbierta && (...)` de la columna izquierda.
- Handler `handleImportOrden(orden)` que llama a un nuevo método del store (ver Fase 5) y muestra toast `"Orden #${folio} importada"`.

**3. Endurecer `CoworkingSessionSelector` (regla estricta unificada)**

- Hoy ya pide confirmación cuando hay items, pero permite continuar. Cambiar el flujo: si `cartItemCount > 0` y la sesión seleccionada **no** es la misma que `activeCartSessionId`, mostrar el mismo `AlertDialog` bloqueante ("Tienes un ticket en progreso…") y **no** ofrecer reemplazar. Mantener el caso "misma sesión" (refresh) sin cambios.

### Fase 5 — Consumo y cierre del ciclo

**1. `src/stores/cartStore.ts`**

- Agregar campo `ordenPendienteId: string | null` (init `null`).
- Incluirlo en los reseteos: `clear()`, `ensureOwner` (ambos branches que vacían carrito).
- Nuevo método `importOrdenPendiente(items: CartItem[], ordenId: string, clienteNombre: string | null)`:
  ```ts
  set({
    items: items.map(ensureLineId),
    ordenPendienteId: ordenId,
    clienteNombre,
    coworkingSessionId: null,
    tarifaUpsells: {},
  })
  ```
- En `importCoworkingSession` también limpiar `ordenPendienteId: null` para evitar mezcla.
- Exponer un setter `setOrdenPendienteId(id: string | null)` por si hace falta limpiar manualmente.

**2. `src/components/caja/CajaCheckoutPanel.tsx`**

- Leer `ordenPendienteId = useCartStore(s => s.ordenPendienteId)`.
- En `handleSuccess` (línea 253), **antes** del `clear()`, si `ordenPendienteId`:
  ```ts
  await supabase
    .from('ordenes_pos_pendientes')
    .update({ estado: 'cobrada', venta_id: ventaIdRecienCreada })
    .eq('id', ordenPendienteId);
  ```
  - Necesitamos el `venta_id` recién creado. `ConfirmVentaDialog.onSuccess` actualmente no lo pasa: ampliar su firma a `onSuccess: (ventaId: string) => void` y propagar desde donde se inserta la venta. (Si la firma actual ya devuelve el id, usarlo directo; revisar al implementar.)
  - Si falla el UPDATE, mostrar `toast.error` pero **no** revertir la venta (la venta ya está cobrada); registrar y dejar que admin resuelva.
- Limpiar `ordenPendienteId` vía `clear()` (ya queda cubierto al agregarlo al reset del store).

**3. Importación desde el selector**

- `handleImportOrden` en `CajaPage` deserializa `orden.items` (JSONB → `CartItem[]`) y llama `importOrdenPendiente(items, orden.id, orden.cliente_nombre)`.

### Fuera de alcance
- No se modifica `ordenes_pos_pendientes` ni schema (la tabla ya existe con estado `cobrada` y campo `venta_id`).
- No se toca el POS (Fase 2 ya parquea las órdenes).
- No se construye flujo de cancelación de órdenes pendientes desde Caja (queda para fase posterior; admin puede usar campos `cancelada_por`/`motivo_cancelacion` ya presentes).
- No se valida stock al importar (se valida normalmente al cobrar, lógica existente de `CajaCheckoutPanel`).

### Notas técnicas
- `items` en BD es `jsonb` con la forma serializada de `CartItem[]`; al re-hidratar pasar por `ensureLineId` (lo hace el store).
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.ordenes_pos_pendientes` — verificar si ya está; si no, agregarlo vía migración.
- El campo `venta_id` en `ordenes_pos_pendientes` ya existe (vimos la columna), así que basta UPDATE.