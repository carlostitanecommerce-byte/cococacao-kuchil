## Mejor enfoque

En lugar de añadir un header con hamburguesa en tablet, hacer que la sidebar se comporte igual que en laptop: **siempre visible en modo icon-colapsado** desde tablet hacia arriba. Solo en celular real (<640px) seguirá siendo offcanvas (Sheet), porque ahí no cabe.

## Causa

El componente `Sidebar` de shadcn decide entre "icon-collapsed" y "offcanvas Sheet" según `useIsMobile()`, que hoy usa breakpoint **768px**. Todo lo menor a 768 → Sheet oculto → sin trigger visible.

## Cambios

### 1. `src/hooks/use-mobile.tsx`
Bajar `MOBILE_BREAKPOINT` de **768 a 640**. Así:
- Móvil real (<640px): sidebar en modo Sheet (offcanvas).
- Tablet (640–1023px): sidebar visible en modo icon-colapsado, igual que laptop.
- Laptop/desktop (≥1024px): sin cambios.

Verificado que `useIsMobile` solo lo consume `src/components/ui/sidebar.tsx`. `useIsDesktop` (usado en `PosPage`) no se toca.

### 2. `src/components/DashboardLayout.tsx`
**Revertir** el header sticky con `SidebarTrigger` que agregamos antes — ya no hace falta porque la barra colapsada queda visible y trae su propio trigger dentro del `SidebarHeader`. Volver a la versión simple original.

## Resultado

- Tablet (incluyendo tu viewport actual 767px): aparece la barra lateral colapsada con iconos, idéntica a laptop. Click en el icono para expandir/colapsar.
- Móvil <640px: sigue siendo Sheet offcanvas (cabe poco contenido, es lo correcto). En ese rango sí necesitaríamos un trigger externo si se vuelve un caso de uso real, pero hoy el sistema se opera en tablet/laptop, no en celulares <640.

## Lo que NO cambia

- `src/components/ui/sidebar.tsx` (shadcn intacto).
- `src/components/AppSidebar.tsx` (mantiene su `SidebarTrigger` interno que ya funciona en modo icon).
- `defaultOpen={false}` en `SidebarProvider` (colapsada por defecto).
- Ninguna lógica de negocio.
