## Plan: Stock Actual Read-Only en Editar Insumo

### Contexto
Actualmente, el diálogo de editar insumo permite modificar el campo `stock_actual` directamente. El sistema intercepta ese cambio para exigir un motivo y canalizarlo por la RPC `ajustar_stock_insumo`. El usuario solicita que en el diálogo de **editar**, `stock_actual` sea de solo lectura, porque los ajustes de stock deben hacerse exclusivamente desde:
- **Compras**: para entradas por compra
- **Reportes**: para ajustes por auditoría física

En el diálogo de **nuevo insumo**, `stock_actual` seguirá siendo editable para dar de alta el stock inicial.

### Cambios a realizar

1. **UI del diálogo CRUD** (`InsumosTab.tsx`):
   - En el formulario del diálogo, renderizar `stock_actual` condicionalmente:
     - **Modo edición (`editingId !== null`)**: mostrar el valor actual como texto estático (o input `disabled`) en lugar de un campo editable. El input tendrá atributo `disabled` o se reemplazará por un label con el valor.
     - **Modo nuevo (`editingId === null`)**: mantener el input editable existente.
   - Ajustar el label para indicar "Stock actual" en ambos modos.

2. **Lógica de guardado** (`handleSave`):
   - Al guardar en modo **edición**, ya no es necesario interceptar cambios de stock ni mostrar el diálogo de motivo, porque el campo es read-only.
   - Eliminar el `useState` y la lógica asociada a `pendingStockChange`, `stockMotivoOpen`, `stockMotivo` y la función `confirmStockMotivo`.
   - Simplificar `handleSave`: en edición, enviar solo `payloadBase` sin `stock_actual`. En inserción, enviar `payloadBase` con `stock_actual`.

3. **Limpieza de estado innecesario**:
   - Eliminar estados: `stockMotivoOpen`, `stockMotivo`, `pendingStockChange`.
   - Eliminar función: `confirmStockMotivo`.
   - Eliminar el `AlertDialog` de ajuste manual de stock (líneas ~573-611).

### Archivos afectados
- `src/components/inventarios/InsumosTab.tsx`