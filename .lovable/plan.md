# Auditoría del flujo de delivery y plan de corrección

## Diagnóstico

El flujo actual **guarda** la plataforma seleccionada en la venta, pero **nunca aplica el precio especial** que definiste en *Menú → Precios delivery*. La cadena es:

```
ProductGrid → cartStore (precio_venta normal)
   → CajaCheckoutPanel (solo guarda plataforma_id, no re-precia)
   → ConfirmVentaDialog (usa item.precio_unitario tal cual)
   → RPC crear_venta_completa (inserta el precio del carrito)
```

La tabla `producto_precios_delivery` se llena correctamente desde la matriz, pero **ningún consumidor la lee** al momento de cobrar. Por eso ves el precio normal del Affogato Vainilla aunque tenga precio configurado para la plataforma.

Además hay una inconsistencia menor: la matriz también permite fijar precio para paquetes (`producto_id` apuntando a un paquete), pero el carrito guarda paquetes con `producto_id = paquete_id`. Hay que asegurarse de buscar por la misma clave.

## Cambios propuestos

### 1. `CajaCheckoutPanel.tsx` — overlay de precios de delivery

- Nuevo estado `preciosDelivery: Record<productoId, number>` cargado cuando `tipoConsumo === 'delivery'` **y** hay `plataformaId`. Query:
  ```
  select producto_id, precio_venta
  from producto_precios_delivery
  where plataforma_id = :plataformaId
  ```
- Calcular `displayItems = items.map(...)` aplicando override:
  - Si la línea es **readOnly** (coworking / cuenta abierta) → no se re-precia.
  - Si `preciosDelivery[item.producto_id]` existe → reemplazar `precio_unitario` y recalcular `subtotal = cantidad × nuevo precio`.
  - Si no existe override → mantener precio normal y mostrar badge sutil "precio normal" para que la cajera lo vea.
- `subtotal`, `propina`, `comision`, `total` y la lista visible se basan en `displayItems`.
- `ventaSummary.items` se construye con `displayItems` para que la venta se guarde con los precios correctos.
- Al cambiar de plataforma o salir de delivery, limpiar `preciosDelivery`.

### 2. Soporte para paquetes

- La query debe traer también precios cuyo `producto_id` corresponda a un paquete. Como ambos viven en `productos`, basta con buscar por `item.paquete_id ?? item.producto_id` al resolver el override.
- Documentar que los paquetes dinámicos con opciones (líneas con `opciones`) no se reprician a nivel de componente — se respeta el precio del paquete.

### 3. UX en la tabla del ticket

- Cuando hay override activo, mostrar el precio normal tachado al lado del nuevo precio en cada línea para que la cajera entienda por qué cambió el total.
- Mostrar un pequeño aviso ("Precios ajustados para {Plataforma}") arriba del bloque de totales.

### 4. Verificación end-to-end

- Cargar Affogato Vainilla en POS → ir a Caja → elegir Delivery + plataforma con precio configurado → confirmar que el subtotal y el ticket guardado reflejan el precio especial.
- Cambiar a otra plataforma sin precio configurado → debe volver al precio normal y mostrar el aviso.
- Cambiar tipo de consumo a "En sitio" → precios vuelven a los normales.

## Fuera de alcance

- No tocamos la RPC `crear_venta_completa`: ya recibe `precio_unitario` por línea, así que con guardar el override correcto en `ventaSummary.items` es suficiente.
- No modificamos la matriz de configuración ni `PreciosDeliveryTab`.
- No tocamos cuentas abiertas de coworking (sus líneas se cobran al precio con el que se registró el consumo).
