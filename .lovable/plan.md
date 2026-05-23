# Plan: Endurecimiento de validación de stock y errores en POS

Alcance acotado a los puntos 4, 6, 7, 9 y 10 de la auditoría. No se tocan diseño ni flujos no relacionados.

---

## 4. Consistencia en `handleUpdateQty` para paquetes dinámicos

**Problema:** al incrementar cantidad de un paquete dinámico desde el carrito, el item tentativo se arma con `componentes` pero sin `opciones`, mientras que `handlePaqueteConfirm` sí envía `opciones`. La RPC `validar_stock_carrito` recibe formas distintas según el origen.

**Cambio en `src/pages/PosPage.tsx` → `handleUpdateQty`:**
- Al construir `itemsTentativos` para un paquete, propagar también `opciones` desde el item del carrito (igual que ya se hace con `componentes`).
- Mantener el shape idéntico al usado en `handlePaqueteConfirm` para que la RPC valide por la misma ruta (expansión por componentes con multiplicador de cantidad).
- No cambia la firma de la RPC; solo se uniforma el payload del cliente.

---

## 6. Debounce de re-validación en `PaqueteSelectorDialog`

**Problema:** el efecto que re-valida todas las opciones se dispara en cada cambio de `cartItems` / `seleccion`, generando ráfagas de RPC innecesarias.

**Cambio en `src/components/pos/PaqueteSelectorDialog.tsx`:**
- Envolver la re-validación masiva en un debounce de ~250 ms usando `setTimeout` + cleanup en el `useEffect`.
- Conservar fail-closed: mientras el debounce está pendiente, no se habilitan opciones cuyo `stockMap` haya quedado marcado como inválido en la pasada anterior.
- La validación final autoritativa dentro de `addOpcion` no se debouncea; sigue ejecutándose inmediata para garantizar la decisión correcta al click.
- Cancelar el timer al cerrar el diálogo o desmontar.

---

## 7. Validación de stock en `registrar_consumo_coworking`

**Problema:** la RPC inserta consumos en la cuenta abierta sin revalidar stock; el cliente es la única defensa.

**Cambio vía migración (nueva):**
- Modificar `registrar_consumo_coworking` para que, antes de insertar:
  1. Construya un arreglo equivalente al de `validar_stock_carrito` a partir de `p_items` (productos sueltos y paquetes con sus `componentes`).
  2. Sume al cálculo el consumo ya comprometido en otras cuentas abiertas activas para no permitir doble venta del mismo stock.
  3. Llame internamente a la misma lógica de validación (o se factoriza una función `_validar_stock_items(jsonb)` reutilizable por ambas RPCs para evitar drift).
- Si la validación falla, `RAISE EXCEPTION` con el mensaje legible (nombre del producto) y abortar la inserción dentro de la misma transacción.
- Mantener bloqueo a productos inactivos / sin receta cuando `requiere_preparacion = true`, igual que el endurecimiento ya hecho en `validar_stock_carrito`.

---

## 9. Manejo de fallos de red en `addProduct`

**Problema:** ante error de RPC, el carrito muestra un toast genérico ("Error de conexión") sin distinguir red de stock insuficiente, y sin reintento.

**Cambios en `src/pages/PosPage.tsx` (`addProduct`) y en `src/hooks/useValidarStock.ts`:**
- En `verificarStock` y en las llamadas RPC (`validar_stock_paquete`, `validar_stock_carrito`):
  - Diferenciar `error` de PostgREST (red/HTTP) de `{valido: false, error}` (regla de negocio).
  - Para errores de red: toast con mensaje específico ("Sin conexión con el servidor, intenta de nuevo") y NO agregar al carrito.
  - Para errores de negocio: conservar el mensaje detallado actual.
- Agregar un único reintento automático con backoff corto (≈400 ms) ante error de red transitorio antes de mostrar el toast.
- Liberar siempre `addingLockRef` en `finally` (ya está) y asegurar que el lock no se quede colgado si el reintento también falla.

---

## 10. Cierre del cobro: protección contra carrera de inventario

**Problema:** entre la validación en POS y el `INSERT` de la venta en `/caja`, otra terminal puede consumir el stock.

**Cambios:**

### 10.a Migración: revalidación atómica dentro de `descontar_inventario_venta`
- Antes de descontar, ejecutar dentro de la misma transacción una re-verificación equivalente a `validar_stock_carrito` sobre los items reales de la venta (incluyendo expansión de paquetes por `componentes` y sus recetas).
- Tomar `SELECT ... FOR UPDATE` sobre las filas de `insumos` involucradas para serializar el acceso entre terminales concurrentes.
- Si la validación falla en este punto: `RAISE EXCEPTION` con el insumo/producto faltante. La venta no se confirma.

### 10.b Cliente
- En `src/pages/CajaPage.tsx` / `CajaCheckoutPanel.tsx` (donde se invoca el cierre): capturar la excepción de la RPC y mostrar un toast accionable ("Stock insuficiente al confirmar — revisa el ticket"), sin marcar la venta como completada y sin limpiar el carrito.
- No se elimina la validación previa en POS; sigue siendo la primera línea de defensa para UX.

---

## Archivos a tocar

- `src/pages/PosPage.tsx` (items 4 y 9)
- `src/components/pos/PaqueteSelectorDialog.tsx` (item 6)
- `src/hooks/useValidarStock.ts` (item 9)
- `src/pages/CajaPage.tsx` y/o `src/components/caja/CajaCheckoutPanel.tsx` (item 10.b)
- Nueva migración: refactor de `validar_stock_carrito` a función reutilizable + endurecer `registrar_consumo_coworking` (item 7) y `descontar_inventario_venta` con `FOR UPDATE` (item 10.a)

## Verificación

- 4: incrementar paquete dinámico desde el carrito hasta agotar stock de un componente → debe bloquear.
- 6: abrir diálogo de paquete con carrito grande → en Network solo se ve una ráfaga de validaciones por cambio, no por cada render.
- 7: dos cuentas de coworking abiertas cargando el mismo último producto → la segunda debe fallar con mensaje legible.
- 9: simular offline → toast de red, sin agregar al carrito, sin lock colgado.
- 10: dos terminales cobrando simultáneamente el último producto → solo una venta se confirma; la otra recibe excepción clara.
