## Objetivo (Fase 3.2)
Al confirmar una venta en Caja que incluya una **Membresía de Coworking**, activar automáticamente la membresía en la base de datos (`estado: 'pendiente_pago' → 'activa'`).

## Contexto detectado
- En `src/components/caja/CajaCheckoutPanel.tsx`, el flujo post-cobro exitoso ya existe en `handleSuccess(ventaId)` (líneas 256–276), donde ya se marca la orden pendiente como `cobrada`.
- Cada ítem de membresía creado en Fase 3.1 lleva:
  - `tipo_concepto: 'coworking'`
  - `producto_id: null`
  - `lineId: 'membresia-<UUID>'`
  - `membresia_id: '<UUID>'` (campo clave)
  - `tarifa_id: '<UUID>'`
- La tabla real es `coworking_membresias` (no `coworking_membresias_activas`).

## Cambios

### 1. `src/components/caja/CajaCheckoutPanel.tsx` — dentro de `handleSuccess`
Justo antes del `clear()`, extraer todos los `membresia_id` presentes en el carrito y marcar cada uno como `activa`:

```ts
// Activar membresías coworking incluidas en esta venta
const membresiaIds = items
  .filter((i) => i.tipo_concepto === 'coworking' && !!i.membresia_id)
  .map((i) => i.membresia_id as string);

if (membresiaIds.length > 0) {
  const { error: memErr } = await supabase
    .from('coworking_membresias')
    .update({ estado: 'activa' })
    .in('id', membresiaIds)
    .eq('estado', 'pendiente_pago'); // idempotente: no re-activa canceladas/vencidas

  if (memErr) {
    console.error('No se pudo activar la membresía', memErr);
    toast.error('Venta cobrada, pero la membresía quedó pendiente. Avisa al administrador.');
  } else {
    // Audit log por cada membresía activada
    await supabase.from('audit_logs').insert(
      membresiaIds.map((mid) => ({
        user_id: (await supabase.auth.getUser()).data.user?.id ?? null,
        accion: 'membresia_activada',
        descripcion: `Membresía activada tras cobro (venta ${ventaId})`,
        metadata: { membresia_id: mid, venta_id: ventaId },
      }))
    );
    toast.success('Membresía activada');
  }
}
```

Nota implementación:
- El `await supabase.auth.getUser()` dentro del `.map` se resolverá una sola vez antes del insert (se extrae a una const `userId` previa para no llamarlo N veces).
- El filtro `.eq('estado', 'pendiente_pago')` hace la operación idempotente frente a reintentos o membresías canceladas.
- No se toca la lógica de `ordenes_pos_pendientes` ni de propinas/comisiones/reportes.

### 2. Sin cambios de esquema
La tabla `coworking_membresias` ya existe, ya tiene el estado `pendiente_pago`/`activa` y las políticas RLS necesarias. **No** se requiere migración.

## Verificación
- Type-check pasa (usa campos ya declarados en `CartItem` desde la fase 3.1).
- Flujo esperado: vender membresía → orden aparece en Caja → cobrar → la membresía queda `activa` y visible como tal en Coworking.
