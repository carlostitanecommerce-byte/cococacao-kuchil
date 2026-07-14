
# Limpieza de datos de prueba — Caja del 13 de julio 20:30 CDMX en adelante

Corte: **2026-07-14 02:30:00 UTC** (= 13-jul 20:30 CDMX).

## Alcance detectado

Todo se creó bajo la caja **folio #68** (abierta 20:30 CDMX, cerrada 21:40 CDMX):

| Tabla | Registros | Notas |
|---|---|---|
| `ventas` | 6 (folios #870–#875, todas `completada`) | montos: 3190, 4400, 130, 4400, 9360, 3190 |
| `detalle_ventas` | 7 (líneas de esas ventas) | |
| `coworking_sessions` | 2 ("Prueba 2" cancelada, "Abril Valdez" finalizada) | |
| `coworking_membresias` | 8 (varias activas / pendiente_pago / cancelada) | |
| `ordenes_pos_pendientes` | 8 (folios 735–742: cobradas, canceladas y pendientes) | |
| `clientes` | 3 ("Prueba 2", "Prueba 3", "Prueba 4") | |
| `cajas` | 1 (folio #68, cerrada) | |
| `audit_logs` | 36 eventos ligados a la caja de prueba | |
| `movimientos_caja`, `kds_*`, `solicitudes_*`, `mermas`, `compras_insumos`, `cancelaciones_items_sesion`, `coworking_reservaciones` | 0 | Sin registros |

## Restauración de inventario

Las 5 ventas `completada` no canceladas descontaron stock de insumos vía sus recetas. Antes de borrarlas, se ejecutará `revertir_stock_venta(venta_id)` para cada una — así el stock queda como estaba antes de las 20:30. (La venta de folio #872 corresponde al cargo de coworking, también se revierte.)

## Orden de borrado (una sola migración transaccional)

Se ejecutará en un único bloque para respetar FKs:

```text
1. Para cada venta completada en rango: SELECT revertir_stock_venta(id)
2. DELETE detalle_ventas WHERE created_at >= corte
3. DELETE ventas WHERE created_at >= corte
4. DELETE coworking_sessions WHERE created_at >= corte
5. DELETE coworking_membresias WHERE created_at >= corte
6. DELETE ordenes_pos_pendientes WHERE created_at >= corte
7. DELETE clientes WHERE created_at >= corte  (los 3 "Prueba N")
8. DELETE cajas WHERE id = folio #68
9. DELETE audit_logs WHERE created_at >= corte
```

Se usará una migración (porque `DELETE` no está permitido con la herramienta de inserción sobre múltiples tablas ligadas; la migración corre en transacción y hace rollback si algo falla).

## Detalles técnicos

- Los folios (`ventas_folio_seq`, `cajas_folio_seq`, `ordenes_pos_pendientes_folio_seq`) **no se reinician**: la próxima venta seguirá con el folio siguiente. Reiniciarlos rompería auditoría histórica.
- Los `audit_logs` en el rango también se eliminan (son de las pruebas). Si prefieres conservarlos como registro histórico de "sesión de pruebas", avísame.
- Ningún `movimiento_caja` fue registrado en la caja #68, así que su eliminación no arrastra otros datos.
- La caja actualmente **está cerrada**, por lo que borrarla no afecta operaciones en curso.

## Confirmación requerida

¿Procedo con el borrado completo incluyendo la restauración de stock? Si quieres conservar los `audit_logs` de la sesión, dímelo y los excluyo.
