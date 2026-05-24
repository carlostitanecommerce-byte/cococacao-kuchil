## Verificación

Las 3 observaciones son **ciertas**:

1. **Realtime ausente en ComprasTab/MermasTab** — Solo `InsumosTab` y `ProductosTab` se suscriben a `postgres_changes`. `ComprasTab` y `MermasTab` usan `fetchData()` manual en `useEffect([])`, así que dos usuarios simultáneos quedan desincronizados hasta refrescar.
2. **Auditoría física sin "entrada por ajuste"** — En `aplicar_auditoria_inventario` (migración `20260427011049`), si `v_diferencia > 0` solo actualiza `stock_actual` y deja un `audit_log`, pero **no inserta ningún movimiento positivo** (no existe tabla de entradas por ajuste ni inserción en `compras_insumos`). La diferencia positiva queda sin contrapartida cuantitativa, solo en bitácora.
3. **`fetchInsumos` ignora `error`** — `const { data } = await supabase.from('insumos').select(...)`; no se desestructura `error` ni se muestra toast. Mismo patrón en `ComprasTab`, `MermasTab` y otros.

---

## Plan de remediación

### 1. Realtime en ComprasTab y MermasTab
Replicar el patrón de `InsumosTab` en ambos componentes:

- `ComprasTab.tsx`: añadir `useEffect` con canal `inv-compras-realtime` suscrito a `postgres_changes` sobre `compras_insumos` (event `*`) que dispare `fetchData()`. También suscribir a `insumos` para refrescar el selector de insumos cuando cambien costos/nombres.
- `MermasTab.tsx`: canal `inv-mermas-realtime` sobre `mermas` (event `*`) → `fetchData()`. Suscribir también a `insumos` para mantener el selector y los nombres consistentes.
- Cleanup con `supabase.removeChannel(channel)` en el retorno del `useEffect`.

### 2. Registrar entradas por ajuste positivo en auditoría física
Nueva migración que reemplaza `aplicar_auditoria_inventario`:

- Cuando `v_diferencia > 0`, insertar fila en `compras_insumos` como entrada por ajuste:
  - `insumo_id = v_insumo_id`
  - `cantidad_unidades = v_diferencia` (en unidad base)
  - `cantidad_presentaciones = 0`, `costo_presentacion = 0`, `costo_total = 0` (no afecta costo promedio, es solo regularización)
  - `nota = 'Entrada por ajuste de auditoría física'`
  - `usuario_id = v_user`
- Para no contaminar el cálculo de costo promedio del trigger de compras, marcar la fila con una nota especial **o** preferiblemente crear columna `tipo` (`'compra' | 'ajuste_positivo'`) en `compras_insumos` y excluir `'ajuste_positivo'` del recálculo de costo. Decisión: añadir columna `tipo TEXT NOT NULL DEFAULT 'compra'` y actualizar el trigger de recálculo de costo para filtrar `WHERE tipo = 'compra'`.
- Mantener el `audit_logs` ya existente para trazabilidad.
- Mantener `mermas` solo para diferencias negativas (sin cambio).

Esto cierra la trazabilidad: toda variación de stock tiene un evento cuantitativo (compra, merma o ajuste positivo) además de la bitácora.

### 3. Manejo de errores en fetchers
- `InsumosTab.fetchInsumos`: desestructurar `{ data, error }`, si `error` mostrar `toast.error('No se pudieron cargar los insumos: ' + error.message)` y dejar el estado previo (no vaciar con `[]` salvo primera carga).
- Mismo patrón en `ComprasTab.fetchData` y `MermasTab.fetchData` (revisar ambos y aplicar el mismo manejo).
- Asegurar `setLoading(false)` en `finally`.

### Archivos afectados
- `src/components/inventarios/InsumosTab.tsx` (manejo de error)
- `src/components/inventarios/ComprasTab.tsx` (realtime + error)
- `src/components/inventarios/MermasTab.tsx` (realtime + error)
- Nueva migración SQL:
  - `ALTER TABLE compras_insumos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'compra'`
  - Actualizar trigger de recálculo de costo promedio para `WHERE tipo = 'compra'`
  - `CREATE OR REPLACE FUNCTION aplicar_auditoria_inventario` con la rama positiva insertando en `compras_insumos` con `tipo='ajuste_positivo'`

Sin cambios en `types.ts` manuales (se regeneran tras la migración).