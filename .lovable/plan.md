## Fase 1: Tabla `ordenes_pos_pendientes` para sistema de colas

### Objetivo
Permitir que las órdenes del POS se "estacionen" en la base de datos (igual que las sesiones de coworking en `coworking_sessions` con estado `pendiente_pago`), de modo que importar otra cuenta al ticket activo no destruya la información del carrito en curso.

### Análisis del plan propuesto

El esquema sugerido es correcto en lo esencial, pero conviene reforzarlo para mantener consistencia con el resto del sistema (folios, trazabilidad, realtime, integración futura con cocina/coworking). Observaciones:

1. **Folio secuencial:** El proyecto usa folios de 4 dígitos en `ventas` y `cajas` (`SERIAL`). Las órdenes en cola deben tener su propio folio visible (`#0001`) para que el cajero pueda identificarlas rápido en la UI. Se agrega `folio SERIAL`.

2. **Tipo de consumo y notas:** Para no perder info al "despachar" la orden a venta, conviene guardar `tipo_consumo` (`sitio`/`para_llevar`/`delivery`) y `notas`. Así cuando se retome no se pierde el contexto.

3. **Caja asociada:** Toda orden nace dentro de un turno de caja abierto. Guardar `caja_id` ayuda a auditar y filtrar la cola por turno.

4. **Estados:** Usar un ENUM `orden_pos_estado` con `pendiente`, `cobrada`, `cancelada` (en vez de texto libre) para evitar valores inconsistentes y permitir transiciones controladas.

5. **Trazabilidad de cierre:** Agregar `venta_id` (nullable) para enlazar con la `ventas` resultante cuando se cobra, y `cancelada_por`/`motivo_cancelacion` por simetría con el resto del sistema.

6. **Realtime:** Habilitar la tabla en `supabase_realtime` para que el selector de cola en Caja se actualice automáticamente cuando otro cajero crea/cobra una orden (igual que `coworking_sessions`).

7. **RLS:** Seguir el patrón existente:
   - SELECT: cualquier autenticado (la cola es operativa y compartida).
   - INSERT: roles operativos (`administrador`, `supervisor`, `caja`, `recepcion`) y `usuario_id = auth.uid()`.
   - UPDATE: mismo conjunto de roles operativos (para marcar `cobrada`/`cancelada` y enlazar `venta_id`). Sin restricción de propietario porque cualquier cajero del turno puede cobrar una orden parqueada por un compañero.
   - DELETE: solo `administrador` (no se borran físicamente; se cancelan).

8. **Trigger `updated_at`:** Reusar `public.update_updated_at_column()` que ya existe en el proyecto.

### Lo que NO se hace en Fase 1
- No se toca `src/components/pos/*`, `CajaCheckoutPanel.tsx`, `CartPanel.tsx`, ni `CoworkingSessionSelector.tsx`. Esta fase es solo backend.
- No se construye UI del selector de órdenes en cola (será Fase 2).
- No se modifica el flujo de `detalle_ventas` con `venta_id = NULL` (la cuenta abierta de coworking sigue funcionando como hoy).

### Detalles técnicos (SQL)

```sql
-- ENUM de estados
CREATE TYPE public.orden_pos_estado AS ENUM ('pendiente', 'cobrada', 'cancelada');

-- Secuencia para folio de 4 dígitos
CREATE SEQUENCE public.ordenes_pos_folio_seq START 1;

-- Tabla principal
CREATE TABLE public.ordenes_pos_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folio INTEGER NOT NULL DEFAULT nextval('public.ordenes_pos_folio_seq'),
  usuario_id UUID NOT NULL,
  caja_id UUID,
  cliente_nombre TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  tipo_consumo TEXT NOT NULL DEFAULT 'sitio',
  notas TEXT,
  estado public.orden_pos_estado NOT NULL DEFAULT 'pendiente',
  venta_id UUID,
  cancelada_por UUID,
  motivo_cancelacion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ordenes_pos_estado ON public.ordenes_pos_pendientes(estado);
CREATE INDEX idx_ordenes_pos_caja   ON public.ordenes_pos_pendientes(caja_id);

-- Trigger updated_at
CREATE TRIGGER trg_ordenes_pos_updated
BEFORE UPDATE ON public.ordenes_pos_pendientes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.ordenes_pos_pendientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ordenes_pos"
ON public.ordenes_pos_pendientes FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Operadores pueden insertar ordenes_pos"
ON public.ordenes_pos_pendientes FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = usuario_id AND (
    has_role(auth.uid(), 'administrador') OR
    has_role(auth.uid(), 'supervisor')    OR
    has_role(auth.uid(), 'caja')          OR
    has_role(auth.uid(), 'recepcion')
  )
);

CREATE POLICY "Operadores pueden actualizar ordenes_pos"
ON public.ordenes_pos_pendientes FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'administrador') OR
  has_role(auth.uid(), 'supervisor')    OR
  has_role(auth.uid(), 'caja')          OR
  has_role(auth.uid(), 'recepcion')
);

CREATE POLICY "Admins pueden eliminar ordenes_pos"
ON public.ordenes_pos_pendientes FOR DELETE
TO authenticated USING (has_role(auth.uid(), 'administrador'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ordenes_pos_pendientes;
```

### Archivos afectados
- Nueva migración SQL: `ordenes_pos_pendientes` + ENUM + secuencia + RLS + realtime.
- `src/integrations/supabase/types.ts` se regenera automáticamente tras aplicar la migración.

### Siguientes fases (fuera de alcance de esta fase, solo para contexto)
- **Fase 2:** UI de "Parquear orden" en POS/Caja y selector de cola en `CajaCheckoutPanel` (paralelo al `CoworkingSessionSelector`), con confirmación al reemplazar carrito.
- **Fase 3:** Lógica de despacho (al cobrar, marcar `cobrada` y enlazar `venta_id`; al cancelar, registrar motivo).
