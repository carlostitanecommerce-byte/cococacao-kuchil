## Problema

En tablet (ancho < 768px, tu viewport actual es 767px) la sidebar del componente shadcn `Sidebar` cambia automáticamente a modo **offcanvas** (un `Sheet` lateral oculto por defecto), en lugar del modo colapsado tipo "icon" que se ve en laptop/desktop. Como el único `SidebarTrigger` del proyecto vive **dentro** del propio `AppSidebar` (en `SidebarHeader`), cuando la barra está oculta en offcanvas no hay ningún botón visible para abrirla → quedas sin navegación.

En laptop funciona porque ahí la barra siempre es visible (modo `icon`, 3rem de ancho) gracias a `collapsible="icon"` y `defaultOpen={false}`.

## Causa raíz

1. `useIsMobile()` (`src/hooks/use-mobile.tsx`) usa breakpoint 768px → todo lo menor se considera "mobile".
2. El componente `Sidebar` de shadcn, cuando `isMobile === true`, se renderiza como `Sheet` (offcanvas) sin importar `collapsible="icon"`.
3. El `SidebarTrigger` está dentro de `AppSidebar > SidebarHeader`, por lo que desaparece junto con la barra.

No queremos tocar `src/components/ui/sidebar.tsx` (es shadcn) ni cambiar el breakpoint global, porque romperíamos el comportamiento real en celular.

## Solución

Agregar un **header superior persistente** en `DashboardLayout` que contenga un `SidebarTrigger` visible solo en tablet/móvil (`lg:hidden`). En laptop/desktop (`lg` y mayor) ese header no estorba y se mantiene el trigger interno de la barra colapsada como hoy.

### Cambio único: `src/components/DashboardLayout.tsx`

- Importar `SidebarTrigger` desde `@/components/ui/sidebar`.
- Agregar dentro del `<main>` una franja superior delgada (`h-12`, `border-b`, `bg-background/95 backdrop-blur`, `sticky top-0 z-30`) con clase `lg:hidden` que contiene solo el `SidebarTrigger`. Así:
  - En tablet/móvil: aparece la barrita con el botón hamburguesa → al tocarlo abre la sidebar como Sheet lateral, igual que en mobile.
  - En laptop/desktop: el header no se muestra (`lg:hidden`) y la sidebar sigue visible colapsada como hoy.
- Mantener `defaultOpen={false}` en `SidebarProvider` (ya está). Esto asegura que cuando el usuario abra y cierre en tablet, el estado por defecto sea colapsado, consistente con laptop.

```text
┌──────────────────────────────────────────┐
│ [☰]  ← SidebarTrigger (solo <lg)         │  ← header sticky nuevo
├──────────────────────────────────────────┤
│                                          │
│           contenido de la página         │
│                                          │
└──────────────────────────────────────────┘
```

### Lo que NO cambia

- `src/components/ui/sidebar.tsx` (shadcn).
- `src/components/AppSidebar.tsx` (el trigger interno queda; se usa en desktop colapsado y dentro del Sheet en móvil/tablet para cerrarla).
- El hook `useIsMobile` ni el breakpoint 768px.
- Ninguna lógica de negocio (POS, caja, etc.).

## Resultado esperado

- Tablet (≤1023px): aparece un header superior con botón hamburguesa que abre/cierra la sidebar como panel lateral.
- Laptop/desktop (≥1024px): sin cambios visuales; sidebar colapsada por defecto con sus iconos, igual que hoy.
- Móvil: igual que tablet (ya era offcanvas, ahora con trigger accesible).
