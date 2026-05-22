# ¿Puede haber stock negativo hoy?

## Diagnóstico

**Estado actual en producción:** `SELECT * FROM insumos WHERE stock_actual < 0` → **0 filas**. Ningún insumo está en negativo hoy.

**Revisión de todas las rutas que tocan `insumos.stock_actual`:**

| Función / Trigger | ¿Resta stock? | Protección |
|---|---|---|
| `descontar_inventario_venta` (trigger al cobrar) | Sí | `SELECT ... FOR UPDATE` + valida antes de restar ✅ |
| `registrar_consumo_coworking` (cargo a cuenta) | No resta — sólo valida con `FOR UPDATE`. El descuento real ocurre al cobrar (trigger anterior) ✅ |
| `registrar_amenity_sesion` | Sí | `FOR UPDATE` + valida antes ✅ |
| `ajustar_amenity_sesion` | Sí | `UPDATE ... RETURNING` atómico + `RAISE` si queda `< 0` → rollback ✅ |
| `registrar_merma` | Sí | `FOR UPDATE` + valida antes ✅ |
| `anular_compra_insumo` | Sí (revierte alta) | `FOR UPDATE` + valida antes ✅ |
| `aplicar_auditoria_inventario` | Set absoluto | Valida `p_fisico >= 0` ✅ |
| `sumar_stock_compra` (trigger) | Sólo suma | n/a |
| `reintegrar_inventario_cancelacion` (trigger) | Sólo suma | n/a |
| `cancelar_sesion_coworking` / `resolver_cancelacion_item_sesion` | Sólo suman | n/a |

**Conclusión:** todas las rutas actuales están blindadas. **Pero hay una laguna estructural:**

> ❌ **La columna `insumos.stock_actual` no tiene `CHECK (stock_actual >= 0)`**. Toda la protección vive en código PL/pgSQL. Si en el futuro:
> - se agrega una RPC nueva que olvida `FOR UPDATE`,
> - un admin hace un `UPDATE insumos SET stock_actual = ...` manual,
> - una migración futura introduce un bug,
> 
> el negativo se grabaría sin que la base te avise.

# Plan: defensa en profundidad a nivel DB

Una sola migración, sin tocar código frontend.

## Paso 1 — Agregar CHECK constraint

```sql
ALTER TABLE public.insumos
  ADD CONSTRAINT insumos_stock_no_negativo
  CHECK (stock_actual >= 0)
  NOT VALID;

-- Validar contra datos existentes (ya sabemos que pasan: 0 negativos hoy).
ALTER TABLE public.insumos
  VALIDATE CONSTRAINT insumos_stock_no_negativo;
```

Efecto: **cualquier** `INSERT`/`UPDATE` que intente dejar `stock_actual < 0` falla con `ERRCODE 23514` y revierte la transacción completa — incluso si la lógica PL/pgSQL llegara a fallar.

## Paso 2 — Mejorar mensaje de error en el trigger principal

En `descontar_inventario_venta`, capturar el `check_violation` y reemitir un mensaje legible que nombre el insumo (en lugar de mostrar el SQL crudo al cajero):

```sql
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Stock insuficiente para "%": el inventario quedaría negativo',
    COALESCE(v_nombre_producto, NEW.descripcion, 'producto');
```

(Esto sólo se dispararía si la validación previa fallara — es el cinturón sobre los tirantes.)

## Paso 3 — Verificación post-migración

Una sola query de humo:

```sql
SELECT conname, contype FROM pg_constraint
WHERE conrelid = 'public.insumos'::regclass AND conname = 'insumos_stock_no_negativo';
```

# Fuera de alcance

- Cambios en `cartStore`, `PosPage`, ni ninguna pantalla. La validación de UX al agregar al carrito ya existe (`validar_stock_carrito` + locks en triggers).
- No se modifican funciones que ya están correctas — sólo se les agrega un manejador de excepción opcional.

# Riesgos

- **Cero riesgo de datos:** los datos actuales ya cumplen el constraint.
- **Riesgo operativo controlado:** si alguna ruta tuviera un bug latente que produjera negativos en ciertas condiciones, ahora fallaría visiblemente en lugar de corromper inventario silenciosamente — eso es exactamente lo que se quiere.
