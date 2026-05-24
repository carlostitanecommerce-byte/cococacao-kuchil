## Verificación

Confirmo que los tres problemas existen en el código actual:

1. **Sin validación de categoría al guardar producto** — `ProductosTab.tsx` línea 229-237: `handleSave` valida nombre y precio pero nunca `form.categoria`. Se puede persistir con cadena vacía.
2. **Editar paquete dinámico borra y recrea grupos sin transacción** — `PaquetesDinamicosTab.tsx` líneas 311-348: hace `DELETE` de `paquete_grupos` y luego un loop de `INSERT`. Si falla en medio, el paquete queda con grupos parciales o vacíos. Solo hay rollback parcial para paquetes nuevos.
3. **Buscador de opciones sin diferimiento** — `PaquetesDinamicosTab.tsx` líneas 630-634: cada keystroke en `g._search` re-renderiza y filtra `productosSimples` sincrónicamente.

## Plan de corrección

### 1. Validar categoría en `ProductosTab.tsx`
En `handleSave`, después de validar `nombre`, agregar:
```ts
if (!form.categoria) { toast.error('La categoría es obligatoria'); return; }
```

### 2. Paquetes dinámicos atómicos vía RPC
Crear una función SQL `guardar_paquete_grupos(p_paquete_id uuid, p_grupos jsonb)` con `SECURITY DEFINER` que dentro de una transacción:
- Borre todos los `paquete_grupos` del paquete (cascade limpia opciones).
- Recorra el JSONB de grupos insertando cada grupo y sus opciones.
- Si algo falla, hacer `RAISE EXCEPTION` para abortar y revertir todo automáticamente.

En `PaquetesDinamicosTab.tsx`, en `doSave`, reemplazar el bloque `DELETE` + loop de `INSERT` (líneas 311-348) por una sola llamada:
```ts
const { error } = await supabase.rpc('guardar_paquete_grupos', {
  p_paquete_id: paqueteId!,
  p_grupos: grupos.map(g => ({
    nombre_grupo: g.nombre_grupo.trim(),
    cantidad_incluida: g.cantidad_incluida,
    es_obligatorio: g.es_obligatorio,
    orden: g.orden,
    opciones: g.opciones.map(o => ({
      producto_id: o.producto_id,
      precio_adicional: o.precio_adicional || 0,
    })),
  })),
});
```
Si la RPC falla y es paquete nuevo, se borra el producto recién creado (mantener el rollback ya existente).

### 3. Diferir filtrado del buscador de opciones
En el render de cada grupo (líneas 630-634), aplicar `useDeferredValue` al valor de búsqueda. Como el `search` está dentro de cada `grupo._search`, la solución más limpia es extraer el bloque de constructor de opciones a un subcomponente `GrupoOpcionesPicker` que reciba `productosSimples` y use internamente:
```tsx
const deferredSearch = useDeferredValue(search);
const sugerencias = useMemo(() =>
  deferredSearch.length > 0
    ? productosSimples.filter(p => p.nombre.toLowerCase().includes(deferredSearch.toLowerCase()) && !yaSeleccionados.has(p.id)).slice(0, 8)
    : [],
[deferredSearch, productosSimples, yaSeleccionados]);
```
Esto evita bloquear el hilo principal cuando hay cientos de productos.

## Archivos afectados

- `src/components/inventarios/ProductosTab.tsx` (validación categoría)
- `src/components/menu/PaquetesDinamicosTab.tsx` (RPC + useDeferredValue)
- Nueva migración SQL: función `guardar_paquete_grupos`
