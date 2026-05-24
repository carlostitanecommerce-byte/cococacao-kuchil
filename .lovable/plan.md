## Plan de remediación: stock, RLS y reintegro de upsells

Objetivo: blindar los ajustes de inventario en `insumos`, garantizar trazabilidad atómica y cerrar el hueco de reintegro de stock cuando se cancelan upsells de coworking con `venta_id IS NULL`.

---

### 1. RPC atómica para ajuste manual de stock

Crear `ajustar_stock_insumo(_insumo_id uuid, _nuevo_stock numeric, _motivo text)`:
- `SECURITY DEFINER`, `SET search_path = public`.
- Valida que el llamador tenga rol `administrador` (vía `has_role`).
- Valida `_nuevo_stock >= 0` y que `_motivo` no esté vacío.
- En una sola transacción:
  1. Lee `stock_actual` previo con `FOR UPDATE`.
  2. Si no hay cambio, retorna sin tocar nada.
  3. Actualiza `stock_actual` y `updated_at`.
  4. Inserta `audit_logs` con acción `ajuste_manual_stock_insumo`, descripción legible y metadata (`insumo_id`, `stock_anterior`, `stock_nuevo`, `diferencia`, `motivo`).
- `REVOKE ALL FROM PUBLIC` y `GRANT EXECUTE TO authenticated`.

### 2. Bloquear edición directa de columnas sensibles en `insumos`

Trigger `BEFORE UPDATE ON public.insumos` (`SECURITY DEFINER`) que rechace cambios a `stock_actual` y `costo_unitario` cuando provengan de una sesión de cliente:
- Permite el cambio si `current_setting('app.bypass_insumo_guard', true) = 'on'` (lo establecen las RPCs internas: `ajustar_stock_insumo`, `revertir_stock_venta`, `aplicar_compra_insumo`, `reintegrar_inventario_cancelacion`, trigger de mermas/compras).
- En cualquier otro caso, lanza `RAISE EXCEPTION 'stock_actual/costo_unitario solo se modifican vía RPC'`.
- Las RPCs existentes que tocan estas columnas se actualizan para hacer `PERFORM set_config('app.bypass_insumo_guard','on', true)` al inicio.

Con esto la policy `FOR ALL` puede quedarse (admins siguen pudiendo cambiar `nombre`, `categoria`, `stock_minimo`, `presentacion`, etc.), pero los campos críticos quedan canalizados a RPC.

### 3. Reintegro de upsells de coworking al cancelar sesión

Modificar la RPC `cancelar_sesion_coworking` (o el path donde hoy procesa `items_entregados`):
- Para cada `detalle_ventas` ligado a la sesión con `venta_id IS NULL` y `tipo_concepto = 'producto'`:
  - Si **no** está en la lista de entregados → reintegrar stock vía recetas (mismo cálculo que `reintegrar_inventario_cancelacion`) usando `set_config('app.bypass_insumo_guard','on',true)`.
  - Si está en entregados parcial → reintegrar la diferencia y registrar la cantidad entregada como merma (ya existe esa lógica para amenities).
- Eliminar/marcar como canceladas las líneas de `detalle_ventas` reintegradas (mantener registro vía `audit_logs` con detalle JSON).
- Audit log enriquecido con `lineas_reintegradas`, `cantidad_total`, `insumos_afectados`.

Adicionalmente, extender `reintegrar_inventario_cancelacion` (trigger de `ventas`) para que, antes de su `FOR d IN ... WHERE venta_id = NEW.id`, también barra líneas con `coworking_session_id = NEW.coworking_session_id AND venta_id IS NULL` que pudieran reabrirse por el flujo de reversión de venta de coworking. Esto cubre el caso edge: venta cobrada → revertida a `pendiente_pago` (los upsells vuelven a `venta_id NULL`) → la sesión termina cancelándose.

### 4. Frontend: usar la nueva RPC

`InsumosTab.tsx` (`handleSave`):
- Separar el flujo: si `editingId` y cambió `stock_actual`, primero llamar `supabase.rpc('ajustar_stock_insumo', { _insumo_id, _nuevo_stock, _motivo })` y, si tiene éxito, hacer el `update` sin `stock_actual`.
- Quitar los `audit_logs.insert` redundantes (los hace la RPC).
- Mostrar diálogo pidiendo motivo cuando el usuario edite el campo de stock (obligatorio para la RPC).
- Si `costo_unitario` cambia, igual: nueva RPC `ajustar_costo_insumo(_insumo_id, _nuevo_costo, _motivo)` siguiendo el mismo patrón (el cambio de costo dispara recalculo de márgenes que ya existe).

### 5. Verificación

- Linter Supabase tras la migración.
- Pruebas manuales:
  1. Editar stock como admin desde UI → requiere motivo, queda audit, stock cambia.
  2. Intento de `UPDATE insumos SET stock_actual = 999` directo (simulado vía `supabase.from('insumos').update`) → debe fallar con el mensaje del trigger.
  3. Sesión coworking con upsells (no entregados) → cancelar → stock reintegrado correctamente.
  4. Venta coworking cobrada → revertir a `pendiente_pago` → cancelar sesión sin marcar entregas → stock reintegrado.

---

### Detalle técnico

```text
Migración 1: trigger guard + RPC ajuste stock + RPC ajuste costo
Migración 2: extender reintegrar_inventario_cancelacion + cancelar_sesion_coworking
Frontend:   src/components/inventarios/InsumosTab.tsx (handleSave + diálogo motivo)
```

Archivos a tocar:
- `supabase/migrations/<timestamp>_insumos_guard_and_rpcs.sql`
- `supabase/migrations/<timestamp>_reintegro_upsells_coworking.sql`
- `src/components/inventarios/InsumosTab.tsx`
- (opcional) pequeño componente `AjusteStockMotivoDialog` para capturar el motivo.

No requiere cambios en `types.ts` (lo regenera Supabase).
