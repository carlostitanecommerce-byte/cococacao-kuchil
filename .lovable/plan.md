## Problema

En `src/components/menu/PreciosDeliveryTab.tsx`, el filtro de tipo en la matriz de precios por plataforma usa el valor `"producto"` para la opción "Producto individual", pero en la base de datos los productos individuales se almacenan con `tipo = 'simple'` (solo los combos usan `'paquete'`). Resultado: al seleccionar "Producto individual" siempre se muestra "Sin resultados", aunque hay 126 productos simples en BD.

Adicionalmente, el subencabezado de la tabla (líneas 340-345) genera un warning de React por usar `<>...</>` dentro de un `.map`, lo que pierde el `key` en cada par de `<TableHead>`.

## Cambios

**Archivo:** `src/components/menu/PreciosDeliveryTab.tsx`

1. **Fix del filtro (línea 301)**
   - Cambiar `<SelectItem value="producto">Producto individual</SelectItem>` a `value="simple"` para alinearse con el valor real en `productos.tipo`.
   - Verificar que el resto de la lógica (`p.tipo !== tipoFiltro`) sigue siendo correcta — sí lo es.

2. **Fix del badge "Paquete" (línea 357)**
   - Mantener `prod.tipo === 'paquete'` (correcto, no cambia).

3. **Fix warning de keys en subencabezado (líneas 340-345)**
   - Reemplazar el `<>...</>` por un único `<Fragment key={pl.id}>` que envuelva los dos `<TableHead>`, eliminando los `key` redundantes internos.

## Verificación

- Seleccionar "Producto individual" → debe listar los 126 productos simples.
- Seleccionar "Paquete / Combo" → sigue mostrando el único paquete.
- Seleccionar "Todos los tipos" → muestra ambos.
- Consola del navegador: desaparece el warning `Each child in a list should have a unique "key" prop` originado en `PreciosDeliveryTab`.
