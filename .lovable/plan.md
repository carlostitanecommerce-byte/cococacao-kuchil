## Diagnóstico end-to-end

Revisé el flujo real del POS, las llamadas de red, el carrito y la función de base de datos.

Hallazgos principales:

1. La función `validar_stock_carrito` sí está expandiendo paquetes dinámicos por `componentes` y sí rechaza cuando el consumo acumulado supera el stock.
2. En el diálogo `PaqueteSelectorDialog`, la validación visual llega de forma asíncrona. Mientras `stockMap` todavía no existe para una opción, el botón queda seleccionable. Eso permite clicks antes de que termine la validación.
3. Si la llamada RPC falla, el diálogo actualmente trata la opción como viable (`viable: true`). Esto es inseguro: ante error debe bloquear, no permitir.
4. `addOpcion` no hace una validación final en vivo antes de meter la opción en `seleccion`; solo confía en el estado cacheado `stockMap`, que puede estar desactualizado.
5. `handleConfirm` cierra el diálogo inmediatamente después de llamar `onConfirm`, aunque `onConfirm` en `PosPage` vuelve a validar de forma async. Si esa validación falla, el diálogo ya se cerró y la experiencia queda confusa.
6. La función de validación no marca como error un producto que requiere preparación pero no tiene receta; en esos casos no hay forma real de validar ni descontar insumos, así que debe bloquearse profesionalmente.

## Plan de arreglo

### 1. Hacer la validación del diálogo fail-closed

En `PaqueteSelectorDialog.tsx`:

- Inicializar opciones como no seleccionables mientras se valida el stock inicial.
- Cambiar el comportamiento ante error de RPC: si no se puede validar, la opción se bloquea con mensaje de error en lugar de permitirse.
- Deshabilitar botones cuando `validating` esté activo y todavía no haya resultado confiable para esa opción.

Resultado esperado: ningún producto se puede seleccionar “por carrera” antes de que termine la validación.

### 2. Validación final antes de cada selección

En `addOpcion`:

- Convertirlo a función async.
- Antes de actualizar `seleccion`, construir el carrito tentativo exacto:

```text
carrito actual + paquete actual + opción candidata
```

- Ejecutar `validar_stock_carrito` en ese momento.
- Si falla, mostrar el motivo y no agregar la opción.
- Si pasa, actualizar `seleccion`.
- Agregar estado de bloqueo por opción para evitar doble click concurrente.

Resultado esperado: aunque el estado visual se haya quedado viejo, la selección queda protegida por una validación inmediata y autoritativa.

### 3. Corregir el cierre del diálogo

Cambiar el contrato de `onConfirm` para que pueda ser async y devolver éxito/error.

En `PaqueteSelectorDialog.tsx`:

- `handleConfirm` esperará a que `onConfirm` termine.
- El diálogo solo se cerrará si el paquete realmente se agregó al ticket.
- Si falta stock, se mantiene abierto y muestra el error.

En `PosPage.tsx`:

- `handlePaqueteConfirm` devolverá `true` si agregó el paquete, `false` si no.

Resultado esperado: no habrá cierre engañoso del modal cuando la validación final rechace el paquete.

### 4. Endurecer la función de base de datos

Actualizar `validar_stock_carrito` para que también bloquee productos que:

- estén inactivos,
- requieran preparación,
- y no tengan receta configurada.

Esto aplica tanto a productos individuales como a componentes dentro de paquetes.

Mensaje esperado:

```text
El producto "X" no tiene receta configurada; no se puede validar ni descontar inventario.
```

Resultado esperado: no se puede vender ni seleccionar dentro de paquete un producto que no pueda descontar inventario correctamente.

### 5. Validar acumulado correctamente

Mantener la validación acumulada contra:

- productos ya en el ticket,
- paquetes ya en el ticket,
- opciones ya elegidas en el diálogo,
- la opción candidata,
- consumo comprometido en cuentas abiertas de coworking.

Resultado esperado: si hay stock para 2 unidades y ya hay 2 comprometidas entre ticket/paquete/coworking, la tercera queda bloqueada.

### 6. Pruebas de verificación

Después de implementar:

- Probar RPC directamente con cantidades que excedan stock para confirmar rechazo.
- Probar una opción con stock suficiente: debe permitir selección.
- Probar una opción sin stock suficiente: debe aparecer bloqueada y no debe poder seleccionarse.
- Probar doble click rápido: no debe colarse la opción.
- Probar “Agregar al ticket” con selección inválida: no debe cerrar el diálogo ni agregar al ticket.
- Confirmar que el procesamiento de venta sigue descontando los insumos desde las recetas de los componentes del paquete.

## Archivos a tocar

- `src/components/pos/PaqueteSelectorDialog.tsx`
- `src/pages/PosPage.tsx`
- nueva migración para reforzar `validar_stock_carrito`

No voy a cambiar diseño general ni estructura del POS; solo la lógica de validación y la protección del flujo.