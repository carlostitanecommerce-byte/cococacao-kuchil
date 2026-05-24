## Fase 2 (revisada): Un solo botón con detección automática

### Objetivo
Mantener el botón existente "Procesar pago en Caja" / "Cobrar" como única acción del POS. El botón decide automáticamente:

- **Si Caja está libre** (sin ticket activo esperando cobro) → comportamiento actual: navega a `/caja` con el carrito en el store.
- **Si Caja está ocupada** (ya hay órdenes pendientes esperando ser cobradas) → en vez de pisar ese ticket, parquea la orden actual del POS en `ordenes_pos_pendientes` y limpia el carrito local.

El cajero atiende la cola en su tiempo y nunca pierde la cuenta en curso.

### Cómo se detecta "Caja ocupada"

Antes de actuar, hacer una consulta rápida a Supabase:

```ts
const { count } = await supabase
  .from('ordenes_pos_pendientes')
  .select('id', { count: 'exact', head: true })
  .eq('estado', 'pendiente');
```

- `count > 0` → hay órdenes en la cola esperando ser cobradas → **parquear**.
- `count === 0` → la cola está vacía y Caja puede tomar el ticket de inmediato → **navegar a /caja** (flujo actual).

Esta señal es honesta: si hay aunque sea una orden pendiente, significa que el cajero todavía no la ha cerrado, por lo tanto está "ocupado" y la nueva orden debe esperar su turno. Cuando no hay nada en cola, el comportamiento original se preserva intacto.

### Flujo del clic en el botón único

`goToCheckout()` queda así:

1. **Sesión de coworking activa** (`isOpenAccount === true`) → `chargeToOpenAccount()` (sin cambios, label sigue "Cargar a Cuenta").
2. **Sin sesión de coworking:**
   - Consultar `count` de pendientes (rápido, `head: true`).
   - Si `count > 0`:
     - Abrir `AlertDialog` con input opcional de "Nombre del cliente / referencia" (máx 60 chars).
     - Al confirmar: INSERT en `ordenes_pos_pendientes` con el payload descrito en el plan original (items JSONB, total, caja_id resuelta del turno abierto, tipo_consumo='sitio'), toast con folio (`#0007 enviada a Caja`), `clear()`, cerrar Sheet en mobile. Sin navegar.
   - Si `count === 0`:
     - `navigate('/caja')` (comportamiento actual sin cambios).

### Label del botón

Mantenemos los labels actuales (`Procesar pago en Caja` / `Cobrar` / `Cargar a Cuenta`). No se agrega un segundo botón. La decisión es transparente para el cajero; si la cola tiene órdenes verá la confirmación de parqueo, si no verá la navegación normal.

Opcionalmente, para dar feedback antes del clic, se puede precargar el count con un pequeño realtime listener en `PosPage` y mostrar un badge sutil ("Caja con X pendientes") junto al botón. **Esto queda fuera de Fase 2** para no inflar el alcance — Fase 3 (UI de cola en Caja) puede agregar el indicador en POS si lo necesitas.

### Lo que NO cambia respecto al plan anterior

- Misma tabla `ordenes_pos_pendientes` ya creada en Fase 1.
- Mismo payload de INSERT (items completos en JSONB, total, caja_id resuelta, cliente opcional).
- Mismo dialog de confirmación con campo opcional de nombre.
- No se envía a KDS al parquear (se mantiene para Fase 3).
- No se valida stock al parquear (se valida al cobrar).
- No se toca `CartPanel.tsx`.

### Archivos afectados

- `src/pages/PosPage.tsx`
  - Añadir estados `parking`, `parkDialogOpen`, `clienteRef`.
  - Reescribir `goToCheckout()` con la lógica de detección.
  - Función `parkOrder()` que hace el INSERT + toast + `clear()`.
  - Renderizar `<AlertDialog>` con input de nombre opcional (reutilizado tanto en desktop como en mobile, ya que el dialog vive a nivel de página).

Sin migraciones nuevas, sin cambios en otras vistas.
