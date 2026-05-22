## Objetivo
Reorganizar el filtro superior de `ProductGrid.tsx` (POS) para que el usuario alterne entre **Productos** y **Paquetes** con un solo botón, y a la derecha solo aparezcan las categorías del modo activo. Así la barra no crece aunque haya muchas categorías de paquetes en el futuro.

## Cómo se verá

```text
[ Productos ▸ ]   Cafetería  Postres  Bebidas frías  Snacks   ⬛(densidad)
                  └─ categorías ámbito 'producto' que tengan productos activos

(al hacer clic en el botón izquierdo)

[ Paquetes ▸ ]    Desayunos  Combos  Eventos                  ⬛(densidad)
                  └─ categorías ámbito 'paquete' que tengan paquetes activos
```

- El botón izquierdo es el **modo activo** (siempre resaltado). Hacer clic alterna entre `Productos ↔ Paquetes`.
- Por defecto arranca en **Productos** y sin categoría seleccionada → muestra todos los productos.
- Las categorías de la derecha pertenecen únicamente al modo activo y solo aparecen si tienen al menos un ítem activo de ese tipo.
- Seleccionar una categoría filtra dentro del modo. Cambiar de modo limpia la categoría seleccionada.

## Qué hay que cambiar

**Archivo único:** `src/components/pos/ProductGrid.tsx`

1. **Nuevo estado de modo**
   - `const [modo, setModo] = useState<'producto' | 'paquete'>('producto');`
   - `categoriaActiva` pasa de `'Todos'` a `string | null` (null = "todo el modo").

2. **Separar categorías por ámbito**
   - Reemplazar `useCategorias(['producto', 'paquete'])` por dos llamadas independientes:
     - `useCategorias('producto')` → lista para modo Productos.
     - `useCategorias('paquete')` → lista para modo Paquetes.
   - Esto garantiza que **nunca aparezcan categorías de insumos** (el hook ya filtra por ámbito; al pedir solo uno se elimina cualquier duplicado nombrado igual que un insumo).

3. **Filtrar categorías visibles según modo**
   - Para Productos: `categoriasProducto.filter(c => productos.some(p => p.tipo === 'simple' && p.categoria === c))`.
   - Para Paquetes: `categoriasPaquete.filter(c => productos.some(p => p.tipo === 'paquete' && p.categoria === c))`.
   - La lista mostrada a la derecha cambia automáticamente al alternar modo.

4. **Botón de modo (reemplaza al chip "Todos")**
   - Un `Button` (no `Badge`) a la izquierda, `variant="default"`, con el texto del modo actual (`"Productos"` o `"Paquetes"`) y un ícono que sugiera alternar (p. ej. `Repeat2` o `ArrowLeftRight` de lucide).
   - Al hacer clic: `setModo(m => m === 'producto' ? 'paquete' : 'producto')` y `setCategoriaActiva(null)`.
   - Visualmente resaltado siempre (es el ancla del filtro); las badges de categorías a su derecha siguen siendo `outline`/`default` según selección.

5. **Filtrado de productos en grilla**
   - `filtered = productos.filter(p => p.tipo === (modo === 'producto' ? 'simple' : 'paquete') && (categoriaActiva === null || p.categoria === categoriaActiva))`.
   - Se sustituye la lógica actual basada en `categoriaActiva === 'Todos'`.

6. **Auto-reset si la categoría seleccionada desaparece**
   - Mantener el efecto que ya existe pero adaptarlo: si `categoriaActiva` deja de estar en la lista del modo actual, ponerlo en `null`.

7. **Persistencia opcional (recomendado)**
   - Guardar el modo elegido en `localStorage` bajo `'pos-grid-mode'` para que el cajero conserve su preferencia entre recargas, igual que la densidad.

## Qué NO cambia

- `PosPage.tsx`, carrito, validaciones de stock, RPCs, lógica de paquetes dinámicos y coworking: intactos.
- `useCategorias` no se modifica.
- Estilos generales y densidad compacta/cómoda siguen igual.
- No se tocan tablas, RLS ni migraciones de base de datos.

## Validación visual tras implementar

1. Entrar a `/pos` → debe aparecer "Productos" resaltado y solo categorías de productos a la derecha.
2. Clic en una categoría → filtra; clic en la misma categoría no debe cambiar nada (se queda activa).
3. Clic en el botón "Productos" → cambia a "Paquetes", aparecen categorías de paquetes y se listan todos los paquetes activos.
4. Crear/borrar una categoría de producto desde el módulo de categorías → la lista del POS se actualiza vía realtime (igual que ahora).
5. Ninguna categoría con ámbito `insumo` debe aparecer en ningún modo.
