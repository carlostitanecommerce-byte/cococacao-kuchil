## Objetivo
Actualizar `public.cancelar_sesion_coworking(uuid, text, jsonb, uuid, boolean)` aplicando 3 cambios puntuales sobre la versión vigente (`20260716032004`). Se conserva sin modificar el resto del cuerpo (mermas de entregados, reintegro de no entregados, borrado de líneas abiertas, audit final, GRANT) para no regresar el fix del Bug 2.

## Cambios
1. **Aceptar `pendiente_pago`**: el guard de estado pasa de `<> 'activo'` a `NOT IN ('activo','pendiente_pago')`, con `ERRCODE '22023'` y mensaje actualizado.
2. **Preservar `fecha_salida_real`**: en el UPDATE final usar `fecha_salida_real = COALESCE(fecha_salida_real, now())` para no pisar el timestamp real de sesiones que ya hicieron checkout.
3. **Caso idempotente "sesión ya cancelada + solicitud pendiente"**: insertar, entre el `IF NOT FOUND` y el guard de estado, el bloque que si `estado='cancelado' AND p_solicitud_id IS NOT NULL`:
   - Exige rol administrador (`ERRCODE '42501'` si no).
   - Marca la solicitud como `aprobada`, con `motivo_rechazo` por defecto "Sesión ya cancelada previamente — solicitud cerrada".
   - Inserta audit `cerrar_solicitud_obsoleta`.
   - Retorna `{ ok:true, ya_cancelada:true, mermas_creadas:0, entregados_count:0 }`.

Sin cambios de firma, nombres de variables ni lógica de inventario. Sin cambios de frontend.

## Entregable
Nueva migración `supabase/migrations/<timestamp>_fix_cancelar_sesion_coworking_pendiente_pago.sql` que hace `CREATE OR REPLACE FUNCTION public.cancelar_sesion_coworking(...)` con el cuerpo vigente + los 3 bloques anteriores, terminando en:

```sql
GRANT EXECUTE ON FUNCTION public.cancelar_sesion_coworking(uuid, text, jsonb, uuid, boolean) TO authenticated;
```

## Verificación
- **V1**: Cancelar una sesión en `pendiente_pago` → ok, no lanza el error previo.
- **V2**: Cancelar una sesión que ya tenía `fecha_salida_real` → el timestamp original se conserva.
- **V3**: Aprobar una solicitud sobre una sesión ya `cancelado` siendo administrador → retorna `ya_cancelada:true`, cierra la solicitud, escribe audit `cerrar_solicitud_obsoleta`. Con rol no-admin → `ERRCODE 42501`.
- **V4 (no regresión)**: Cancelar sesión `activo` con entregados y no-entregados → mermas y reintegros idénticos al comportamiento actual.
