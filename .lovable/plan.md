## Alcance

Ajustar el cálculo del checkout en `src/pages/CoworkingPage.tsx` (`handleCheckOut`) para las sesiones que se hicieron check-in bajo una membresía activa. `CheckoutDialog.tsx` no cambia — sigue leyendo los mismos campos de `CheckoutSummary`; solo cambian los valores calculados.

## Cambios

### `src/pages/CoworkingPage.tsx` — `handleCheckOut`

**1. Resolver la membresía con fallback a la BD**

`data.membresias` sólo trae estados `activa` / `pendiente_pago`. Si la membresía expiró mientras el cliente estaba dentro, la búsqueda en memoria devolvería `undefined` y la sesión se cobraría como tarifa completa. Por eso, si la sesión tiene `membresia_id` pero no aparece en `data.membresias`, se hace una consulta directa a Supabase:

```ts
let membresia = data.membresias.find(m => m.id === session.membresia_id) ?? null;
if (session.membresia_id && !membresia) {
  const { data: dbMembresia } = await supabase
    .from('coworking_membresias' as any)
    .select('*, tarifas_coworking(nombre, tipo_cobro)')
    .eq('id', session.membresia_id)
    .maybeSingle();
  if (dbMembresia) {
    membresia = {
      ...(dbMembresia as any),
      tipo_cobro: (dbMembresia as any).tarifas_coworking?.tipo_cobro,
      nombre_tarifa: (dbMembresia as any).tarifas_coworking?.nombre,
    };
  }
}
```

**2. Unificar la ruta de cálculo**

Reemplazar el bloque actual que ajusta `subtotalContratado`/`cargoExtra` por una lógica única que reutiliza el `switch (metodo)` ya existente y respeta `minutos_tolerancia`:

```ts
const isMonthlyMember = !!session.membresia_id && membresia?.tipo_cobro === 'mes';
const isPackageMember = !!session.membresia_id && membresia?.tipo_cobro === 'paquete_horas';

// Tiempos de referencia
let tiempoContratadoMin = 0;
if (isPackageMember) {
  tiempoContratadoMin = Number(membresia?.horas_disponibles ?? 0) * 60;
} else if (!isMonthlyMember) {
  tiempoContratadoMin = (finEstimada.getTime() - inicio.getTime()) / 60000;
}
const tiempoRealMin = (salidaReal.getTime() - inicio.getTime()) / 60000;
const tiempoExcedidoMin = Math.max(0, tiempoRealMin - tiempoContratadoMin);

const paxMultiplier = area.es_privado ? 1 : session.pax_count;
const snapshot = session.tarifa_snapshot ?? null;
const tolerancia = snapshot?.minutos_tolerancia ?? 0;

// Para paquetes de horas el excedente se cobra por minuto exacto (Opción A).
// Así la UI muestra "Cobro excedente (Minuto exacto)" sin la contradicción
// de "Hora cerrada · 0 bloques" cuando se cobra una fracción.
const metodo = isPackageMember ? 'minuto_exacto' : (snapshot?.metodo_fraccion ?? '15_min');
const precioBase = snapshot?.precio_base ?? area.precio_por_hora;
const metodoLabel = METODO_LABELS[metodo] ?? metodo;

// Mensual: no hay excedente
const minCobrar = isMonthlyMember ? 0 : Math.max(0, tiempoExcedidoMin - tolerancia);

let bloquesExtra = 0;
let cargoExtraUnidad = 0;
if (minCobrar > 0) {
  switch (metodo) {
    case 'sin_cobro':    bloquesExtra = 0;                       cargoExtraUnidad = 0; break;
    case '15_min':       bloquesExtra = Math.ceil(minCobrar/15); cargoExtraUnidad = bloquesExtra * (precioBase/4); break;
    case '30_min':       bloquesExtra = Math.ceil(minCobrar/30); cargoExtraUnidad = bloquesExtra * (precioBase/2); break;
    case 'hora_cerrada': bloquesExtra = Math.ceil(minCobrar/60); cargoExtraUnidad = bloquesExtra * precioBase; break;
    case 'minuto_exacto':bloquesExtra = Math.ceil(minCobrar);    cargoExtraUnidad = minCobrar * (precioBase/60); break;
    default:             bloquesExtra = Math.ceil(minCobrar/15); cargoExtraUnidad = bloquesExtra * (precioBase/4);
  }
}

// Montos finales
let subtotalContratado = 0;
let cargoExtra = 0;
if (isMonthlyMember) {
  // tiempo ilimitado, no se cobra base ni excedente
} else if (isPackageMember) {
  // paquete de horas: cubierto hasta el saldo; excedente a tarifa individual (sin paxMultiplier)
  cargoExtra = cargoExtraUnidad;
} else {
  subtotalContratado = (tiempoContratadoMin / 60) * precioBase * paxMultiplier;
  cargoExtra = cargoExtraUnidad * paxMultiplier;
}

const total = subtotalContratado + cargoExtra + upsellsTotal + consumosPosTotal;
```

**Notas:**
- Consumos POS y upsells (que viven en `detalle_ventas`) se siguen sumando igual — se cobran para los tres casos.
- Para mensual, `tiempoContratadoMin` y `tiempoExcedidoMin` se muestran en `0` en el resumen (tiempo ilimitado). `tiempoRealMin` sigue siendo el real medido.
- Para paquete de horas, `tiempoContratadoMin = horas_disponibles × 60` — la UI existente mostrará "Tiempo contratado" como el saldo prepagado y el excedente en minutos.
- `metodo = 'minuto_exacto'` para paquete de horas (Opción A). Si se prefiere Opción B más adelante, es un cambio localizado.

## Fuera de alcance

- No se decrementa `horas_disponibles` en `coworking_membresias`. Ese descuento se hará cuando el pago se confirme en Caja (siguiente paso).
- No se toca `CheckoutDialog`, `CheckInDialog`, `VenderMembresiaDialog`, ni RPCs.
- No se cambia `useCoworkingData`.

## Verificación

- `bunx tsgo --noEmit`.
- Sesión sin membresía → cálculo idéntico al actual (regresión).
- Sesión con mensual (en memoria) → `subtotalContratado = 0`, `cargoExtra = 0`; total = solo consumos POS.
- Sesión con mensual cuya membresía ya expiró (no está en `data.membresias`) → el fallback la trae, sigue mensual, `total = solo consumos POS`.
- Sesión con paquete de horas y `horasSesion ≤ horas_disponibles` → `cargoExtra = 0`.
- Sesión con paquete de horas excedida 15 min con tarifa $100/h → `cargoExtra ≈ $25.00`; UI muestra "Cobro excedente (Minuto exacto)".
- Sesión con paquete de horas cuya membresía cambió a `vencida` → fallback la recupera y el cobro del excedente se calcula correctamente.
