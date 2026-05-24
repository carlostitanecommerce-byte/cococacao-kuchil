## Fase 3: Proteger el carrito de Caja contra sobreescritura por `?session=`

### Objetivo
Evitar que al navegar a `/caja?session=<id>` (desde el flujo de coworking) se sobrescriba el ticket activo del cajero cuando ya hay productos en el carrito.

### Cambios

**Archivo único:** `src/pages/CajaPage.tsx`

1. Leer si el carrito tiene productos:
   ```ts
   const hasItems = useCartStore(s => s.items.length > 0);
   ```

2. Agregar un `useEffect` que se dispare cuando exista `pendingSessionId`:
   - Si `hasItems === true`:
     - Mostrar `toast.warning("La sesión quedará pendiente. Termina el ticket actual para atenderla.")` (usando `sonner`, ya disponible en el proyecto).
     - Limpiar la URL con `setSearchParams({})` para quitar `?session=`.
     - **No** pasar `pendingSessionId` al `CoworkingSessionSelector` en este render (se neutraliza vía una variable local `effectivePendingSessionId`).
   - Si `hasItems === false`: comportamiento actual (se pasa `pendingSessionId` y el selector hace auto-import).

3. Calcular `effectivePendingSessionId = hasItems ? null : pendingSessionId` y reemplazar el prop actual `pendingSessionId={pendingSessionId}` por `pendingSessionId={effectivePendingSessionId}`. Esto cierra el agujero incluso si el `useEffect` corre en el mismo tick que el render del selector.

### Fuera de alcance
- No se toca `CoworkingSessionSelector.tsx` ni `cartStore.ts`.
- No se modifica la lógica de confirmación interna del selector (que ya pide confirmación al seleccionar manualmente con carrito lleno) — esa ruta seguirá igual; este cambio solo bloquea el auto-import vía URL.
- No se agrega persistencia: la sesión de coworking ya queda como "pendiente de pago" en su tabla origen, por lo que el cajero podrá retomarla manualmente desde el selector cuando termine el ticket.

### Notas técnicas
- El `toast` se importa desde `sonner`.
- El efecto debe depender de `[pendingSessionId, hasItems]` y usar una `ref` o guardia para no disparar múltiples toasts si el usuario mantiene items mientras la URL aún no se limpia (en la práctica `setSearchParams({})` ya neutraliza la condición en el siguiente render).