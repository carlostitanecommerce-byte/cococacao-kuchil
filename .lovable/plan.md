## Objetivo

Visualizar en `ReservationCalendar.tsx` las membresías mensuales activas como eventos de fondo (background) que cubran desde `fecha_inicio` hasta `fecha_fin`, para que el usuario vea claramente qué áreas privadas están rentadas por mes y no intente reservar sobre ellas. Incluye protecciones contra crash en `eventClick` y desfases de zona horaria.

## Cambios

### 1. `ReservationCalendar.tsx`

**a) Nueva prop**
- Agregar `membresias: Membresia[]` (opcional) a `Props`.
- Importar `Membresia` desde `./types`.

**b) Utilidad de fechas segura (evita desfases de zona horaria)**
Definir dentro del archivo:
```ts
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
```
Se usa para calcular el `end` exclusivo de los bloques de membresía. No se usa `new Date(fecha_fin)` con `setDate`.

**c) Eventos de membresía**
En el `useMemo` de `events`, concatenar un segundo arreglo generado desde `membresias`:
- Filtrar por `estado === 'activa'` y `area_id` no nulo.
- Aplicar el mismo filtro `filterAreaId` cuando no sea `'all'`.
- Cada membresía produce:
  - `start: m.fecha_inicio`
  - `end: addDays(m.fecha_fin, 1)` (end exclusivo en all-day)
  - `display: 'background'`
  - `allDay: true`
  - `backgroundColor`: color base del área desde `areaColorMap` (FullCalendar aplica la opacidad translúcida propia de los background events).
  - `extendedProps: { membresia: m }` (sin `reservacion`).
- No se define `title` visible: FullCalendar no renderiza texto sobre eventos `display: 'background'`. El bloque translúcido con el color del área es suficiente para comunicar "espacio bloqueado por renta mensual". No se añade `eventContent` ni se usa modo evento normal.

**d) Fix crash en `eventClick`**
Reemplazar el handler para ignorar eventos que no sean reservaciones:
```ts
eventClick={(info) => {
  const reservacion = info.event.extendedProps.reservacion as Reservacion | undefined;
  if (reservacion) {
    onEventClick?.(reservacion);
  }
}}
```
Esto evita el crash `Cannot read 'id' of undefined` al clicar un bloque de membresía.

### 2. `ReservacionesTab.tsx`
- Pasar `membresias` al `<ReservationCalendar />` (la prop ya llega al tab desde `CoworkingPage`).

## Fuera de alcance
- No se cambian `getAvailablePax`, `conflictCheck`, ni la lógica de check-in.
- No se agrega `cliente_nombre` al tipo `Membresia` ni a la query (`useCoworkingData` sin cambios).
- No se modifica CSS de FullCalendar ni la leyenda.
- No se implementa `eventContent` (los bloques de fondo van sin texto por diseño de FullCalendar).

## Verificación
- `bunx tsgo --noEmit`.
- Revisión visual con una membresía activa: aparece bloque translúcido en las vistas mes/semana/día en el rango correcto; clicar el bloque no rompe la UI; clicar reservaciones sigue funcionando.
