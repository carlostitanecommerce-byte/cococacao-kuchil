## Objetivo

En el ticket del POS:
1. Quitar la fila redundante de **Subtotal** y renombrar **Total → Subtotal** (manteniendo el estilo grande/primary).
2. Hacer que el bloque inferior (subtotal + botón "Procesar pago en Caja") quede **siempre fijo** en desktop, sin encogerse cuando crece la lista de productos.
3. Hacer scroll vertical dentro de la lista de productos del ticket; las tarjetas mantienen su tamaño original.

## Cambios

### 1. `src/components/pos/CartPanel.tsx`

- **Footer del ticket (líneas ~237-246):** eliminar la fila de Subtotal y dejar solo la línea actual de Total, cambiando la palabra a "Subtotal" (mismo `text-lg font-bold` y monto en `text-primary`).
  ```tsx
  <div className="shrink-0 border-t border-border pt-3 mt-3">
    <div className="flex justify-between items-center text-lg font-bold">
      <span>Subtotal:</span>
      <span className="text-primary">${subtotal.toFixed(2)}</span>
    </div>
  </div>
  ```
- Añadir `shrink-0` al header del ticket y al banner de coworking, para que solo la lista de productos sea la que se encoja/scrollee.
- Añadir `shrink-0` a cada tarjeta de producto en `renderItem` (clase del div raíz) para que **conserven su tamaño** cuando hay muchos ítems y se scrollea verticalmente.

### 2. `src/pages/PosPage.tsx` — layout desktop (líneas ~366-386)

- El problema: el botón "Procesar pago en Caja" se encoge cuando hay muchos productos porque está como hermano flex sin `shrink-0` y el `CartPanel` usa `h-full` en vez de `flex-1`.
- Reestructurar el contenido de la columna derecha:
  ```tsx
  <div className="lg:col-span-2 border border-border rounded-lg p-3 bg-card flex flex-col min-h-0">
    <div className="flex-1 min-h-0 flex flex-col">
      <CartPanel ... />
    </div>
    <Button className="mt-3 w-full shrink-0" size="lg" ...>
      {checkoutLabel}
      <CheckoutIcon className="ml-2 h-4 w-4" />
    </Button>
  </div>
  ```
- Con esto el botón queda anclado abajo siempre con su altura natural (`size="lg"`), y el `CartPanel` ocupa el espacio restante. Internamente su lista hace scroll vertical (ya tiene `flex-1 overflow-y-auto min-h-0`), y las tarjetas no se deforman gracias al `shrink-0` añadido en el paso 1.

## Qué NO cambia

- Lógica de cálculo de subtotal/total (sigue siendo la misma variable `subtotal`).
- Lógica de carrito, checkout, paquetes, coworking, propinas (las propinas viven en Caja, no en POS).
- Layout tablet/mobile (Sheet del ticket) — el cambio del footer (paso 1) aplica también ahí y se ve consistente.
- Grilla de productos del POS, RLS, tablas.

## Validación

1. **Desktop con 1-2 items:** el footer muestra solo "Subtotal: $X" grande en primary; el botón queda al fondo con su tamaño normal.
2. **Desktop con 15+ items:** el botón "Procesar pago en Caja" mantiene su altura `lg`; la lista del ticket scrollea hacia abajo y cada tarjeta conserva su tamaño/contenido completo.
3. **Tablet/mobile (Sheet):** el footer también muestra solo "Subtotal"; no hay regresiones.
