## Objetivo

Crear `src/components/coworking/ClienteSelector.tsx`: un selector tipo combobox con búsqueda en vivo sobre la tabla `clientes`, con opción inline de crear un cliente nuevo cuando no existe.

## Comportamiento

- **Trigger**: Botón estilo input (shadcn `Button` variant outline) que muestra el cliente seleccionado o un placeholder ("Buscar o crear cliente...").
- **Popover + Command**: Al abrir, muestra un `CommandInput` para teclear el nombre.
- **Búsqueda en BD**: Consulta `clientes` filtrando `nombre_completo ILIKE %query%`, ordenado por nombre, limitado a 20 resultados. Debounce de ~250 ms para no saturar la red.
- **Resultados**: Lista con nombre + (si existe) teléfono/email como subtítulo. Al hacer click llama `onChange({ id, nombre_completo })` y cierra el popover.
- **Sin resultados**: Muestra `CommandEmpty` con botón "Crear nuevo cliente: '{query}'" — abre un mini diálogo con campos `nombre_completo` (precargado con el texto), `telefono` y `email` opcionales. Al guardar inserta en `clientes`, devuelve el registro creado, lo selecciona automáticamente y cierra todo.
- **Limpiar selección**: Ícono `X` dentro del trigger cuando hay valor.
- **Realtime**: Suscripción a INSERT/UPDATE/DELETE de `clientes` para refrescar la lista si está abierta (patrón ya usado en `useCoworkingData`).

## API del componente

```ts
interface ClienteSelectorProps {
  value: { id: string; nombre_completo: string } | null;
  onChange: (cliente: Cliente | null) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}
```

Reutiliza la interfaz `Cliente` ya añadida en `src/components/coworking/types.ts`.

## Detalles técnicos

- Stack UI: `Popover`, `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `Dialog`, `Input`, `Button` (todos ya presentes en `src/components/ui`).
- Estado interno: `open`, `query`, `results`, `loading`, `createOpen`, `creating`, form state del diálogo de creación.
- Debounce con `setTimeout` + cleanup en `useEffect([query])`; cancelación de fetches obsoletos con bandera local.
- Errores de red/inserción: `toast` (sonner) con mensaje legible; el componente no se rompe si falla la consulta.
- Inserción de cliente: `supabase.from('clientes').insert({ nombre_completo, email, telefono }).select().single()`. Se asume que las políticas RLS actuales permiten a roles operativos crear/leer (a validar antes de implementar; si no, se añade migración en una fase posterior).
- Sin acoplamiento a coworking: el componente vive en `coworking/` pero no depende de sesiones/áreas, por si se reutiliza luego en POS/Caja.

## Fuera de alcance

- No integra el selector en ningún diálogo existente (CheckIn, Reservaciones, etc.) — eso será una fase posterior.
- No edita ni elimina clientes existentes.
- No cambia el esquema de la tabla `clientes` ni sus políticas (se revisarán al integrarlo).
