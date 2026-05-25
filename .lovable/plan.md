# Auto-Importación por URL (multi-dispositivo)

## Problema

El flujo actual abre siempre el diálogo "Enviar orden a Caja" pidiendo referencia, incluso cuando Caja está libre. La iteración anterior (leer `useCajaCartStore` local desde POS) no sirve porque los Zustand son `sessionStorage` por dispositivo: el POS no puede saber si la Caja —que corre en otra máquina— está libre. La única fuente de verdad compartida es la base de datos.

## Solución

Todas las órdenes pasan siempre por `ordenes_pos_pendientes` (única vía de comunicación). La diferencia entre "Caja libre" y "Caja ocupada" se resuelve **en Caja**, no en POS, mediante un query param `auto_import_orden=<id>` que dispara la importación automática al arribo.

## Cambios

### 1. `src/pages/PosPage.tsx`

**`goToCheckout`** — eliminar la apertura del diálogo en el flujo normal:

```text
goToCheckout():
  si isOpenAccount → chargeToOpenAccount() (sin cambios)
  si items.length === 0 → return
  
  cajaItems = useCajaCartStore.getState().items
  si cajaItems.length === 0:
    autoParkOrder()        // sin diálogo, nombre por defecto
  si no:
    setClienteRef('')
    setParkDialogOpen(true)  // flujo manual con referencia, como hoy
```

**Nueva función `autoParkOrder()`** — mismo INSERT que `parkOrder` pero:
- `cliente_nombre: 'Orden Rápida POS'` (hardcodeado, sin diálogo).
- Tras éxito, `clear()` del POS y `navigate('/caja?auto_import_orden=' + data.id)` (la query select trae `id` además de `folio`).
- Toast: `Orden #XXXX enviada a Caja` (mismo que hoy).

La función `parkOrder()` existente queda intacta para el caso "Caja ocupada con referencia opcional".

> Nota: el POS local no puede ver el estado de Caja en otro equipo. Para el caso simple (un solo dispositivo donde ambos módulos corren en la misma sesión) la lectura de `useCajaCartStore` funciona como hint local. En multi-dispositivo, el efecto en Caja decide qué hacer al recibir la URL — ver paso 2.

### 2. `src/pages/CajaPage.tsx`

Agregar un `useEffect` paralelo al existente de `?session=`:

```text
autoImportOrdenId = searchParams.get('auto_import_orden')

useEffect(() => {
  si !autoImportOrdenId → return
  si !cajaAbierta → return  // espera a que haya turno abierto
  
  si hasItems:
    // Caja ocupada: dejar la orden en la cola y limpiar URL.
    // No mostramos toast bloqueante; la orden ya está visible en OrdenesPosSelector.
    setSearchParams(params => quitar 'auto_import_orden')
    return
  
  // Caja libre: traer la orden por id y ejecutar la misma lógica de handleImportOrden.
  (async () => {
    const { data, error } = await supabase
      .from('ordenes_pos_pendientes')
      .select('id, folio, cliente_nombre, items, total')
      .eq('id', autoImportOrdenId)
      .eq('estado', 'pendiente')
      .maybeSingle()
    si error o !data:
      toast.error('No se pudo auto-importar la orden')
    si no:
      handleImportOrden({
        id: data.id,
        folio: data.folio,
        cliente_nombre: data.cliente_nombre,
        items: Array.isArray(data.items) ? data.items as CartItem[] : [],
        total: Number(data.total) || 0,
        created_at: '',
        usuario_id: '',
      })
    setSearchParams(params => quitar 'auto_import_orden')
  })()
}, [autoImportOrdenId, cajaAbierta, hasItems])
```

Detalles:
- Usar un `ref` (`autoImportProcessedRef`) para garantizar que el efecto solo procesa una vez por id, evitando re-import si `hasItems` cambia justo después de importar.
- `setSearchParams` debe preservar los demás params (usar callback form).
- `handleImportOrden` ya existe y llama a `importOrdenPendiente` + toast de éxito; se reutiliza tal cual.

### 3. Nada que cambiar

- `ordenes_pos_pendientes`: schema, RLS y realtime sin cambios.
- `OrdenesPosSelector`: sigue mostrando la cola normal; si la auto-importación corrió, la orden ya saldrá de "pendiente" cuando se cobre (Fase 5).
- `cartStore` (Caja y POS): sin cambios. No se agrega `replaceItems`.
- Diálogo de parqueo (`parkDialog`) y función `parkOrder`: se conservan para usuarios que quieran nombrar manualmente la orden (futuro botón secundario, fuera de alcance ahora).

## Resultado esperado

| Escenario | Comportamiento |
|---|---|
| POS cobra, Caja libre (cualquier dispositivo) | Sin diálogo. Orden creada como "Orden Rápida POS", navega a `/caja?auto_import_orden=<id>`. Caja la importa automáticamente y limpia la URL. |
| POS cobra, Caja ocupada (mismo dispositivo) | Sin diálogo (el hint local detecta items). Orden creada igual, navega a Caja, el efecto detecta `hasItems`, deja la orden en la cola y limpia la URL. |
| POS cobra, Caja ocupada en otro dispositivo | El POS abre auto-importación, pero al llegar al otro equipo el efecto detecta `hasItems` y la deja en la cola. El cajero la verá en `OrdenesPosSelector`. |
| Caja sin turno abierto | El efecto espera a `cajaAbierta`; al abrir caja se procesa el auto-import. |
