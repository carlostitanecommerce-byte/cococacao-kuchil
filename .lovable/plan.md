## Diagnóstico

El error `null value in column "producto_id" of relation "cancelaciones_items_sesion" violates not-null constraint` se dispara al cancelar una línea cuyo `detalle_ventas.producto_id` es `NULL`. Esto ocurre con **líneas de paquete**, donde el detalle solo tiene `paquete_id` y `paquete_nombre` poblados (el `producto_id` es nulo por diseño).

El RPC `solicitar_cancelacion_item_sesion(p_session_id, p_detalle_id, p_cantidad, p_motivo)` lee `v_dv.producto_id` y lo inserta tal cual en `cancelaciones_items_sesion.producto_id`, que actualmente es `NOT NULL` → violación de constraint.

Errores latentes similares detectados:

1. **Misma RPC, búsqueda en KDS**: el bloque que busca `kds_order_items` para enlazar la cancelación filtra por `koi.producto_id = v_dv.producto_id`. Para paquetes esto no aplica y queda sin enlace al KDS.
2. **Overload heredado de 3 argumentos** (`solicitar_cancelacion_item_sesion(p_detalle_id, p_cantidad, p_motivo)`) tiene exactamente el mismo bug y además fuerza el motivo mínimo distinto. El frontend usa la versión de 4 args; mantener dos firmas es riesgoso si algo legacy llama a la otra.
3. **Resolver (`resolver_cancelacion_item_sesion`)** ya maneja correctamente paquete vía `detalle_ventas.paquete_id`, así que **no requiere cambios funcionales**, solo se beneficiará de los ajustes de esquema.

## Plan

### 1. Esquema — `cancelaciones_items_sesion`
- Hacer `producto_id` `NULL`-able (las líneas de paquete no tienen producto único).
- Agregar columna opcional `paquete_id uuid` para trazabilidad cuando la cancelación es de un paquete.
- Agregar constraint de validación: debe existir `producto_id` **o** `paquete_id` (no ambos nulos).

### 2. RPC `solicitar_cancelacion_item_sesion` (4 args, la que usa la app)
- Detectar si la línea es paquete (`v_dv.paquete_id IS NOT NULL`) o producto simple.
- Para paquete:
  - `nombre_producto` = `paquete_nombre` (ya cae en el fallback actual).
  - `producto_id` se inserta como `NULL`, `paquete_id` se rellena con `v_dv.paquete_id`.
  - Saltar la búsqueda en `kds_order_items` por `producto_id` (los componentes del paquete pueden tener varias filas en KDS; el flujo de KDS para paquetes seguirá manejándose por la cocina, igual que hoy).
- Para producto simple: comportamiento actual sin cambios.

### 3. RPC heredada de 3 argumentos
- Eliminarla con `DROP FUNCTION` (firma específica). Evita futuros llamados accidentales con el bug.

### 4. Verificación post-migración
- Probar cancelación de:
  - Producto simple con KDS pendiente → enlaza KDS, registra solicitud.
  - Paquete sin producto_id → ahora inserta correctamente con `paquete_id`.
  - Amenity (si quedara alguno cancelable) → comportamiento sin cambios.
- Confirmar que el resolver decrementa stock / registra merma correctamente para ambos tipos.

## Detalles técnicos

```sql
ALTER TABLE public.cancelaciones_items_sesion
  ALTER COLUMN producto_id DROP NOT NULL,
  ADD COLUMN paquete_id uuid,
  ADD CONSTRAINT cancelaciones_items_sesion_target_chk
    CHECK (producto_id IS NOT NULL OR paquete_id IS NOT NULL);

DROP FUNCTION public.solicitar_cancelacion_item_sesion(uuid, integer, text);

-- Reemplazo del RPC de 4 args con rama producto/paquete (resumen):
-- IF v_dv.paquete_id IS NOT NULL THEN
--   v_nombre := COALESCE(v_dv.paquete_nombre, 'Paquete');
--   -- no buscar kds por producto_id
-- ELSE
--   -- flujo actual con v_dv.producto_id
-- END IF;
-- INSERT (..., producto_id, paquete_id, ...) VALUES (..., v_dv.producto_id, v_dv.paquete_id, ...);
```

El resolver ya hace `IF v_dv.paquete_id IS NOT NULL THEN ... paquete_componentes ...`, por lo que no se toca.

## Alcance

- Migración SQL única (esquema + RPC reemplazado + drop overload).
- Sin cambios en frontend.
