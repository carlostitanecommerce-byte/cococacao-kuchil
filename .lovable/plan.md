## Alcance

Solo la fase de **check-in**: detectar la membresía activa del cliente seleccionado, mostrar la alerta correspondiente (verde / ámbar / roja) y enlazarla a la sesión únicamente cuando aplique al área. El descuento de horas y el cobro de excedentes se resuelven en el flujo de **checkout** (fuera de este plan).

## Cambios

### 1. `src/components/coworking/types.ts`
Ampliar `Membresia` con dos campos derivados del join con `tarifas_coworking`:

- `tipo_cobro?: 'hora' | 'dia' | 'mes' | 'paquete_horas'`
- `nombre_tarifa?: string`

### 2. `src/components/coworking/useCoworkingData.ts`
Modificar la consulta de `coworking_membresias` para hacer join con la tarifa y así soportar tarifas desactivadas:

```ts
supabase.from('coworking_membresias' as any)
  .select('*, tarifas_coworking(nombre, tipo_cobro)')
  .in('estado', ['activa', 'pendiente_pago'] as any)
  .order('fecha_fin', { ascending: true }),
```

Al mapear el resultado, enriquecer cada `Membresia` con `tipo_cobro: m.tarifas_coworking?.tipo_cobro` y `nombre_tarifa: m.tarifas_coworking?.nombre`. Sin cambios al realtime ni a los filtros de estado.

### 3. `src/components/coworking/CheckInDialog.tsx`

**Detección de membresía del cliente (`useMemo`):**
Cuando `cliente` está seleccionado, buscar la primera `Membresia` que cumpla:
- `cliente_id === cliente.id`
- `estado === 'activa'`
- `fecha_inicio <= todayCDMX() <= fecha_fin`

La detección **ignora `area_id`**; la aplicabilidad se evalúa por separado.

**Aplicabilidad al área seleccionada (`useMemo` adicional):**
- `paquete_horas` → aplicable si `horas_disponibles > 0` (cualquier área).
- `mes` → aplicable solo si `area_id === null` (acceso general) **o** `area_id === selectedAreaId`.
- Cualquier otro tipo → no aplicable.

Esto elimina la fuga en la que un cliente con mensual para Oficina A obtendría $0 en Oficina B.

**Alertas debajo de `ClienteSelector`** (renderizadas solo si `clienteMembresia` existe):

- **Mensual aplicable** (`area_id === null` o coincide): banner **verde**
  `"Membresía Activa: Mensual — {nombre_tarifa}"`.
- **Mensual para otra área**: banner **ámbar** (advertencia, no bloqueante)
  `"El cliente tiene una membresía mensual para {nombre_area_membresía}. Si ingresa a esta área se cobrará tarifa regular."`. El nombre del área se resuelve desde el prop `areas`.
- **Paquete de horas con saldo**: banner **verde**
  `"Membresía Activa: Paquete de Horas (Saldo: {horas_disponibles} h)"`.
- **Paquete de horas agotado**: banner **rojo** (`destructive`)
  `"Membresía Agotada: El cliente no tiene horas disponibles en su paquete."`.

Íconos: `CheckCircle2` (verde), `AlertTriangle` (ámbar), `AlertCircle` (rojo) de `lucide-react`.

**Lógica de submit (`handleCheckIn`):**

1. Mantener la detección existente `membershipByArea` (por `area_id === selectedAreaId`) para bloquear a terceros con el toast "Espacio reservado".
2. Calcular `utilizableMembership = isMembresiaAplicable ? clienteMembresia : null`.
3. Al insertar en `coworking_sessions`:
   - `membresia_id = utilizableMembership?.id ?? membershipByArea?.id ?? null` (prioriza la del cliente).
   - Si hay `utilizableMembership`: `tarifa_id = null` y `tarifa_snapshot = null` (cobro base cero; el cálculo vive en checkout).
   - Si no: se conservan `selectedTarifaId` y el `tarifaSnapshot` actual.
4. Amenities, validaciones de aforo privado, conflicto con reservaciones y KDS permanecen sin cambios.

## Fuera de alcance

- Descuento automático de `horas_disponibles` al hacer checkout.
- Cobro de excedentes cuando la sesión supera el saldo del paquete.
- Cambios en `CheckoutDialog`, `QuickCheckInButton`, `ReservacionesTab`, o RPCs.
- Migraciones a la base de datos.

## Verificación

- `bunx tsgo --noEmit`.
- Cliente con mensual para el área seleccionada (o `area_id=null`) → banner verde; se guarda `membresia_id` y `tarifa_id=null`.
- Cliente con mensual para otra área → banner ámbar; check-in procede con tarifa regular (`membresia_id=null`, `tarifa_id`/`snapshot` normales).
- Cliente con paquete de horas y saldo > 0 → banner verde con saldo; `membresia_id` enlazada, `tarifa_id=null`.
- Cliente con paquete de horas y saldo 0 → banner rojo; check-in procede con tarifa regular.
- Cliente sin membresía → sin banner; flujo actual.
- Tarifa de la membresía desactivada → el banner sigue mostrando el nombre correcto gracias al join.
