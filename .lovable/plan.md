## Problema

Cuando se crea un cliente al vuelo desde el mini-diálogo de `ClienteSelector` dentro de `CheckInDialog`, aparece el toast rojo *"Capacidad excedida — Solo hay 0 lugar(es) disponible(s)"* aunque el usuario aún no haya elegido área ni pax.

## Causa raíz

Radix `Dialog` portea el contenido al `body`, pero **React propaga los eventos sintéticos a través del árbol de componentes, no del DOM**. Esto significa que el `submit` del `<form>` del mini-diálogo (creación rápida de cliente) **burbujea hasta el `<form>` de `CheckInDialog`** que lo contiene en el árbol de React.

Resultado: al pulsar *"Crear y seleccionar"* se dispara también `handleCheckIn`. Como en ese momento `selectedAreaId` está vacío, `getAvailablePax('')` devuelve `0`, `pax (1) > available (0)` y el guard lanza el toast "Capacidad excedida". El mismo problema ocurriría en `ReservacionesTab` y en cualquier formulario padre que use `ClienteSelector`.

## Plan

Editar **únicamente** `src/components/coworking/ClienteSelector.tsx` para aislar los eventos del mini-diálogo del formulario padre:

1. En `handleCreateCliente`, llamar `e.stopPropagation()` además de `e.preventDefault()` para que el submit del mini-diálogo no burbujee al form del padre.
2. Añadir `onClick={(e) => e.stopPropagation()}` en el `<form>` del mini-diálogo como defensa en profundidad (clics dentro del Dialog tampoco deben afectar al padre).
3. En el `onKeyDown` del `CommandInput`, cuando ya se llama `e.preventDefault()` y `e.stopPropagation()` al detectar Enter, mantener ese comportamiento (ya está) y verificar que el botón "Crear …" dentro de `CommandEmpty` use `type="button"` (ya lo es) — sin cambios funcionales adicionales.
4. Asegurar que el botón Cancelar del mini-diálogo no propague: añadir `e.stopPropagation()` en su `onClick`.

No se tocan `CheckInDialog.tsx`, `ReservacionesTab.tsx` ni el schema/validaciones: el fix queda contenido en el componente reusable.

## Verificación

- Abrir Check-in → escribir un nombre nuevo → Enter → completar mini-diálogo → *Crear y seleccionar*: debe crear el cliente, seleccionarlo en el combobox y **no** mostrar el toast "Capacidad excedida". El form de check-in queda intacto, listo para que el usuario elija área, pax y horas.
- Repetir el flujo desde *Reservaciones* para confirmar que tampoco dispara el submit del padre.
