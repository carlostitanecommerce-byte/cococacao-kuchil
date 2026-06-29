## Objetivo
Al crear un cliente al vuelo desde `ClienteSelector` (usado en Check-In y Reservaciones), capturar también **teléfono** y **correo** con las mismas validaciones del Directorio, sin sacar al cajero del flujo.

## Cambios

### 1. `src/components/coworking/clienteSchema.ts` (nuevo)
- Extraer el `clienteSchema` de `DirectorioClientesTab.tsx` a un archivo compartido.
- Reglas: `nombre_completo` no vacío, `telefono` exactamente 10 dígitos (ignora no numéricos), `email` válido con `@`.
- `DirectorioClientesTab.tsx` se actualiza solo para importar desde aquí (sin cambios funcionales).

### 2. `src/components/coworking/ClienteSelector.tsx`
- Reemplazar la creación silenciosa (que insertaba `telefono: null, email: null`) por la apertura de un **mini-diálogo de creación rápida** que pide nombre + teléfono + email.
- Disparadores para abrir el mini-diálogo:
  - **Enter** en el `CommandInput` cuando no hay resultados.
  - Click en el botón "Crear "[nombre]"" del `CommandEmpty`.
- Campos del mini-diálogo:
  - **Nombre completo** (prellenado con el query, editable, requerido).
  - **Teléfono** (requerido, 10 dígitos, hint "10 dígitos").
  - **Correo electrónico** (requerido, formato válido, hint "Debe incluir @").
- Validación con `zod` reutilizando `clienteSchema`.
- Botones: **Cancelar** y **Crear y seleccionar** (spinner `Creando…`).
- Al éxito: `insert` en `clientes`, `onChange(nuevoCliente)`, cerrar mini-diálogo, limpiar query, toast de éxito.
- Al error de Supabase (p. ej. unicidad): `toast.error` y mantener el mini-diálogo abierto para corregir.

### 3. Anidamiento correcto Popover + Dialog (shadcn / Radix)
Para evitar que el Dialog quede atrapado dentro del Popover (problemas de focus trap, z-index, cierre por click-outside del Popover que mata al Dialog):

- **Mover el `<Dialog>` del mini-formulario FUERA del `<Popover>`**, como hermano dentro de un `<>` fragmento raíz del componente. No vivir como hijo del `<PopoverContent>`.
- Estado nuevo: `const [miniDialogOpen, setMiniDialogOpen] = useState(false);` y `const [draftNombre, setDraftNombre] = useState('');` para arrastrar el nombre tecleado.
- Secuencia exacta al disparar la creación (Enter o botón "Crear"):
  1. `setDraftNombre(query.trim());`
  2. `setOpen(false);` — cierra el Popover/Combobox **primero**.
  3. En el siguiente tick (`requestAnimationFrame` o `setTimeout(..., 0)`) → `setMiniDialogOpen(true);` para abrir el Dialog ya con el Popover desmontado y sin pelearse por el focus trap.
- El `<Dialog open={miniDialogOpen} onOpenChange={setMiniDialogOpen}>` vive al lado del `<Popover>` en el JSX raíz del `ClienteSelector`.
- Al cerrar el mini-diálogo (cancelar o éxito): `setMiniDialogOpen(false)`, limpiar `draftNombre`, no reabrir el Popover (el cliente ya quedó seleccionado o el cajero canceló).

### 4. Sin cambios en
- Backend / tabla `clientes` (los campos ya existen; solo los hacemos requeridos a nivel UI para la creación rápida).
- `CheckInDialog.tsx` ni `ReservacionesTab.tsx`: siguen consumiendo `ClienteSelector` con la misma interfaz `{ id, nombre_completo }`.

## UX final
Cajero escribe el nombre → Enter → se cierra el combobox → se abre el mini-diálogo con nombre prellenado, llena teléfono y email → "Crear y seleccionar" → vuelve al flujo de Check-In/Reservación con el cliente ya seleccionado y completo en el directorio.
