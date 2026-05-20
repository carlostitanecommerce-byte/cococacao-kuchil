# Fix: botón "Entregado" en KDS falla con "Error al actualizar orden"

## Diagnóstico

El botón **Entregado** del KDS (`KdsOrderCard`) dispara `handleDismiss` en `CocinaPage`:

```ts
const handleDismiss = (orderId: string) => updateEstado(orderId, 'expirada' as any);
```

`updateEstado` llama a la RPC `actualizar_estado_kds_orden(p_order_id, p_nuevo_estado)`, que tiene este guard:

```sql
IF p_nuevo_estado NOT IN ('pendiente', 'en_preparacion', 'listo') THEN
  RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
END IF;
```

El enum `kds_estado` ya incluye `expirada` como valor válido, pero la RPC lo rechaza. Por eso el `toast.error('Error al actualizar orden')` aparece justo al presionar **Entregado**, y la orden se queda en la columna "Listo" hasta que el auto-remove de 90s la limpia visualmente (sin registro en `audit_logs`).

## Solución

Dos cambios pequeños y coordinados, sin tocar la UI:

### 1. Migración DB — permitir `expirada` en la RPC

Actualizar `public.actualizar_estado_kds_orden` para aceptar también `expirada` como estado destino válido. Es el estado terminal natural para "orden entregada / sacada del tablero" y ya existe en el enum, así que no requiere migración de datos.

```sql
-- En la validación de la función:
IF p_nuevo_estado NOT IN (
  'pendiente'::kds_estado,
  'en_preparacion'::kds_estado,
  'listo'::kds_estado,
  'expirada'::kds_estado
) THEN
  RAISE EXCEPTION 'Estado inválido: %', p_nuevo_estado;
END IF;
```

El resto de la función (audit log, `updated_at`, duración) sigue igual — registra automáticamente la transición `listo → expirada` en `audit_logs` con el folio, lo que mejora la trazabilidad de entregas (hoy inexistente).

### 2. Frontend — limpieza menor en `CocinaPage`

- Quitar el cast sucio `'expirada' as any` y tiparlo correctamente como `KdsEstado` (el tipo ya cubre el valor del enum).
- Tras un dismiss exitoso, eliminar la orden de `orders` inmediatamente (en lugar de esperar el auto-remove de 90s sobre el estado `listo`). El query principal ya filtra por `pendiente/en_preparacion/listo` con ventana de 2 min, así que no reaparecerá en el siguiente fetch.

Sin cambios en `KdsOrderCard` ni en `KdsBoard`.

## Validación

1. Login como barista, abrir Cocina, llevar una orden hasta "Listo".
2. Presionar **Entregado** → la tarjeta desaparece sin toast de error.
3. Verificar en `audit_logs` un registro `kds_orden_estado` con `estado_anterior: listo`, `estado_nuevo: expirada`, folio correcto.
4. Verificar que la orden no reaparezca tras un refetch (recargar la página).
5. Verificar que `Revertir a "En preparación"` sigue funcionando (no fue tocado).

## Archivos afectados

```text
~ supabase migration: actualizar función actualizar_estado_kds_orden
~ src/pages/CocinaPage.tsx: tipar handleDismiss y limpiar orders tras éxito
```
