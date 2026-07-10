## Ajustes de scroll en "Vender Membresía"

### 1. Scroll interno del diálogo `VenderMembresiaDialog.tsx`
El `DialogContent` crece con el contenido y se recorta en pantallas cortas. Voy a:

- Limitar la altura del `DialogContent` con `max-h-[90vh]` y hacerlo `flex flex-col`.
- Envolver la sección del formulario (el `<div className="space-y-4">`) en un contenedor con `flex-1 overflow-y-auto pr-1 -mr-1` para que el scroll interno aparezca solo cuando haga falta, dejando fijos el `DialogHeader` y el `DialogFooter`.

Sin cambios de lógica; solo clases.

### 2. Scroll con rueda/trackpad en `ClienteSelector.tsx`
El `CommandList` del popover permite arrastrar la barra pero ignora el wheel/two-finger scroll. Esto ocurre porque cmdk marca los items como `data-disabled` cuando no hay `value` filtrado o por el foco atrapado por el `CommandInput` (los eventos wheel llegan al input, no a la lista).

Ajustes mínimos:

- Añadir clases explícitas al `CommandList` para asegurar scroll nativo: `className="max-h-72 overflow-y-auto overscroll-contain"`.
- En el `PopoverContent`, agregar `onWheel={(e) => e.stopPropagation()}` para evitar que Radix Popover intercepte el wheel event y lo trate como scroll externo (causa típica cuando el popover está dentro de un contenedor scrolleable).
- Añadir `onWheelCapture` en el `CommandList` que redirija el deltaY al propio elemento con `e.currentTarget.scrollTop += e.deltaY` como fallback, para el caso en que el focus esté en el `CommandInput`.

Sin cambios de comportamiento de búsqueda ni de selección.

### Archivos a modificar
- `src/components/coworking/VenderMembresiaDialog.tsx` — solo clases en `DialogContent` y wrapper del formulario.
- `src/components/coworking/ClienteSelector.tsx` — clases y handlers de wheel en `PopoverContent` / `CommandList`.

### Fuera de alcance
- No se toca lógica de negocio, tipos, ni la estructura del ítem enviado a Caja.
- No se cambia el estilo visual del popover ni del diálogo más allá del scroll.
