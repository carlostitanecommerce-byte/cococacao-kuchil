# Refactor: Categorías por dominio

## Objetivo

Hoy `CategoriasTab` vive en **Inventarios** y mezcla los tres ámbitos (`insumo`, `producto`, `paquete`) con un filtro interno. Esto rompe la coherencia del módulo: Inventarios debería tratar sólo insumos, y Menú es el dueño natural de productos y paquetes.

Resultado esperado:

- **Inventarios** → pestaña "Categorías" gestiona **solo insumos**, sin sub-pestañas de ámbito.
- **Menú** → nueva pestaña "Categorías" (la primera, a la izquierda) que gestiona **productos y paquetes**, con pestañitas internas "Productos / Paquetes" (como las actuales en Inventarios).
- Cero pérdida de datos ni cambios en `categorias_maestras`.

## Cambios funcionales

### 1. Componente reutilizable `CategoriasManager`

Crear `src/components/categorias/CategoriasManager.tsx` a partir del `CategoriasTab` actual, parametrizado por los ámbitos que debe manejar:

```ts
interface Props {
  isAdmin: boolean;
  ambitos: Ambito[];               // ej. ['insumo'] o ['producto','paquete']
  titulo?: string;                 // "Categorías de insumos" / "Categorías de menú"
  defaultAmbito?: Ambito;          // ámbito preseleccionado al crear
}
```

Comportamiento:

- Si `ambitos.length === 1`: oculta el `Tabs` de filtro interno y el `Select` de ámbito del diálogo (se fuerza al único valor). La columna "Ámbito" de la tabla también se oculta.
- Si `ambitos.length > 1`: muestra `TabsList` con un trigger por ámbito (sin "Todas" cuando son sólo 2, para evitar ruido) y el `Select` de ámbito en el diálogo restringido a esos valores.
- Conteo de uso: ya hay queries a `insumos.categoria` y `productos.categoria`. Se mantienen, pero sólo se renderiza la métrica relevante a los ámbitos visibles.
- Mensajes (`AlertDialog` de borrado, toasts, audit logs) usan el `AMBITO_LABEL` ya existente — sigue funcionando para los tres valores.

### 2. Inventarios

`src/pages/InventariosPage.tsx`:

- La pestaña "Categorías" sigue siendo la primera y por defecto, pero ahora monta `<CategoriasManager ambitos={['insumo']} defaultAmbito="insumo" titulo="Categorías de insumos" />`.
- El componente `src/components/inventarios/CategoriasTab.tsx` se elimina (su lógica vive en el manager).

### 3. Menú

`src/pages/MenuPage.tsx`:

- Añadir nueva primera pestaña "Categorías" a la izquierda de "Productos Individuales".
- `<CategoriasManager ambitos={['producto','paquete']} defaultAmbito="producto" titulo="Categorías de menú" />`.
- `defaultValue` del `Tabs` cambia a `"categorias"`.

### 4. Limpieza de hooks

`src/hooks/useCategorias.ts` ya acepta ámbito único o arreglo — no requiere cambios. Verificar que los consumidores siguen pidiendo el ámbito correcto:

- `InsumosTab` → `useCategorias('insumo')` ✅
- `ProductosTab` → `useCategorias('producto')` ✅
- `PaquetesDinamicosTab` → `useCategorias('paquete')` ✅
- `PreciosDeliveryTab` → `useCategorias(['producto','paquete'])` ✅

## Base de datos

**Sin migración.** La tabla `categorias_maestras` ya tiene la columna `ambito` y las RLS son por rol, no por ámbito. La separación es 100% de presentación.

## Permisos y navegación

- `/inventarios` y `/menu` ya están restringidos a `administrador` y `supervisor`. No cambia.
- El botón "Nueva Categoría" sigue gated por `isAdmin` dentro del manager.

## Trazabilidad

Los `audit_logs` ya registran `crear_categoria / actualizar_categoria / eliminar_categoria` con el `ambito` en `metadata`. Se conserva intacto, por lo que los reportes históricos siguen siendo consistentes después del refactor.

## Plan de archivos

```text
+ src/components/categorias/CategoriasManager.tsx   (nuevo, reemplaza CategoriasTab)
- src/components/inventarios/CategoriasTab.tsx      (eliminar)
~ src/pages/InventariosPage.tsx                     (monta manager con ámbito 'insumo')
~ src/pages/MenuPage.tsx                            (nueva pestaña inicial "Categorías")
```

## Validación post-refactor

1. En **Inventarios → Categorías**: sólo se ven categorías de insumos, no hay sub-pestañas, el diálogo crea siempre con `ambito='insumo'`.
2. En **Menú → Categorías**: pestaña a la izquierda, sub-pestañas "Productos / Paquetes", crear/editar respeta el ámbito seleccionado.
3. Crear una categoría "Test" en Menú con ámbito `producto` y confirmar que aparece como opción en el `Select` de categoría de `ProductosTab` (vía `useCategorias('producto')`), pero **no** en `InsumosTab`.
4. Revisar `audit_logs`: cada acción registra el ámbito correcto.
