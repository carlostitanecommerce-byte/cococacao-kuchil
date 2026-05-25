Problema: En tablet, el sidebar inicia colapsado (`defaultOpen={false}`) como una barra de solo 48px de ancho con iconos muy juntos (`gap-1`). El usuario no la percibe como navegable y es difícil de tocar.

Solución:

### 1. DashboardLayout.tsx — Iniciar sidebar expandido

Cambiar `defaultOpen={false}` a `defaultOpen={true}`. Esto hace que en tablet y desktop el sidebar aparezca **expandido con texto e iconos**, mucho más visible y usable. El usuario puede colapsarlo manualmente después si lo desea; el estado se guarda en cookie.

### 2. AppSidebar.tsx — Más espacio entre iconos y mayor área de toque

- **SidebarMenu**: Agregar `className="gap-2.5"` para separar los items (actualmente `gap-1`).
- **SidebarMenuButton**: Agregar `className="hover:bg-sidebar-accent min-h-[2.75rem] py-2.5"` para aumentar la altura/área de toque de cada botón, haciendo más fácil dar clic en tablet.

### Resultado esperado
- En tablet: sidebar visible expandido con texto e iconos, fácil de navegar.
- En laptop/desktop: mismo comportamiento expandido, ítems más espaciados y fáciles de clicar.
- El usuario puede seguir colapsando manualmente si prefiere la vista de iconos.

### Archivos a modificar
- `src/components/DashboardLayout.tsx`
- `src/components/AppSidebar.tsx`
