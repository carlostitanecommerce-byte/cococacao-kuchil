## Problema

La RPC `cancelar_sesion_coworking` exige que la sesión esté en `activo` o `pendiente_pago`. Pero cuando llega el momento de aprobar una solicitud, la sesión ya puede estar en `cancelado` por dos razones legítimas:

1. El admin canceló la sesión **directamente** (sin aprobar la solicitud), dejando la solicitud huérfana en `pendiente`.
2. Existían **varias solicitudes** sobre la misma sesión (caso real en BD: Jonathan Contreras con 2 solicitudes), y al aprobar la primera la segunda queda imposible de procesar.

Hoy hay 4 solicitudes `pendiente` apuntando a sesiones ya `cancelado` que bloquean el panel del admin.

## Plan

### 1. Backend — RPC `cancelar_sesion_coworking` (migración)

Hacer la función tolerante a sesiones ya canceladas cuando viene `p_solicitud_id`:

- Si `v_session.estado = 'cancelado'` **y** hay `p_solicitud_id`:
  - **No** tocar inventario, **no** borrar `detalle_ventas`, **no** crear mermas (ya se hizo en la cancelación original).
  - Marcar la solicitud como `aprobada` con `revisado_por = auth.uid()` y nota interna "Sesión ya cancelada previamente".
  - Insertar `audit_log` con acción `cerrar_solicitud_obsoleta` describiendo el caso.
  - Retornar `{ ok: true, ya_cancelada: true, mermas_creadas: 0, entregados_count: 0 }`.
- Si estado es otro (no `activo`/`pendiente_pago`/`cancelado`) seguir lanzando la excepción actual.
- Mantener el flujo normal intacto para sesiones `activo`/`pendiente_pago`.

### 2. Backend — Auto-cierre de solicitudes huérfanas (misma migración)

Cuando una sesión pasa a `cancelado` por la vía directa, cerrar automáticamente cualquier solicitud `pendiente` para esa sesión:

- Al final del flujo normal de cancelación dentro de la misma RPC (cuando `p_solicitud_id IS NULL`), hacer:
  ```sql
  UPDATE solicitudes_cancelacion_sesiones
     SET estado = 'aprobada', revisado_por = v_user_id,
         motivo_rechazo = 'Auto-cerrada: sesión cancelada directamente por admin'
   WHERE session_id = p_session_id AND estado = 'pendiente';
  ```
- Registrar el conteo en el `audit_log` (`solicitudes_auto_cerradas`).

### 3. Backfill — limpiar las 4 solicitudes huérfanas actuales

En la misma migración:
```sql
UPDATE solicitudes_cancelacion_sesiones s
   SET estado = 'aprobada',
       motivo_rechazo = 'Cierre retroactivo: sesión ya estaba cancelada'
  FROM coworking_sessions c
 WHERE s.session_id = c.id
   AND s.estado = 'pendiente'
   AND c.estado = 'cancelado';
```

### 4. Frontend — `SolicitudesCancelacionSesionesPanel.tsx`

Al abrir el diálogo de aprobación, detectar `session.estado === 'cancelado'` (ya se carga al traer upsells):

- Cambiar el título a **"Cerrar solicitud obsoleta"**.
- Mostrar aviso: *"La sesión ya fue cancelada previamente. Aprobar esta solicitud solo cerrará el registro sin afectar inventario."*
- Ocultar la sección de entregas/upsells (no aplica).
- Cambiar el CTA a **"Cerrar solicitud"** y enviar `entregados: []` a la misma RPC, que ahora reconoce el caso.
- Mantener el botón de **Rechazar** como alternativa.

### 5. Validación

- Tras la migración, el panel del admin debe poder cerrar las 4 solicitudes existentes sin error.
- Crear una nueva sesión, generar solicitud desde recepción, cancelar la sesión directo como admin → la solicitud debe desaparecer del panel automáticamente.
- Flujo estándar (sesión activa → aprobar solicitud) debe seguir funcionando idéntico, generando mermas según entregas.

## Detalles técnicos

- Archivos a tocar: nueva migración SQL + `src/components/coworking/SolicitudesCancelacionSesionesPanel.tsx`.
- `CancelSessionDialog.tsx` y `cancelarSesionAtomico` no requieren cambios de contrato (mismo payload).
- Sin cambios en RLS ni en grants.