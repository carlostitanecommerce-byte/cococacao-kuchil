## Problema

En `/cocina` se acumulan órdenes con muchas horas/días de antigüedad porque, al cerrar la caja al final del día, las órdenes que quedaron en `pendiente` o `en_preparacion` nunca cambian de estado. El tablero KDS filtra por esos estados, así que siguen apareciendo turno tras turno.

Hoy mismo hay **326 pendientes**, **1 en preparación** y **32 listas** atascadas.

## Solución

Cuando el cajero ejecute el cierre de caja, el sistema marcará automáticamente todas las órdenes de cocina que sigan activas con el estado **`expirada`**. Ese estado ya existe en el enum `kds_estado` y el tablero KDS no lo muestra, por lo que las tarjetas desaparecerán de cocina al instante (vía Realtime) sin borrar ningún registro: quedan trazables en reportes y auditoría.

No se introduce un estado nuevo (`null` rompería el enum y los índices). `expirada` es el equivalente semántico a "se cerró el turno sin terminar de prepararla".

## Cambios

1. **Función `cerrar_caja` (RPC)**
   - Justo después de marcar la caja como `cerrada`, añadir:
     - `UPDATE kds_orders SET estado='expirada', updated_at=now() WHERE estado IN ('pendiente','en_preparacion','listo')`.
   - Registrar en `audit_logs` cuántas órdenes se expiraron (campo extra en `metadata.kds_expiradas_count`) para tener evidencia en bitácora.

2. **Limpieza única (one-shot)**
   - Ejecutar la misma actualización ahora mismo sobre los 359 registros atorados para que el tablero KDS quede limpio de inmediato.

3. **Sin cambios de UI**
   - `CocinaPage.tsx` ya excluye `expirada` de su consulta y ya escucha el evento `UPDATE` de `kds_orders` por Realtime, así que las tarjetas se quitan solas en cuanto se cierra la caja, sin tocar el frontend.

## Detalles técnicos

- Migración: `CREATE OR REPLACE FUNCTION public.cerrar_caja(...)` reemplazando la versión actual, conservando toda la lógica de validación (sesiones pendientes, diferencia, notas obligatorias) y agregando el bloque de expiración antes del `RETURN`.
- Limpieza puntual: `UPDATE public.kds_orders SET estado='expirada', updated_at=now() WHERE estado IN ('pendiente','en_preparacion','listo');` ejecutado vía la herramienta de datos.
- No se tocan `kds_order_items` ni `detalle_ventas`: la venta sigue intacta y los items conservan su historial.
