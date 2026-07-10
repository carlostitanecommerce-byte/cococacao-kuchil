## Objetivo

Borrar de la base de datos todo lo generado por las pruebas de venta de membresía asociadas al cliente **Abril Valdez** (`bffc2d4f-9528-41b7-ac7e-9abe581382de`). El cliente en sí se conserva.

## Registros detectados

**`coworking_membresias`** (3 filas, todas de Abril Valdez):
- `cd73cb10…` — pendiente_pago
- `65e033f1…` — pendiente_pago
- `8ea798e4…` — activa

**`ordenes_pos_pendientes`** (3 filas):
- Folio 695 — pendiente
- Folio 696 — pendiente
- Folio 697 — cobrada, ligada a venta `bc000fa7…`

**`ventas`** (1 fila): folio de la venta `bc000fa7…` con su renglón en `detalle_ventas` (tipo `coworking`, descripción "Membresía coworking · Abril Valdez …").

**`audit_logs`**: 6 registros referenciando al cliente / a "Abril Valdez".

**`movimientos_caja`**: ninguno vinculado (0 filas).

## Acciones (una sola migración transaccional)

1. `DELETE FROM detalle_ventas WHERE venta_id = 'bc000fa7-ae34-47eb-ba10-7e53b28d62fc'`
2. `DELETE FROM ventas WHERE id = 'bc000fa7-ae34-47eb-ba10-7e53b28d62fc'`
3. `DELETE FROM ordenes_pos_pendientes WHERE cliente_nombre ILIKE '%Abril%Valdez%'` (folios 695, 696, 697)
4. `DELETE FROM coworking_membresias WHERE cliente_id = 'bffc2d4f-9528-41b7-ac7e-9abe581382de'` (3 filas)
5. `DELETE FROM audit_logs WHERE metadata->>'cliente_id' = 'bffc2d4f-9528-41b7-ac7e-9abe581382de' OR descripcion ILIKE '%Abril Valdez%'` (6 filas)

Se corren en el orden anterior para respetar dependencias (detalle → venta; orden pendiente después de la venta que la referencia; membresías ya no referenciadas).

## Nota sobre política de datos

La memoria del proyecto establece "nunca borrar registros transaccionales". Estos borrados se hacen como **excepción explícita** solicitada por el usuario porque son datos de prueba, no ventas reales. Si prefieres marcarlas como `cancelada` en lugar de eliminarlas físicamente, dilo y ajusto el plan.

## Fuera de alcance

- No se elimina el cliente "Abril Valdez".
- No se toca `tarifas_coworking`, `cajas`, ni configuración.
- No hay cambios de código ni de esquema.
