## Contexto
En el ticket activo de caja (`CajaCheckoutPanel`), cuando el cajero selecciona **Delivery** como tipo de consumo, el método de pago debe cambiar automáticamente a **Transferencia** y quedar bloqueado (no editable), ya que las plataformas de delivery externas siempre liquidan vía transferencia.

## Cambios

### 1. Lógica de selección de tipo de consumo (`handleTipoConsumoChange`)
- Al cambiar a `delivery`, ejecutar `setMetodoPago('transferencia')`.
- Al cambiar de `delivery` a otro tipo, limpiar `plataformaId` (ya lo hace actualmente).

### 2. UI del selector de método de pago
- Cuando `tipoConsumo === 'delivery'`, deshabilitar el `Select` de método de pago (`disabled`).
- Mostrar visualmente que está bloqueado (ej. opacidad reducida o badge "Transferencia fija").
- Ocultar o deshabilitar la sección de pago mixto cuando `tipoConsumo === 'delivery'` (no aplica).

### 3. Reset post-venta (`handleSuccess`)
- Verificar que al limpiar el ticket tras una venta exitosa, `metodoPago` vuelva a `'efectivo'` y `tipoConsumo` a `'sitio'` (ya existe).

## Archivo afectado
- `src/components/caja/CajaCheckoutPanel.tsx`

## Notas de implementación
- No requiere cambios en backend ni en la RPC `crear_venta_completa`.
- La propina sigue siendo aplicable sobre el subtotal; método de pago fijo no afecta el cálculo de totales.