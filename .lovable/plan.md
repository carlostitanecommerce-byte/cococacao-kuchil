## Plan: Agregar soporte de plataforma delivery a ventas

### Contexto
Para registrar desde qué plataforma de delivery (Rappi, Uber Eats, Didi Food, etc.) proviene una venta cuando `tipo_consumo = 'delivery'`, es necesario vincular la venta a `plataformas_delivery`.

---

### Paso 1 — Migración SQL: agregar `plataforma_id` a `ventas`

- Agregar columna `plataforma_id` (uuid, nullable) a `public.ventas`.
- Llave foránea a `public.plataformas_delivery(id)` con `ON DELETE SET NULL`.
- Crear índice `idx_ventas_plataforma` para acelerar filtros por plataforma.
- RLS: la columna es nullable porque solo aplica a `tipo_consumo = 'delivery'`.

### Paso 2 — Tipos TypeScript: `VentaSummary`

- Archivo: `src/components/pos/types.ts`
- Agregar campo opcional `plataforma_id?: string` a `VentaSummary`.
- Solo presente cuando `tipo_consumo === 'delivery'`.

---

## ¿Aprobamos e implementamos?
