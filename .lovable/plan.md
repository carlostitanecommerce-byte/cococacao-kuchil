# Plan: Separación física de carritos POS ↔ Caja

## Diagnóstico

El bug raíz es estructural: **POS y Caja comparten el mismo `useCartStore`** (un único Zustand persistido en `sessionStorage` bajo la llave `pos-cart`). Ambos módulos leen y escriben sobre el mismo arreglo `items`. Por eso:

- Cuando agregas productos en `/pos` y navegas a `/caja`, Caja ve exactamente los mismos `items` (es el mismo objeto).
- Si en Caja no cobras y regresas a `/pos`, los productos siguen ahí porque nunca salieron del store.
- Toda la lógica nueva (Fase 3 que bloquea importación si `hasItems > 0`, Fase 4 con `OrdenesPosSelector`, Fase 5 con `ordenPendienteId`) opera sobre ese mismo carrito compartido, así que no resuelve el problema: el POS sigue "contaminando" la vista de Caja.

Además, en `goToCheckout` (PosPage) hay una rama "Caja libre → navega directo sin parquear", que es la que dispara el síntoma exacto que describes: el ticket viaja a Caja sin pasar por la cola.

## Objetivo

Cada módulo debe tener **su propio carrito**, y la única vía de comunicación POS→Caja debe ser la tabla `ordenes_pos_pendientes` (la cola). El POS nunca debe poder "empujar" items directamente al carrito de Caja.

## Cambios

### 1. Dividir `src/stores/cartStore.ts` en dos stores hermanos

Crear dos stores con la misma forma e idénticos métodos, pero con llaves de persistencia distintas:

- `usePosCartStore` — llave `pos-cart` (preserva el sessionStorage actual del POS).
- `useCajaCartStore` — llave `caja-cart` (nueva, vacía al inicio).

Implementación: factorizar el creador actual en una función `createCartStore(persistKey)` y exportar las dos instancias. Toda la lógica interna (addOrIncrementProduct, importCoworkingSession, importOrdenPendiente, ordenPendienteId, tarifaUpsells, ensureOwner, etc.) queda igual; solo se duplica el "espacio" de estado.

### 2. Repuntar consumidores

- **POS** (`src/pages/PosPage.tsx` y componentes en `src/components/pos/*`): usar `usePosCartStore`. Incluye los `useCartStore.getState()` directos de las líneas 106 y 209.
- **Caja** (`src/pages/CajaPage.tsx`, `src/components/caja/CajaCheckoutPanel.tsx`, `src/components/caja/CoworkingSessionSelector.tsx`, `src/components/caja/OrdenesPosSelector.tsx`, `src/components/caja/ConfirmVentaDialog.tsx` y cualquier otro componente en `src/components/caja/*` que lea el cart): usar `useCajaCartStore`.
- Verificar con `rg "useCartStore"` que no quede ningún import ambiguo y reemplazar uno por uno según el módulo dueño del archivo.

### 3. Forzar que POS siempre pase por la cola

En `PosPage.tsx → goToCheckout`, eliminar la rama "Caja libre → `navigate('/caja')` con el cart cargado". El nuevo flujo del botón único "Procesar pago en Caja":

1. Si `isOpenAccount` (sesión coworking activa) → mantener `chargeToOpenAccount` como hoy.
2. Si no, **siempre** ejecutar `parkOrder()` (insertar en `ordenes_pos_pendientes` con estado `pendiente`) y limpiar el carrito del POS. Ya no se consulta `count` previo de la cola.
3. Después de parquear, navegar a `/caja`. Caja arranca con su propio cart vacío y muestra la orden recién creada en `OrdenesPosSelector` lista para importar.

Esto unifica el comportamiento que ya pediste en mensajes previos: un solo botón, comportamiento automático, sin sobrescritura.

### 4. Limpiar la lógica defensiva que ya no aplica

Como los carritos están físicamente separados:

- En `CajaPage.tsx`, el `useEffect` que lee `?session=` y bloquea si `hasItems` sigue siendo válido, pero ahora `hasItems` se lee del **cart de Caja**, no del de POS. La protección sigue siendo útil para evitar pisar un cobro en curso dentro de Caja.
- En `CoworkingSessionSelector.tsx` y `OrdenesPosSelector.tsx`, el `AlertDialog` de "tienes un ticket en progreso" sigue siendo válido pero ahora se refiere exclusivamente al ticket de Caja.

No se elimina ninguna validación; solo cambia el store del que leen.

### 5. Persistencia y reset por usuario

- `ensureOwner` se ejecuta en ambos stores de forma independiente cuando cambia el usuario autenticado (igual que hoy).
- En logout, ambos sessionStorages (`pos-cart` y `caja-cart`) deben quedar vacíos. Verificar que el hook/efecto actual de logout dispare `ensureOwner(null)` sobre los dos.

## Fuera de alcance

- No se toca el esquema de `ordenes_pos_pendientes` ni la lógica de cobro (Fase 5 sigue válida, solo cambia el store que lee `ordenPendienteId`).
- No se toca el flujo de coworking (sigue cargando upsells/cuenta abierta sobre el cart del POS cuando el operador está en `/pos`).
- No se toca el botón ni etiquetas existentes; solo cambia el comportamiento interno.

## Resultado esperado

- Agregas 3 productos en POS → presionas "Procesar pago en Caja" → la orden se inserta en la cola, el carrito del POS queda vacío.
- En Caja aparece la tarjeta de esa orden. Si la importas, entra al **cart de Caja**.
- Vuelves al POS: cart vacío, listo para una nueva venta independiente.
- Si en Caja decides no cobrarla aún y vuelves al POS, la orden queda en la cola; el POS sigue limpio.
