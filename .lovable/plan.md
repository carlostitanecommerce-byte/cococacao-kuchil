# Cargar inventario físico al 30-may-2026

## Objetivo
Pisar el `stock_actual` de la tabla `insumos` con las cantidades reales contadas en el Excel adjunto (columna **Stock (Unidades)**), para poder operar el POS con stock real.

## Alcance
- **Solo** se actualiza la columna `stock_actual` de `public.insumos`.
- El match se hace por `nombre` exacto (case-sensitive, con acentos y caracteres especiales tal cual aparecen en el Excel).
- No se modifican: costos, presentaciones, unidades de medida, recetas, productos, ni cualquier otra tabla.
- No se crean insumos nuevos. Si un nombre del Excel no existe en `insumos`, se reporta como "no encontrado" y se omite.

## Cómo se ejecuta
Un único `UPDATE` masivo usando una lista `VALUES (nombre, stock)` cruzada con la tabla `insumos` por `nombre`. Esto se aplica con la herramienta de datos (no migración) ya que es una actualización de filas existentes.

```sql
UPDATE public.insumos AS i
SET stock_actual = v.stock,
    updated_at = now()
FROM (VALUES
  ('Agitador de madera p/café, bolsa de 500 pz', 220),
  ('Agua botella Kirkland de 500 ml, caja de 40 pzs', 139),
  -- ... 130+ filas con todos los insumos del Excel ...
  ('Vaso pet de 16 oz ultra claro, paq 50 pzs', 34)
) AS v(nombre, stock)
WHERE i.nombre = v.nombre;
```

## Validación posterior
1. Consultar `SELECT count(*), sum(stock_actual * costo_unitario) FROM insumos` para verificar que la valuación total se acerque a **$15,320.41** (total del Excel).
2. Listar cualquier nombre del Excel que no haya hecho match en `insumos` y reportarlo para decidir si se crea manualmente o se ignora.

## Consideraciones
- Operación destructiva sobre `stock_actual`: el valor anterior se pierde (no hay historial por insumo). Esto es lo deseado: el inventario físico es la fuente de verdad al día de hoy.
- No se generan movimientos en `compras_insumos` ni en `mermas` por este ajuste inicial.
- Si en el futuro quieres trazabilidad de este ajuste, se puede registrar una entrada en `audit_logs` describiendo "Carga inicial de inventario físico 30-may-2026".

¿Apruebas que proceda con el `UPDATE` masivo y el reporte de no-encontrados?
