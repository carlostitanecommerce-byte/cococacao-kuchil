## Objetivo

Crear la tabla `coworking_membresias` (nombre generalizado) para almacenar contratos mensuales, pases y paquetes de horas por cliente. Solo esquema + RLS + grants + trigger `updated_at` + índices. No se toca UI ni lógica de sesiones en esta fase.

## 1. Migración SQL

Orden estricto: CREATE → GRANT → RLS → POLICY → TRIGGER → INDEX.

```sql
-- 1. Tabla generalizada (no "_activas": alberga también vencidas/canceladas)
CREATE TABLE public.coworking_membresias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES public.clientes(id)          ON DELETE RESTRICT,
  tarifa_id   UUID NOT NULL REFERENCES public.tarifas_coworking(id) ON DELETE RESTRICT,
  area_id     UUID NULL      REFERENCES public.areas_coworking(id)  ON DELETE SET NULL,
  usuario_id  UUID NOT NULL, -- operador que registró la transacción (auditoría, patrón POS)
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente_pago'
    CHECK (estado IN ('pendiente_pago','activa','vencida','cancelada')),
  horas_totales     NUMERIC NOT NULL DEFAULT 0 CHECK (horas_totales >= 0),     -- capacidad contratada
  horas_disponibles NUMERIC NOT NULL DEFAULT 0 CHECK (horas_disponibles >= 0), -- saldo restante
  notas TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_membresia_fechas          CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT chk_membresia_horas_consumo   CHECK (horas_disponibles <= horas_totales)
);

-- 2. GRANTs (Data API; RLS filtra)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coworking_membresias TO authenticated;
GRANT ALL                             ON public.coworking_membresias TO service_role;

-- 3. RLS
ALTER TABLE public.coworking_membresias ENABLE ROW LEVEL SECURITY;

-- 4. Políticas
--   Lectura: cualquier usuario autenticado del staff.
CREATE POLICY "Membresías: lectura autenticados"
  ON public.coworking_membresias FOR SELECT
  TO authenticated
  USING (true);

--   Escritura (INSERT/UPDATE/DELETE): solo roles operativos.
CREATE POLICY "Membresías: gestión staff"
  ON public.coworking_membresias FOR ALL
  TO authenticated
  USING (
       public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  )
  WITH CHECK (
       public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  );

-- 5. Trigger updated_at (reutiliza función existente del proyecto)
CREATE TRIGGER trg_update_coworking_membresias_updated_at
BEFORE UPDATE ON public.coworking_membresias
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Índices de rendimiento (accesos esperados desde check-in y validaciones)
CREATE INDEX idx_coworking_membresias_cliente_id ON public.coworking_membresias(cliente_id);
CREATE INDEX idx_coworking_membresias_estado     ON public.coworking_membresias(estado);
-- Extras útiles sin costo relevante:
CREATE INDEX idx_coworking_membresias_tarifa_id  ON public.coworking_membresias(tarifa_id);
CREATE INDEX idx_coworking_membresias_area_id    ON public.coworking_membresias(area_id);
CREATE INDEX idx_coworking_membresias_estado_fin ON public.coworking_membresias(estado, fecha_fin);
```

## 2. Decisiones aplicadas (feedback incorporado)

1. **Nombre semántico** → `coworking_membresias` (sin `_activas`). Filtrar por `WHERE estado = 'activa'` cuando corresponda.
2. **Trazabilidad** → `usuario_id UUID NOT NULL` (consistencia con `coworking_sessions` y `ventas`). Sin FK a `auth.users` para respetar la política del proyecto de no acoplar tablas del schema `public` al schema `auth`.
3. **ON DELETE**:
   - `cliente_id` y `tarifa_id` → `RESTRICT` (protege historial de cobro).
   - `area_id` → `SET NULL` (permite hot desk y no rompe historial si se retira un área).
4. **Consumo de horas** → se agregan **ambos** campos: `horas_totales` (contratadas) y `horas_disponibles` (saldo). `CHECK` de no-negativos y `horas_disponibles <= horas_totales` para consistencia. Planes ilimitados quedan en `0/0` y la lógica de sesión los interpretará como "sin tope" cuando se implemente el consumo.
5. **updated_at** → columna + trigger `update_updated_at_column()` existente. Indispensable para rastrear paso a `activa`/`vencida`.
6. **Índices** → `cliente_id`, `estado` (los pedidos) más `tarifa_id`, `area_id` y compuesto `(estado, fecha_fin)` para el barrido de vencimientos.
7. **Extras conservados**: `notas TEXT` (comentarios operativos), `chk_membresia_fechas` (`fecha_fin >= fecha_inicio`).

## 3. Fuera de alcance en esta fase

- No se toca `coworking_sessions` ni check-in (no se enlaza aún a `membresia_id`).
- No se agrega UI (tab, CRUD, selector) — fase posterior.
- No se define aún el job/cron que pasa `activa → vencida` cuando `fecha_fin < today` — se hará junto con la lógica de consumo.
- No se toca `tarifas_coworking`.

## 4. Verificación

- La migración corre sin errores.
- `supabase--linter` no reporta nuevos hallazgos sobre esta tabla.
- Insert manual con `cliente_id`, `tarifa_id`, `usuario_id` reales devuelve fila con `estado='pendiente_pago'` y `updated_at = created_at`.
- Un `UPDATE` posterior refresca `updated_at` (trigger operando).
- Un usuario sin roles operativos puede leer (política de lectura abierta a autenticados) pero no puede insertar/actualizar/eliminar (policy `FOR ALL` filtra por rol).
