# Validación de stock para paquetes

## Problema

Hoy el stock de las **opciones/componentes de un paquete** no se valida:

1. `handlePaqueteConfirm` mete el paquete al carrito sin tocar inventario.
2. `handleAddProduct` (rama paquete legacy en línea 152) tampoco valida.
3. `validar_stock_carrito` (RPC al cobrar) sólo lee `recetas` del `producto_id` del item; como los paquetes no tienen receta propia, los ignora.
4. El único freno real es el trigger `descontar_inventario_venta` durante el `INSERT` de la venta → el cajero arma todo el ticket y la transacción explota al cobrar.

## Solución (2 capas)

### Capa 1 — Validación pre-carrito (UX)

En `src/pages/PosPage.tsx`:

- **`handlePaqueteConfirm`**: antes de `addOrIncrementPaquete`, recorrer `opciones` agrupadas por `producto_id`, sumarles el consumo de las líneas de paquete equivalentes ya en el carrito y llamar `verificarStock(producto_id, cantidadAcumulada)` para cada uno. Si alguno falla, mostrar toast con nombre del producto y abortar (mantener el dialog abierto).
- **Rama paquete legacy en `handleAddProduct`** (línea 152): mismo tratamiento sobre `componentes`.
- **`handleUpdateQty`**: cuando `delta > 0` y el item es paquete, validar todos sus `componentes`/`opciones` proporcionalmente. Eliminar el comentario engañoso "se valida globalmente al cobrar".

### Capa 2 — Validación atómica pre-cobro (backstop)

Migración SQL: ampliar `public.validar_stock_carrito(jsonb)` para que, por cada item con `tipo_concepto = 'paquete'`, expanda recetas a partir de:

- `opciones[].producto_id` (paquetes dinámicos), o
- `componentes[].producto_id × componentes[].cantidad` (paquetes legacy),

cada uno multiplicado por `cantidad` del item. Acumular el consumo agregado por `insumo_id` (igual que hoy para productos simples) y comparar contra `stock_actual`. El mensaje de error debe nombrar el insumo faltante.

No se requiere cambio de firma (sigue recibiendo `p_items jsonb`), sólo enriquecer la lógica interna.

## Archivos afectados

- `src/pages/PosPage.tsx` — `handlePaqueteConfirm`, rama paquete de `handleAddProduct`, `handleUpdateQty`.
- Nueva migración SQL — redefine `validar_stock_carrito` con soporte de paquetes.

## Fuera de alcance

- Cambios en `cartStore.ts`, en `ConfirmVentaDialog.tsx` o en el trigger `descontar_inventario_venta`.
- Paquetes con más de una unidad de la misma opción se cubren porque ya se cuentan en el `Map<producto_id, cantidad>` que construye `handlePaqueteConfirm`.
