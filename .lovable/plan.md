## Objetivo

Simplificar `ClienteSelector.tsx` para que la creación de un cliente nuevo sea **inmediata y silenciosa**, sin abrir un diálogo adicional que interrumpa el flujo de Check-In.

## Cambios en `src/components/coworking/ClienteSelector.tsx`

### 1. Eliminar el diálogo de creación
- Quitar todo el `Dialog` de "Nuevo cliente" (estado `createOpen`, `form`, `handleCreate` con campos teléfono/email).
- Quitar imports no usados (`Dialog*`, `Label`, `Input` del diálogo).

### 2. Nueva función `createClienteInline(nombre)`
- Valida que `nombre.trim()` no esté vacío.
- Inserta en `clientes` solo con `nombre_completo` (teléfono y email quedan `null`; se pueden completar después desde el Directorio).
- Devuelve la fila insertada (`id, nombre_completo, email, telefono`).
- Maneja errores con `toast.error` y `toast.success("Cliente creado")` discreto.
- Usa un flag `creating` para evitar dobles inserciones.

### 3. Acción directa desde el `CommandInput`
- En `CommandEmpty` (cuando no hay resultados y `query.trim()` no está vacío):
  - El botón "Crear …" llama directamente a `createClienteInline(query)`, y al resolver hace `onChange(nuevo)` + cierra el popover.
- Agregar `onKeyDown` al `CommandInput`: si el usuario presiona **Enter** y:
  - hay `query.trim()` y `results.length === 0` y no está `loading` → ejecuta `createClienteInline(query)`.
  - hay resultados → comportamiento por defecto de cmdk (seleccionar el resaltado).
- Mostrar un pequeño spinner inline mientras `creating` es true (sin bloquear con modal).

### 4. Preservar comportamiento existente
- Búsqueda debounced en tiempo real (250 ms) y realtime de `clientes` se mantienen.
- Botón "Limpiar" (X) y el callback `onChange(cliente | null)` siguen igual.
- El componente sigue devolviendo el objeto `Cliente` completo al padre (que ya extrae `id` y `nombre_completo`).

## Lo que NO cambia

- Schema de DB, RLS de `clientes`, ni `types.ts`.
- `DirectorioClientesTab.tsx` sigue siendo el lugar para capturar teléfono/email con validaciones (10 dígitos / `@`).
- Ningún otro componente que consuma `ClienteSelector`.

## Resultado UX

El cajero escribe "Juan Pérez", no aparece en resultados → presiona Enter (o clic en "Crear 'Juan Pérez'") → se inserta en BD, se selecciona automáticamente, el popover se cierra y el flujo de Check-In continúa sin fricción.
