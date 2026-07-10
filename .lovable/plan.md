# Vender membresía sin sesión física

Vender una membresía (`tipo_cobro ∈ {mes, paquete_horas}`) creando el registro en `coworking_membresias` con `estado = 'pendiente_pago'` y una orden en `ordenes_pos_pendientes` que va directo a Caja — sin crear ninguna `coworking_sessions`.

## Alcance

### 1. Nuevo componente `src/components/coworking/VenderMembresiaDialog.tsx`

Props: `open`, `onOpenChange`, `tarifas`, `areas`, `onSuccess?`.

Campos del formulario:
- **Cliente** — `ClienteSelector` (obligatorio).
- **Tarifa** — Select filtrado por `tipo_cobro === 'mes' || 'paquete_horas'`.
- **Área asignada** — Select opcional/condicional según la tarifa (visible cuando la tarifa aplica a un área concreta, o siempre para `paquete_horas`; para `mes` sin área asignada permanece `null`).
- **Fecha de inicio** — `input[type=date]`, default `hoy` (CDMX).
- **Fecha de fin** — editable, default calculado:
  - `mes` → `fecha_inicio + 1 mes`.
  - `paquete_horas` → `fecha_inicio + 30 días` (editable).
- **Horas totales** — para `paquete_horas` input numérico (default leído de la tarifa si existe); para `mes` = `0`.
- Nota opcional.

### 2. Acción "Enviar a Caja" (submit)

Ejecutar en este orden:

1. **INSERT en `coworking_membresias`** →
   ```
   cliente_id, tarifa_id, area_id (nullable), usuario_id = user.id,
   fecha_inicio, fecha_fin, estado = 'pendiente_pago',
   horas_totales, horas_disponibles = horas_totales, notas
   ```
   Retornar `id` de la membresía.

2. **INSERT en `ordenes_pos_pendientes`** con `items` estructurado para encajar con `CartItem` y con `tipo_concepto = 'coworking'` (permite `producto_id` nullable y omite validación de inventario en el enum Postgres):
   ```json
   [
     {
       "lineId": "membresia-<MEMBRESIA_ID>",
       "producto_id": null,
       "nombre": "Membresía <tarifa.nombre>",
       "precio_unitario": <tarifa.precio_base>,
       "cantidad": 1,
       "subtotal": <tarifa.precio_base>,
       "tipo_concepto": "coworking",
       "descripcion": "Membresía coworking · <cliente> · <fecha_inicio> → <fecha_fin>",
       "membresia_id": "<MEMBRESIA_ID>",
       "tarifa_id": "<TARIFA_ID>"
     }
   ]
   ```
   Campos de la orden:
   ```
   usuario_id = user.id,
   caja_id = <caja abierta del usuario, si existe; si no null>,
   cliente_nombre = <nombre del cliente>,
   items = [ … ],
   total = tarifa.precio_base,
   tipo_consumo = 'sitio'
   ```

3. **Rollback compensatorio**: si el INSERT de la orden falla, ejecutar `DELETE` de la membresía recién creada para evitar registros huérfanos.

4. **`audit_logs`** insert: `accion = 'venta_membresia_coworking'`, metadata `{ membresia_id, orden_pendiente_id, tarifa_id, cliente_id, total }`.

5. Toast de éxito con folio `#0000` y `navigate('/caja?auto_import_orden=<orden.id>')` (patrón ya usado por `PosPage.autoParkOrder` — Caja auto-importa la orden).

### 3. Extensión de tipos

En `src/components/pos/types.ts` ampliar `CartItem`:
- `producto_id: string | null` (era `string`) — solo válido cuando `tipo_concepto === 'coworking'` para líneas de membresía.
- Agregar campos opcionales: `membresia_id?: string`, `tarifa_id?: string`.

Verificar que consumidores de `CartItem` (renderers de ticket, cocina, cobro) manejen `producto_id === null` — para membresías la línea debe mostrarse por `nombre`/`descripcion`, nunca enviarse a KDS ni buscar receta.

### 4. Punto de entrada UI

En `CoworkingPage.tsx`, junto al `CheckInDialog` del header, añadir botón **"Vender Membresía"** que abre el nuevo `VenderMembresiaDialog`. `onSuccess` llama a `data.fetchData()` para refrescar `membresias`.

## Detalles técnicos

- **Nombre de tabla**: la tabla real es `coworking_membresias` (el mensaje del usuario la llama `coworking_membresias_activas`; usar el nombre real).
- **Horas incluidas por tarifa**: si `tarifas_coworking` no tiene campo dedicado, se pide manualmente en el diálogo para `paquete_horas`; para `mes` se guarda `0` (uso ilimitado dentro del rango de fechas).
- **Ticket / KDS**: líneas con `tipo_concepto === 'coworking'` ya son ignoradas por `sendToKitchen`. Confirmar que `CajaCheckoutPanel` y renderers de ticket no invocan lookup de producto cuando `producto_id === null`.
- **Fase 3.2 (fuera de alcance)**: al pagar la orden en Caja, un trigger o RPC posterior extraerá `items[].membresia_id` y hará `UPDATE coworking_membresias SET estado='activa'`.

## Fuera de alcance

- Trigger/RPC que active la membresía al cobrarse la orden.
- Renovación automática y transición `activa → vencida`.
- UI de listado/gestión de membresías activas.

## Verificación

- Build + tsgo pasan.
- Submit del diálogo: aparece un registro en `coworking_membresias` (`estado = 'pendiente_pago'`) y una orden en `ordenes_pos_pendientes` (`estado = 'pendiente'`) con el `items` JSON exactamente en la forma indicada, incluyendo `membresia_id` y `tarifa_id`.
- La página `/caja` auto-importa la orden y muestra "Membresía …" con el total correcto; el ticket no falla al renderizar con `producto_id === null`.
- No se crea ningún registro en `coworking_sessions`.
- Si se fuerza fallo en el INSERT de la orden, la membresía queda eliminada por el rollback compensatorio.
