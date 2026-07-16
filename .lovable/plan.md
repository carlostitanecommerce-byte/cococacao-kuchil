## Objetivo

Cerrar la solicitud huérfana del 18-jun 19:08 (salida $1,000 "Pago de impresora", caja #28) marcándola como **aprobada** y registrando el movimiento de caja real, sin tocar código ni el cierre histórico de la caja.

## Cambios en la base de datos

Todo se hace con la herramienta de datos (`INSERT` + `UPDATE`), en una sola operación transaccional:

### 1. Insertar el movimiento en `movimientos_caja`

```sql
INSERT INTO movimientos_caja (
  id, caja_id, usuario_id, tipo, monto, motivo, created_at
) VALUES (
  gen_random_uuid(),
  '1d1a6473-20ae-4cf7-9be5-2ad9e059f1a2',  -- caja #28
  '9b17e836-c319-4b39-8bdf-d9bc761ae746',  -- solicitante = quien aprueba (único disponible)
  'salida',
  1000,
  'Pago de impresora',
  '2026-06-18 19:08:20.864378+00'          -- misma hora de la solicitud
)
RETURNING id;
```

### 2. Actualizar la solicitud a `aprobada` y vincular el movimiento

```sql
UPDATE solicitudes_movimiento_caja
SET estado = 'aprobada',
    revisado_por = '9b17e836-c319-4b39-8bdf-d9bc761ae746',
    movimiento_id = <id devuelto por el INSERT anterior>,
    updated_at = now()
WHERE id = '43475983-6c00-4f97-b5f0-3b520514190b';
```

## Consideraciones

- **La caja #28 ya está cerrada** con `monto_cierre = 715`, `diferencia = -985`. Estos valores NO se modifican — quedan como quedaron el día del cierre. El movimiento nuevo solo queda como registro histórico/auditable.
- El `usuario_id` del movimiento se pone como el solicitante (único usuario conocido en el contexto). Si prefieres otro aprobador, se ajusta antes de ejecutar.
- No hay cambios de esquema, ni migraciones, ni cambios de código.

## Resultado esperado

- La solicitud desaparece del panel "pendientes" de Caja.
- Aparece un movimiento de salida de $1,000 con fecha 18-jun 19:08 en la bitácora/movimientos de la caja #28.
- El cierre histórico de la caja #28 permanece intacto.