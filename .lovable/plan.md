## Validación del SQL de actualización de stock

Revisé los 28 nombres del SQL contra la tabla `insumos` y **todos coinciden exactamente** (comparación case-insensitive con TRIM). El SQL es correcto y seguro de aplicar.

### Resumen
- 28 UPDATE → 28 filas afectadas (1 a 1, sin ambigüedad)
- 1 omisión intencional documentada: "Brownie de chocolate" (sin valor en el Excel)
- Caracteres especiales validados: `ñ`, acentos, `"`, `#`, `/`

### Acción al aprobar
Ejecutar los 28 `UPDATE` vía la herramienta de inserción de datos (no migración, ya que son cambios de datos, no de esquema). El `BEGIN/COMMIT` envolvente se mantendrá para asegurar atomicidad.

### Efecto colateral esperado
Al actualizar `stock_actual`, los reportes de valuación de inventario reflejarán los nuevos valores inmediatamente (la valuación se calcula on-the-fly como `stock_actual * costo_unitario`).
