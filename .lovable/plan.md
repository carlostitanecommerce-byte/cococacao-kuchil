## Objetivo

Convertir la fila de categorías del POS (`ProductGrid.tsx`) en una **única línea con scroll horizontal**, de modo que escalen indefinidamente sin romper el layout ni ocultar categorías. No se toca nada más (carrito, caja, lógica de venta).

## Cómo se verá

```text
[Productos ⇄]  ‹  Cafetería  Postres  Bebidas frías  Snacks  Prueba  Prueba 2  …  ›   ⬛
               └─────────────── una sola fila, scroll horizontal ───────────────┘
```

- El botón de modo (`Productos / Paquetes`) queda fijo a la izquierda.
- El botón de densidad queda fijo a la derecha.
- En medio: **una sola fila** de badges con `overflow-x-auto`, sin wrap.
- Flechas `‹ ›` aparecen automáticamente cuando hay overflow y desaparecen cuando ya no hay más a dónde desplazarse. En táctil se puede arrastrar/scrollear directamente.
- La barra de scroll nativa se oculta (estética limpia) pero el scroll sigue funcional (rueda, trackpad, touch, flechas).

## Cambios técnicos

**Archivo único:** `src/components/pos/ProductGrid.tsx`

1. **Contenedor de categorías**
   - Reemplazar el actual `flex-1 flex flex-wrap gap-1.5` por un contenedor relativo:
     ```tsx
     <div className="relative flex-1 min-w-0">
       <div ref={scrollRef} className="flex gap-1.5 overflow-x-auto scroll-smooth no-scrollbar snap-x">
         {categoriasVisibles.map(...)}
       </div>
       {/* fades + flechas condicionales */}
     </div>
     ```
   - Badges con `shrink-0 whitespace-nowrap snap-start` para que no se compriman ni se rompan.

2. **Detección de overflow y posición de scroll**
   - `useRef` al contenedor scrollable + estado `{ canLeft, canRight }`.
   - Listener en `scroll` y `ResizeObserver` para recalcular cuando cambian categorías, modo o tamaño de ventana.
   - Botones flecha (`ChevronLeft` / `ChevronRight` de lucide) en `absolute` izquierda/derecha, ocultos cuando no aplican.
   - Click en flecha: `scrollRef.current.scrollBy({ left: ±200, behavior: 'smooth' })`.

3. **Auto-scroll a la categoría activa**
   - Al seleccionar una categoría (o cambiar de modo), hacer `scrollIntoView({ inline: 'nearest', block: 'nearest' })` para que la badge activa siempre quede visible.

4. **Fades laterales (pulido visual)**
   - Dos `div` decorativos `absolute inset-y-0 w-6` con `bg-gradient-to-r from-background` (izq) y `from-background` invertido (der), `pointer-events-none`, visibles solo cuando hay overflow en ese lado. Indican que hay más contenido.

5. **Utilidad `no-scrollbar`**
   - Añadir una mini-utilidad en `src/index.css` para ocultar la barra de scroll en todos los navegadores:
     ```css
     @layer utilities {
       .no-scrollbar::-webkit-scrollbar { display: none; }
       .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
     }
     ```

6. **Accesibilidad**
   - Flechas con `aria-label="Desplazar categorías a la izquierda/derecha"` y `tabIndex={-1}` (no son foco primario, son atajo visual).
   - El contenedor scrollable acepta navegación por teclado (las badges siguen siendo focusables y al hacer `Tab` el navegador hace scroll automático).

## Qué NO cambia

- Hook `useCategorias`, lógica de filtrado, modo `producto/paquete`, densidad, grilla de productos, carrito, caja, RLS, tablas: intactos.
- El comportamiento del botón de modo y del botón de densidad no se modifica.
- No se introducen dependencias nuevas.

## Validación visual

1. Crear 10+ categorías de productos → la fila se mantiene en una línea, aparecen flechas y fades, el scroll funciona con rueda/trackpad/touch.
2. Al quedar pocas categorías que caben en la fila, las flechas y fades desaparecen.
3. Al cambiar a "Paquetes" con pocas categorías, la fila se ajusta sin scroll.
4. Al hacer clic en una categoría que está fuera de la vista (vía flecha derecha), queda seleccionada y centrada/visible.
5. La grilla de productos debajo no pierde altura; el sticky de la barra superior se mantiene.
6. En viewport de 1032px (actual del usuario): el botón "Productos" + flechas + densidad siguen anclados; las categorías scrollean entre ellos.
