## Auditoría del flujo actual

**Selección de opciones en `PaqueteSelectorDialog`:** no valida stock. `addOpcion` solo controla la cantidad por grupo; nunca consulta insumos.

**Click en "Agregar al ticket":** `handlePaqueteConfirm` llama `validar_stock_carrito`, pero esa RPC solo lee `producto_id` y `cantidad` de cada ítem. Para un paquete el `producto_id` es el del paquete, que no tiene recetas → los `componentes`/`opciones` se ignoran y la validación pasa siempre. **Bug raíz #1.**

**Botón +/− en el ticket sobre un paquete:** mismo bug (usa la misma RPC).

**Procesamiento de la venta (`ConfirmVentaDialog` + `procesar_venta_atomica`):** los paquetes sí se expanden en filas `detalle_ventas` con `tipo_concepto='producto'` y `producto_id` de cada componente. El trigger `descontar_inventario_venta` descuenta correctamente cada insumo. Es decir, **el descuento al cerrar venta sí funciona**, pero como se permitió llegar hasta ahí con stock insuficiente, la venta revienta con EXCEPTION en el último paso (mala UX).

## Objetivo

1. Bloquear desde el diálogo del paquete las opciones cuyo producto no tiene stock suficiente (visible + clic deshabilitado).
2. Bloquear el "Agregar al ticket" si la combinación seleccionada deja insumos negativos considerando el carrito existente.
3. Mantener (verificado) el descuento correcto de insumos al procesar la venta.

## Cambios

### 1. Migración — arreglar `validar_stock_carrito` para expandir paquetes

Reescribir la función para que, además de mirar `producto_id` de cada ítem, cuando `tipo_concepto='paquete'` itere sobre el array `componentes` del JSON y sume `receta.cantidad_necesaria × componente.cantidad × item.cantidad` por insumo. Así el RPC actúa como única fuente de verdad y sirve tanto en POS como en cualquier validación futura.

Pseudo-comportamiento:
```text
para cada item del carrito:
  si tipo_concepto = 'producto':
    sumar recetas(producto_id) × item.cantidad
  si tipo_concepto = 'paquete':
    para cada componente en item.componentes:
      sumar recetas(componente.producto_id) × componente.cantidad × item.cantidad
después: comparar uso_acumulado vs (stock_actual − uso_comprometido_coworking)
```

Mantiene la misma firma y el mismo formato de retorno (`{valido, error}`), por lo que **no hay cambios en el frontend** salvo aprovecharlo.

### 2. `PaqueteSelectorDialog.tsx` — validación por opción en tiempo real

- Al abrir el diálogo, obtener el carrito actual del `cartStore`.
- Tras cada cambio en `seleccion`, ejecutar `validar_stock_carrito` con `componentes tentativos = seleccion_actual + 1 unidad de la opción candidata` para cada opción de cada grupo. Hacerlo con `useEffect` debounced (~150 ms) y un solo `Promise.all` que devuelva el set de `opcion.id` no viables.
- Render: una opción no viable se muestra:
  - botón `disabled`
  - badge pequeño `Sin stock` (rojo, `text-destructive`, `border-destructive/40`)
  - tooltip explicativo opcional con el insumo faltante (el RPC ya devuelve el motivo; cachear el último error por producto_id).
- Si el usuario ya tenía una opción seleccionada que se vuelve inviable (por un cambio en otra parte), se mantiene tachada pero con badge "Sin stock"; "Agregar al ticket" se deshabilita.
- Botón "Agregar al ticket" queda deshabilitado adicionalmente si alguna opción seleccionada es inviable.

### 3. `PosPage.tsx`

- `handlePaqueteConfirm` ya llama a `validar_stock_carrito`. Con la RPC corregida (paso 1) esa llamada ahora sí valida componentes — sin cambios de código.
- `handleUpdateQty` para paquetes idem: misma RPC, ahora correcta.

### 4. Auditoría de descuento al procesar venta (sin cambios de código)

Confirmado: `ConfirmVentaDialog.tsx` (líneas ~145-200) expande cada paquete en N filas `detalle_ventas` de `tipo_concepto='producto'` con el `producto_id` real del componente. El trigger `descontar_inventario_venta` (última versión en `20260522015236_*.sql`) descuenta cada receta. **No requiere migración adicional.** Solo se añade un comentario aclaratorio al RPC corregido para futura referencia.

## Validación

1. Crear/usar un paquete cuyo componente "Capuchino" use 200 ml de leche; bajar el stock de leche para que solo alcance para 1 capuchino.
2. Abrir el paquete en POS: el botón "Capuchino" aparece deshabilitado con badge "Sin stock" en cuanto ya hay 1 capuchino en el carrito o ya elegido en otro grupo.
3. Intentar agregar igual con stock insuficiente vía manipulación → "Agregar al ticket" queda deshabilitado y `validar_stock_carrito` lo rechaza.
4. Procesar una venta normal con paquetes mixtos → los insumos de cada componente se descuentan exactamente (consultar `insumos.stock_actual` antes/después).
5. En cuenta de coworking abierta (consumo comprometido), las opciones que rebasen el stock disponible aparecen como "Sin stock" porque la RPC ya descuenta el `uso_comprometido` de detalles `venta_id IS NULL`.

## Qué NO cambia

- `validar_stock_disponible` (productos sueltos).
- `validar_stock_paquete` (gating inicial al hacer clic en el paquete).
- `descontar_inventario_venta` y `procesar_venta_atomica`.
- Lógica de KDS, coworking, propinas, prorrateo de precios en `ConfirmVentaDialog`.
- Estructura del carrito ni de `detalle_ventas`.
