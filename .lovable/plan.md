## Objetivo
Eliminar la prueba de venta de membresía asociada al cliente **"Prueba"** de todas las tablas involucradas. Se conserva el cliente en el directorio (no fue solicitado su borrado).

## Registros encontrados

| Tabla | ID | Detalle |
|---|---|---|
| `coworking_membresias` | `9aac061c-45a1-4905-9e36-514cf312cf24` | estado `pendiente_pago`, creada 2026-07-10 19:51 |
| `ordenes_pos_pendientes` | `1376c79c-675e-476a-b392-65ff9ec2ac72` | folio #0694, estado `pendiente`, total $3,190.00, cliente "Prueba" |
| `audit_logs` | `ccfda60f-0813-4a10-8635-4e67d92be0a8` | acción `venta_membresia_coworking` |

No se generó ningún registro en `ventas` ni en `detalle_ventas` (la orden nunca se cobró en Caja), así que no hay nada que borrar ahí.

## Acción a ejecutar (una sola operación de datos)

```sql
DELETE FROM audit_logs             WHERE id = 'ccfda60f-0813-4a10-8635-4e67d92be0a8';
DELETE FROM ordenes_pos_pendientes WHERE id = '1376c79c-675e-476a-b392-65ff9ec2ac72';
DELETE FROM coworking_membresias   WHERE id = '9aac061c-45a1-4905-9e36-514cf312cf24';
```

Se ejecutará con la herramienta de inserción/modificación de datos (no es un cambio de esquema). El cliente "Prueba" permanece en la tabla `clientes`.
