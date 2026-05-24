# Plan: 3 hallazgos confirmados en Menú / Inventarios

Confirmé los 3 problemas leyendo el código actual:

- `CategoriasManager.confirmDelete` ejecuta `delete` aunque `uso_productos > 0` (solo muestra advertencia).
- `fetchProductos` (ProductosTab) y `fetchPaquetes` (PaquetesDinamicosTab) **no leen** el campo `error` de Supabase — si falla la red o RLS, la tabla queda vacía sin aviso.
- `handleSave` en ambos (`ProductosTab` y `PaquetesDinamicosTab`) guarda con `precio_venta = 0` sin ninguna confirmación.

---

## 1. Bloquear borrado duro de categorías en uso

**Archivo:** `src/components/categorias/CategoriasManager.tsx`

- En la tabla, calcular `enUso = (cat.ambito==='insumo' ? uso_insumos : uso_productos) > 0`.
- Si `enUso`: el botón **Eliminar** se renderiza `disabled`, envuelto en `<Tooltip>` con mensaje: *"No se puede eliminar: hay N {insumos|productos} usando esta categoría. Renombra la categoría o reasigna los elementos primero."*
- Si no está en uso: comportamiento actual (abre `AlertDialog` y elimina).
- Simplificar el `AlertDialog` de confirmación: ya no necesita la rama "está en uso" porque nunca llegará ahí; queda solo el mensaje estándar.
- Como defensa en `confirmDelete`: re-verificar `enUso` y abortar con `toast.error` si por algún motivo se intenta (evita race con realtime).

## 2. Manejo de errores en fetch inicial de Productos y Paquetes

**Archivos:** `src/components/inventarios/ProductosTab.tsx`, `src/components/menu/PaquetesDinamicosTab.tsx`

- Añadir estado `fetchError: string | null` en ambos componentes.
- En `fetchProductos` / `fetchPaquetes`: destructurar `{ data, error }`; si `error`, setear `fetchError(error.message)`, mostrar `toast.error('No se pudo cargar...')` y dejar la lista vacía. Si OK, limpiar `fetchError`.
- En el cuerpo de la tabla, cuando `!loading && fetchError`: renderizar una fila con icono de alerta, el mensaje y un botón **Reintentar** que llama nuevamente al fetch (`fetchProductos()` / `fetchPaquetes()`).
- También capturar `error` en el fetch secundario de `insumos` (ProductosTab) y `productos simples` (PaquetesDinamicosTab) con `toast.error` (no bloquea la UI pero avisa).

## 3. Confirmación al guardar con precio $0

**Archivos:** `src/components/inventarios/ProductosTab.tsx`, `src/components/menu/PaquetesDinamicosTab.tsx`

- Añadir estado `confirmZeroPriceOpen: boolean` y refactor: extraer el cuerpo actual de `handleSave` a `doSave()`.
- Nuevo `handleSave`:
  - Validaciones síncronas (nombre, grupos, etc.) primero.
  - Si `parseFloat(form.precio_venta) === 0` → `setConfirmZeroPriceOpen(true)` y `return` (no marca `saving` todavía).
  - Si no, llamar `doSave()`.
- Agregar `<AlertDialog>` "¿Guardar con precio $0.00? Este artículo no generará ingreso al venderse. Úsalo solo para cortesías o pruebas." con acciones **Cancelar** / **Sí, guardar gratis** → al confirmar cierra el diálogo y llama `doSave()`.

---

## Archivos afectados
- `src/components/categorias/CategoriasManager.tsx`
- `src/components/inventarios/ProductosTab.tsx`
- `src/components/menu/PaquetesDinamicosTab.tsx`

Sin migraciones ni cambios de backend.
