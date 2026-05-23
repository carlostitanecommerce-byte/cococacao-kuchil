# Plan: Correcciones a sesiones pendientes de pago

Corregir las 3 observaciones detectadas en la auditoría del flujo de cobro de coworking en Caja, para dejarlo 100% listo para producción.

---

## Paso 1 — Liberar `pendingSessionId` atascado en URL

**Archivo:** `src/components/caja/CoworkingSessionSelector.tsx`

**Problema:** Cuando el usuario llega a `/caja?session=<id>` desde el redirect de coworking, pero esa sesión ya fue cobrada o cancelada por otro cajero, el `useEffect` que consume `pendingSessionId` solo dispara `onPendingConsumed()` si encuentra la sesión en el listado. Si no aparece, el query param queda colgado en la URL indefinidamente y puede reactivarse incorrectamente en futuros refrescos del listado.

**Corrección:**
- Ampliar el `useEffect` para que, cuando `!loading && pendingSessionId` y la sesión NO está en `sessions`, también llame `onPendingConsumed?.()`.
- Mantener el comportamiento actual cuando sí la encuentra (importar + consumir).

```ts
useEffect(() => {
  if (!pendingSessionId || loading) return;
  const session = sessions.find(s => s.id === pendingSessionId);
  if (session) {
    handleSelect(session);
  }
  // En ambos casos (encontrada o no), liberar la URL
  onPendingConsumed?.();
}, [pendingSessionId, loading, sessions]);
```

---

## Paso 2 — Manejo de errores en `fetchSessions`

**Archivo:** `src/components/caja/CoworkingSessionSelector.tsx`

**Problema:** Si Supabase rechaza el `select` de `coworking_sessions` o de `areas_coworking`, no hay `try/catch` ni se actualiza `loading`. El componente queda en estado "Cargando..." indefinido sin feedback al cajero.

**Corrección:**
- Envolver `fetchSessions` en `try/catch/finally`.
- En `catch`: mostrar `toast` destructivo con el mensaje de error (legible, no UUID).
- En `finally`: garantizar `setLoading(false)`.
- Validar también el error del segundo query (`areas_coworking`) — si falla, no romper, dejar `area_nombre: 'Desconocida'`.

```ts
const fetchSessions = async () => {
  try {
    const { data: sessData, error: sessErr } = await supabase
      .from('coworking_sessions')
      .select('...')
      .eq('estado', 'pendiente_pago');
    if (sessErr) throw sessErr;
    // ... resto de la lógica
  } catch (e: any) {
    toast({
      variant: 'destructive',
      title: 'No se pudieron cargar las sesiones',
      description: e.message ?? 'Error desconocido',
    });
  } finally {
    setLoading(false);
  }
};
```

---

## Paso 3 — Preservar desglose de `monto_acumulado` al finalizar sesión

**Archivos:**
- Migración SQL sobre la función RPC `cerrar_cuenta_coworking`
- (Sin cambios de UI)

**Problema:** Al finalizar la sesión, la RPC sobreescribe `coworking_sessions.monto_acumulado` con `total_bruto`. Esto pierde el desglose original (tiempo vs. consumos vs. amenities) que se había ido acumulando durante la sesión. Aunque los detalles viven en `detalle_ventas`, los reportes históricos de "ingreso por sesión" se quedan sin la composición previa al cobro.

**Corrección (decisión doctrinal):**

Dado que la doctrina del sistema dice que `detalle_ventas` es la fuente de verdad transaccional, mantenemos `monto_acumulado` como **monto cobrado final** (lo que ya hace la RPC), pero agregamos una nueva columna `monto_acumulado_preview` (numeric, nullable) que conserve el valor que tenía la sesión **justo antes** de finalizar.

Pasos:
1. **Migración:**
   - `ALTER TABLE coworking_sessions ADD COLUMN monto_acumulado_preview numeric;`
   - Modificar la RPC `cerrar_cuenta_coworking` para que, antes de sobrescribir `monto_acumulado`, copie su valor actual a `monto_acumulado_preview` en el mismo `UPDATE`.
2. **Sin cambios de UI/cliente** en este sprint. La columna queda disponible para reportes futuros (Menu Engineering / Coworking Analysis) sin modificar el contrato actual.

Esto preserva la trazabilidad histórica del importe acumulado preliminar sin alterar el flujo de cobro.

---

## Sección técnica (resumen)

| # | Archivo / Objeto | Cambio | Riesgo |
|---|---|---|---|
| 1 | `CoworkingSessionSelector.tsx` (useEffect pendingSessionId) | Llamar `onPendingConsumed()` también cuando la sesión no existe | Bajo — solo limpia URL |
| 2 | `CoworkingSessionSelector.tsx` (fetchSessions) | `try/catch/finally` + toast de error | Bajo — mejora robustez |
| 3 | Migración + RPC `cerrar_cuenta_coworking` | Nueva columna `monto_acumulado_preview` + copia previa al overwrite | Bajo — campo aditivo, sin cambios de contrato |

## Validación post-cambio

- **Obs. 1:** Visitar `/caja?session=<id-inexistente>` → la URL se limpia sola en <1s, listado responde normal.
- **Obs. 2:** Simular error (revocar permisos RLS temporalmente en consola) → aparece toast "No se pudieron cargar las sesiones" y el componente sale de "Cargando...".
- **Obs. 3:** Crear sesión, agregar consumos, cobrar → consultar `SELECT monto_acumulado, monto_acumulado_preview FROM coworking_sessions WHERE id = '<id>'` y confirmar que `monto_acumulado_preview` conserva el valor anterior al cobro y `monto_acumulado` refleja el `total_bruto` final.

## Fuera de alcance

- No se tocan cálculos de tarifa, IVA, propina ni descuentos (ya validados en el sprint anterior).
- No se modifica `CajaCheckoutPanel`, `ConfirmVentaDialog` ni el carrito.
- No se cambian políticas RLS ni roles.
