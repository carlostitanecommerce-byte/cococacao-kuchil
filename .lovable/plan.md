## Objetivo
Eliminar las dos migraciones duplicadas con nombre de plan y conservar el par con hash que la plataforma registró como aplicado.

## Verificación previa (ya hecha)
- `supabase_migrations.schema_migrations` contiene sólo `20260718213145` y `20260718213334` para el 18-jul. Los archivos `20260718000000_*` y `20260718000100_*` NO están registrados como aplicados.
- Diff entre cada par: idénticos salvo comentarios y newline final. Sin diferencias funcionales.

## Cambios
Eliminar del repositorio:
- `supabase/migrations/20260718000000_sanear_tarifa_snapshot_sesion.sql`
- `supabase/migrations/20260718000100_backfill_snapshots_pendientes.sql`

Conservar (aplicados en BD):
- `supabase/migrations/20260718213141_8e8f9494-a08e-4b29-b387-f80ea4c51c56.sql`
- `supabase/migrations/20260718213332_ba187f74-fab8-4037-92e4-f143be19122d.sql`

## Verificación post-cambio
- `ls supabase/migrations/ | grep 20260718` muestra sólo los dos archivos con hash.
- No se ejecuta ninguna migración nueva (los archivos borrados nunca estuvieron registrados).