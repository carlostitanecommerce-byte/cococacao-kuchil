## Análisis: ambos problemas son correctos

Verificado en el código:

- **CheckInDialog.tsx** líneas 351-360: el `SelectItem` de áreas usa `avail < capacidad_pax` para marcar el área privada como ocupada. Con la lógica nueva (`getAvailablePax = 0` bajo membresía activa), la oficina rentada aparecerá deshabilitada en el desplegable **incluso para el titular**, así que aunque las validaciones de `handleCheckIn` ya permiten al titular, no podrá seleccionar el área para llegar hasta ahí.
- **QuickCheckInButton.tsx** líneas 30-35: la validación `available < area.capacidad_pax` bloquea el check-in desde una reservación en un área privada bajo membresía, **sin distinguir titular vs. tercero**. También el `insert` a `coworking_sessions` no guarda `membresia_id`.

## Cambios

### 1. `src/components/coworking/CheckInDialog.tsx` — render del `<Select>` de áreas

Reemplazar el bloque `areas.map(...)` (líneas 351-364) para consultar la membresía activa vigente y decidir habilitación según el cliente ya seleccionado:

```tsx
{areas.map(area => {
  const avail = getAvailablePax(area.id);
  const today = todayCDMX();
  const activeMembership = membresias.find(m =>
    m.area_id === area.id &&
    m.estado === 'activa' &&
    m.fecha_inicio <= today &&
    m.fecha_fin   >= today
  );
  const isOwnedBySelectedCliente =
    !!activeMembership && !!cliente && cliente.id === activeMembership.cliente_id;
  // Privado ocupado si: hay membresía de otro cliente, o (sin membresía) avail está por debajo de capacidad
  const isPrivadoOcupado =
    area.es_privado &&
    ((activeMembership && !isOwnedBySelectedCliente) ||
     (!activeMembership && avail < area.capacidad_pax));
  const isDisabled = area.es_privado ? isPrivadoOcupado : avail <= 0;
  const label = area.es_privado
    ? `${area.nombre_area} — ${
        activeMembership && !isOwnedBySelectedCliente
          ? 'Renta mensual'
          : isPrivadoOcupado
            ? 'Ocupado'
            : isOwnedBySelectedCliente
              ? 'Membresía activa (titular)'
              : 'Disponible'
      } (privado)`
    : `${area.nombre_area} — ${avail}/${area.capacidad_pax} disponibles`;
  return (
    <SelectItem key={area.id} value={area.id} disabled={isDisabled}>{label}</SelectItem>
  );
})}
```

Ya tenemos `membresias`, `todayCDMX` y `cliente` importados/en scope en este archivo por los cambios previos.

### 2. `src/components/coworking/QuickCheckInButton.tsx`

- Añadir prop `membresias?: Membresia[]` (importar tipo desde `./types`).
- En `handleQuickCheckIn`:
  - Calcular `activeMembership` filtrando `membresias` por `area_id === reservacion.area_id`, `estado === 'activa'` y fechas que cubran hoy (`todayCDMX()`).
  - Consultar si hay una sesión físicamente activa en el área: `supabase.from('coworking_sessions').select('id').eq('area_id', reservacion.area_id).eq('estado', 'activo')` → `isSessionActive`.
  - Reemplazar la validación de "área privada ocupada" por:
    - Si `area.es_privado` y `activeMembership`:
      - Si `reservacion.cliente_id !== activeMembership.cliente_id` → toast "Espacio bajo renta mensual" y `return`.
      - Si es del titular pero `isSessionActive` → toast "Área privada ocupada" y `return`.
    - Si `area.es_privado` y **no** hay `activeMembership` y `available < area.capacidad_pax` → toast actual "Área privada ocupada".
- En el `insert` de `coworking_sessions` agregar `membresia_id: activeMembership?.id ?? null`.

### 3. `src/components/coworking/ReservacionesTab.tsx`

- Aceptar (o consumir) `membresias` para pasárselas a `QuickCheckInButton`. Actualmente `ReservacionesTab` recibe sus props desde `CoworkingPage`; hay dos opciones equivalentes:
  - **Opción elegida:** añadir prop `membresias: Membresia[]` a `ReservacionesTab` y pasarla al `QuickCheckInButton` (línea 359). Es explícito y consistente con el resto del árbol.
- Pasarla desde `CoworkingPage.tsx` (ya se le pasa `areas`, `reservaciones`, etc.).

### 4. `src/pages/CoworkingPage.tsx`

En el uso de `<ReservacionesTab ... />` agregar `membresias={data.membresias}`.

## Fuera de alcance

- No se toca la lógica de `getAvailablePax` ni de `conflictCheck` (ya cubierta en la iteración anterior).
- No se cambian tipos: `Membresia` y `Reservacion.cliente_id` ya existen.
- No hay migración de base de datos.

## Archivos tocados

- `src/components/coworking/CheckInDialog.tsx`
- `src/components/coworking/QuickCheckInButton.tsx`
- `src/components/coworking/ReservacionesTab.tsx`
- `src/pages/CoworkingPage.tsx`
