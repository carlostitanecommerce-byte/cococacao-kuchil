# Unificar paginación en Inventarios

Replicar exactamente el componente de paginación que ya usa **Menú › Productos Individuales** (`ProductosTab.tsx`) en las cuatro pestañas de **Inventarios**: Categorías, Insumos, Compras y Mermas.

## Referencia visual (lo que se va a replicar)

Barra inferior con dos bloques:

```text
Mostrando 1–25 de 137 productos        Por página [25 ▾]   [‹] [1] [2] [3] … [6] [›]
```

- Texto izquierdo: `Mostrando X–Y de N <entidad>` (xs, `text-muted-foreground`).
- Selector "Por página" con opciones **10 / 25 / 50 / 100** (`h-8 w-20`).
- Botones numerados (`h-8 w-8`, `outline` / `default` para el activo) con elipsis cuando hay más de 7 páginas.
- Flechas `ChevronLeft` / `ChevronRight` con la misma altura.
- Mismo layout responsive: `flex flex-wrap items-center justify-between gap-3`.

## Cambios por pestaña

### 1. Categorías (`src/components/categorias/CategoriasManager.tsx`)
- Hoy no tiene paginación. Agregar estados `paginaActual`, `porPagina` (default 25) y aplicar slice sobre `visibles`.
- Reset de página cuando cambia `filtro` o búsqueda interna (si la hubiese).
- Renderizar la barra debajo del listado/tabla de categorías.

### 2. Insumos (`src/components/inventarios/InsumosTab.tsx`)
- Hoy no tiene paginación. Agregar el mismo bloque sobre el arreglo ya filtrado (búsqueda + switch de stock bajo).
- Reset de página al cambiar búsqueda, filtro de categoría o switch.

### 3. Compras (`src/components/inventarios/ComprasTab.tsx`)
- Ya pagina pero contra el servidor (`range`) con un par de flechas básicas. Mantener la consulta paginada en BD pero reemplazar la UI por el mismo bloque (texto "Mostrando X–Y de N compras", selector de tamaño, números con elipsis, flechas).
- El selector de "Por página" actualizará `PAGE_SIZE` (pasarlo a estado) y reiniciará `page` a 0.

### 4. Mermas (`src/components/inventarios/MermasTab.tsx`)
- Ya tiene paginación cliente simple. Reemplazar por el bloque unificado, manteniendo la lógica de `filtradas` y el slice.
- Agregar selector de tamaño de página (10/25/50/100) en lugar del `PAGE_SIZE` constante.

## Detalles técnicos

- Para evitar duplicar código en 4 archivos, **extraer un componente reutilizable** `src/components/ui/data-pagination.tsx` (puramente presentacional) con props:

  ```ts
  interface DataPaginationProps {
    paginaActual: number;        // 1-based
    totalItems: number;
    porPagina: number;
    onPaginaChange: (p: number) => void;
    onPorPaginaChange: (n: number) => void;
    etiqueta?: string;           // p.ej. "productos", "insumos", "compras", "mermas"
    opcionesPorPagina?: number[];// default [10, 25, 50, 100]
  }
  ```

  Internamente calcula `totalPaginas`, `inicio`, `fin` y la lista `numerosPagina` con elipsis (misma lógica de `ProductosTab.tsx` líneas 548-564). Renderiza exactamente el mismo JSX (líneas 683-723).

- Cada pestaña se queda con la responsabilidad de filtrar/cortar sus datos; la paginación es solo UI + estado.
- Compras seguirá usando paginación server-side: el componente reporta los cambios y el `useEffect` existente refetchea con `from/to`.
- Las demás (Categorías, Insumos, Mermas) usan `slice` en memoria igual que Productos.

## Archivos afectados

- `src/components/ui/data-pagination.tsx` *(nuevo)*
- `src/components/categorias/CategoriasManager.tsx`
- `src/components/inventarios/InsumosTab.tsx`
- `src/components/inventarios/ComprasTab.tsx`
- `src/components/inventarios/MermasTab.tsx`
- *(opcional, refactor)* `src/components/inventarios/ProductosTab.tsx` para que también consuma el nuevo componente y quede una sola fuente de verdad.

## Fuera de alcance

- No se cambia la lógica de filtros, búsqueda, ni queries de datos.
- No se modifica el estilo visual de las tablas ni de los formularios.
