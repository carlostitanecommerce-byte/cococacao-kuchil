## Objetivo

En la fila de categorías del POS (`ProductGrid.tsx`), **ocultar las flechas `‹ ›` en tablet y móvil** y dejar solo el scroll táctil/deslizar con el dedo. En desktop las flechas se conservan tal cual.

## Cambio

**Archivo único:** `src/components/pos/ProductGrid.tsx`

- Añadir la clase `hidden lg:flex` a los dos botones flecha (`ChevronLeft` y `ChevronRight`), de modo que solo se rendericen en pantallas ≥ `lg` (1024px+, desktop).
- Los **fades laterales** (gradientes) se mantienen visibles en todos los tamaños como señal de que hay más categorías a las que se puede deslizar.
- El contenedor scrollable ya soporta touch nativamente (`overflow-x-auto`), así que no hay que cambiar nada más.

## Qué NO cambia

- Lógica de detección de overflow, scroll suave, auto-scroll a la categoría activa, fades, botón de modo, botón de densidad, grilla de productos, carrito, etc.
- En desktop la experiencia es idéntica a la actual.

## Validación

1. **Tablet (preview tablet ~768px):** las flechas desaparecen; deslizar con el dedo sobre la fila de categorías la desplaza horizontalmente; los fades indican overflow.
2. **Desktop (≥1024px):** las flechas siguen apareciendo cuando hay overflow, junto con los fades.
3. **Móvil:** mismo comportamiento que tablet (solo táctil).
