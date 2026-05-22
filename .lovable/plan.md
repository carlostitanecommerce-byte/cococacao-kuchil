## ¿Es cierto el riesgo de deadlock?

**Sí, es 100% correcto y real.** Lo verifiqué leyendo el código actual de las funciones en la base de datos.

### Lo que encontré

Confirmado: **ninguna** de las funciones que bloquean `insumos` con `FOR UPDATE` (o que los actualizan, lo cual también toma un row lock) ordena los renglones de `recetas` antes de iterar. Postgres devuelve las filas en el orden físico de la tabla, que **no** está garantizado entre transacciones.

Funciones afectadas (todas hacen `FOR ... IN SELECT ... FROM recetas WHERE producto_id = ...` sin `ORDER BY`):

| Función | Cuándo se dispara |
|---|---|
| `descontar_inventario_venta` (trigger) | Al insertar `detalle_ventas` con `venta_id` (cobro de POS) |
| `registrar_consumo_coworking` | Al cargar consumo a cuenta de sesión |
| `registrar_amenity_sesion` | Al añadir amenity a sesión |
| `ajustar_amenity_sesion` | Al ajustar cantidad de amenity |
| `recalcular_amenities_pax` | Al cambiar pax de sesión |
| `reintegrar_inventario_cancelacion` | Al cancelar venta/ítem |
| `resolver_cancelacion_item_sesion` | Al aprobar cancelación de ítem |

### Escenario real de deadlock

```text
T=0  Cajero A vende "Latte"    → bloquea insumo "Leche"
T=0  Cajero B vende "Chocolate"→ bloquea insumo "Azúcar"
T=1  Cajero A intenta bloquear "Azúcar"  → espera a B
T=1  Cajero B intenta bloquear "Leche"   → espera a A
T=2  Postgres detecta deadlock → cancela una transacción con error 40P01
```

El cajero perdedor ve un error genérico y debe reintentar. En horas pico (varios productos compartiendo leche, azúcar, vasos, tapas, popotes) la probabilidad crece de forma cuadrática.

### Por qué el `ORDER BY r.insumo_id` lo resuelve

Si **todas** las funciones bloquean insumos en el **mismo orden global** (por `insumo_id` ascendente), es matemáticamente imposible un ciclo de espera: A y B siempre piden "Azúcar" antes que "Leche", uno gana y el otro espera limpio en cola.

# Plan: blindar contra deadlocks (una sola migración SQL)

## Paso 1 — Añadir `ORDER BY r.insumo_id` a cada loop de recetas

Reescribir las 7 funciones listadas arriba para que el `SELECT` interno termine en `ORDER BY r.insumo_id` (o `ORDER BY 1` cuando sólo se selecciona `insumo_id`). Cambio quirúrgico: no se toca la lógica de cada función, sólo el orden.

## Paso 2 — Pre-bloqueo ordenado en `crear_venta_completa`

Una sola venta puede tener varios productos distintos en el ticket. Aunque cada producto individualmente ya quede ordenado tras el Paso 1, **entre productos** del mismo ticket aún se podrían tomar locks en orden incoherente con otra transacción que tenga otro ticket con los mismos insumos.

Solución: al inicio de `crear_venta_completa`, antes de insertar `detalle_ventas`, ejecutar **un solo** `SELECT ... FOR UPDATE` ordenado que pre-bloquee todos los insumos que la venta va a tocar:

```sql
PERFORM 1 FROM public.insumos
WHERE id IN (
  SELECT DISTINCT r.insumo_id
  FROM public.recetas r
  WHERE r.producto_id = ANY(<lista de producto_ids del ticket>)
)
ORDER BY id
FOR UPDATE;
```

Esto fija el orden global de locks **por transacción completa**, no sólo por producto. Es la garantía definitiva.

## Paso 3 — Verificación post-migración

```sql
-- Confirma que ninguna función PL/pgSQL itera recetas sin ORDER BY
SELECT proname FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND prosrc ILIKE '%FROM%recetas%'
  AND prosrc NOT ILIKE '%ORDER BY%';
-- debe devolver 0 filas (o sólo funciones de lectura que no bloquean)
```

# Fuera de alcance

- No se toca código frontend (cartStore, PosPage, dialogs, etc.).
- No se modifica la lógica de negocio: mismas validaciones, mismos errores legibles, mismas RLS.
- No se altera el `CHECK (stock_actual >= 0)` ni los mensajes de error agregados ayer.

# Riesgos

- **Cero riesgo funcional:** `ORDER BY` no cambia qué filas se procesan, sólo en qué orden. Resultados idénticos.
- **Microcosto de performance:** un `ORDER BY` sobre 2–8 filas de recetas es despreciable (índice PK en `insumo_id`).
- **Único riesgo de proceso:** son 7 funciones a reescribir en una migración larga. Mitigación: copiar cada `CREATE OR REPLACE FUNCTION` actual y añadir sólo la cláusula `ORDER BY`.