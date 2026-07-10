## Objetivo

Bloquear un área privada bajo membresía mensual activa para terceros, pero permitir que el titular de la membresía la reserve/use, y que su tiempo no se cobre al hacer check-out.

Estado actual verificado:
- Tabla `coworking_sessions` ya tiene la columna `membresia_id` — **no** hace falta migración.
- `useCoworkingData` ya carga `membresias` con estado `activa`/`pendiente_pago`.
- `CheckInDialog` recibe `getAvailablePax` pero **no** recibe `membresias`; hay que pasársela.

## Cambios

### A. `src/components/coworking/useCoworkingData.ts` — `getAvailablePax`

Añadir chequeo de membresía activa vigente hoy sobre el `areaId` **antes** del branch de sesión activa. Si el área es privada y hay membresía activa hoy → devolver `0` (bloqueo visual). Áreas públicas mantienen su cálculo actual.

```ts
const today = todayCDMX();
const hasActiveMembership = membresias.some(
  m => m.area_id === areaId &&
       m.estado === 'activa' &&
       m.fecha_inicio <= today &&
       m.fecha_fin   >= today
);
if (area.es_privado) {
  if (hasActiveMembership) return 0;
  const hasActiveSession = sessions.some(s => s.area_id === areaId && s.estado === 'activo');
  return hasActiveSession ? 0 : area.capacidad_pax;
}
return area.capacidad_pax - getOccupancy(areaId);
```

### B. `src/components/coworking/conflictCheck.ts` — `checkReservationConflict`

Agregar parámetro opcional `clienteId?: string`. Al inicio, para áreas privadas, consultar `coworking_membresias` filtrando por `area_id`, `estado='activa'`, `fecha_inicio <= fechaReserva`, `fecha_fin >= fechaReserva`. Si existe y `cliente_id !== clienteId` → `{ hasConflict: true, message: 'Espacio bajo renta mensual por otro cliente' }`. Si es el mismo titular, continúa con las validaciones existentes.

También propagar `clienteId` al llamador principal en `ReservacionesTab` (donde se llama `checkReservationConflict`) usando el `cliente_id` del formulario. Rastreable con `rg "checkReservationConflict" src`.

### C. `src/components/coworking/CheckInDialog.tsx`

1. Añadir prop `membresias: Membresia[]` (venir de `useCoworkingData` — `CoworkingPage` la tiene en `data.membresias` y ya la pasa como prop nueva).
2. En `handleCheckIn`, después de obtener `available`, calcular:
   ```ts
   const today = todayCDMX();
   const activeMembership = membresias.find(m =>
     m.area_id === selectedAreaId &&
     m.estado === 'activa' &&
     m.fecha_inicio <= today &&
     m.fecha_fin   >= today
   );
   ```
3. Si `activeMembership` y (no hay cliente seleccionado o su id ≠ `activeMembership.cliente_id`) → toast "Espacio reservado — alquilado bajo membresía mensual a otro cliente" y `return`.
4. La validación actual de área privada ocupada solo aplica cuando **no** hay membresía activa (para no bloquear al titular):
   ```ts
   if (!activeMembership && selectedArea?.es_privado && available < selectedArea.capacidad_pax) { … }
   ```
5. En el `insert` a `coworking_sessions`, agregar `membresia_id: activeMembership?.id ?? null`.

Además en `CoworkingPage.tsx` pasar `membresias={data.membresias}` al `<CheckInDialog />`.

### D. `src/pages/CoworkingPage.tsx` — `handleCheckOut`

Después de calcular `paxMultiplier` y el resto, cortocircuitar cargos de tiempo cuando la sesión es de titular de membresía:

```ts
const isMemberSession = !!session.membresia_id;
const cargoExtra         = isMemberSession ? 0 : cargoExtraUnidad * paxMultiplier;
const subtotalContratado = isMemberSession ? 0 : (tiempoContratadoMin / 60) * precioBase * paxMultiplier;
```

Los consumos POS (`consumosPosTotal`) y upsells siguen cobrándose normal — solo el tiempo/base de renta va en $0 para el titular.

## Fuera de alcance

- No se descuentan horas del `paquete_horas` (esta iteración es solo para membresías tipo `mes` sobre área privada). Se documenta como siguiente fase.
- No se toca `checkWalkInVsReservations` — la bloqueo de walk-in ya está cubierto por `getAvailablePax=0` en la UI y, para el titular, por la lógica nueva en `handleCheckIn`.
- No se altera el esquema de BD (la columna `membresia_id` ya existe en `coworking_sessions`).
- No se modifica el tipado `Session` a menos que TypeScript se queje al leer `session.membresia_id`; si falla, se agrega el campo opcional en `types.ts`.

## Archivos tocados

- `src/components/coworking/useCoworkingData.ts`
- `src/components/coworking/conflictCheck.ts`
- `src/components/coworking/CheckInDialog.tsx`
- `src/pages/CoworkingPage.tsx`
- `src/components/coworking/ReservacionesTab.tsx` (solo para pasar `clienteId` a `checkReservationConflict`)
- `src/components/coworking/types.ts` (posible campo opcional `membresia_id?: string | null` en `CoworkingSession`)
