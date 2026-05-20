## Estado actual de la base de datos

Lo que ya está poblado:
- **areas_coworking** — 7 áreas (Área pública, 4 cubículos, Sala de juntas, Oficina BCM) con capacidad y precio por hora.
- **insumos** — 108 insumos (cafés, chocolates, panadería, desechables, embotellados, etc.) con stock y costo.
- **configuracion_ventas** — 1 fila: IVA = 16.

Lo que está **vacío** y bloquea el uso de la app:

| Tabla | Estado | Impacto |
|---|---|---|
| `profiles` + `user_roles` | 0 | No puedes iniciar sesión |
| `categorias_maestras` | 0 | Filtros de POS/Menú vacíos |
| `productos` | 0 | POS sin nada que vender |
| `recetas` | 0 | Sin descuento de stock al vender |
| `tarifas_coworking` | 0 | No se pueden abrir sesiones de coworking |
| `tarifa_amenities_incluidos` | 0 | Sin amenities incluidos |
| `tarifa_upsells` | 0 | Sin precios especiales coworking |
| `plataformas_delivery` + `producto_precios_delivery` | 0 | Módulo delivery vacío |

Tablas **transaccionales** que es correcto que estén vacías (se llenan al usar la app): `cajas`, `ventas`, `detalle_ventas`, `coworking_sessions`, `coworking_reservaciones`, `compras_insumos`, `mermas`, `kds_orders`, paquetes, solicitudes y bitácora.

## Plan de carga de datos de prueba

### 1. Usuarios y roles (vía edge function `create-user`)
Crear las 5 cuentas estándar del proyecto (memoria `mem://testing/test-accounts`):

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `admin123` | administrador |
| `supervisor` | `super123` | supervisor |
| `caja` | `caja1234` | caja |
| `barista` | `barista1` | barista |
| `recepcion` | `recep123` | recepcion |

El login interno les añade `@cocoycacao.local`. Se invocará la edge function ya existente para que cree correctamente la fila en `auth.users` + `profiles` + `user_roles` con la contraseña encriptada vía `pgcrypto`.

### 2. Categorías maestras (`categorias_maestras`)
Insertar ~10 categorías de producto alineadas con un POS de cafetería:
- Ámbito `producto`: Cafés calientes, Cafés fríos, Chocolates, Tés e infusiones, Panadería, Postres, Salados, Bebidas embotelladas, Helados.
- Ámbito `coworking`: Servicios coworking.

### 3. Productos (`productos`) + recetas (`recetas`)
Insertar ~25 productos representativos enlazados a insumos reales que ya existen, con sus recetas (cantidades por unidad de medida). Ejemplos:
- **Cafés calientes:** Espresso, Americano, Capuchino, Latte, Chocolate caliente tradicional, Chocolate caliente a la leña.
- **Cafés fríos:** Cold brew, Frappé de cacao, Frappé capuchino.
- **Panadería/postres:** Browcheese, Barrita de amaranto, Chocolate en barritas.
- **Embotellados:** Agua Kirkland 500ml, Agua mineral, Agua de jamaica, Agua de coco.
- **Amenities coworking (precio 0 o upsell):** Café de cortesía, Agua de cortesía.

Cada producto con `precio_venta` realista (45–95 MXN para bebidas, 30–80 para snacks), `costo_total` y `margen` se recalculan automáticamente por el trigger existente.

### 4. Tarifas de coworking (`tarifas_coworking` + amenities + upsells)
Crear 3 tarifas:
- **Tarifa pública por hora** — `tipo_cobro = hora`, `precio_base = 65`, aplica a `Área pública` y `Cubículo 1`. Incluye 1 café + 1 agua por pax.
- **Tarifa privada por hora** — `precio_base` igual al `precio_por_hora` del área (110/130/165/390), aplica al resto. Incluye 2 cafés + 1 agua por pax.
- **Tarifa media jornada (4h fija)** — `tipo_cobro = paquete`, `precio_base = 220`, aplica a Área pública.

Cada tarifa con 1–2 amenities incluidos y 2–3 upsells (precio especial de algunos productos para clientes coworking).

### 5. Plataformas delivery (`plataformas_delivery`) + precios (`producto_precios_delivery`)
- Rappi (30%), UberEats (28%), DiDi Food (25%).
- Para ~10 productos principales, precio inflado +35% para absorber comisión.

### 6. (Opcional — descartado) Compras, ventas, sesiones
**No** voy a insertar transacciones históricas (ventas, sesiones cerradas, compras) porque:
- Generaría bitácora confusa con un `user_id` ficticio.
- Los reportes del módulo de Caja se basan en turnos reales abiertos por un cajero autenticado.
- Es más realista que tú abras una caja y hagas 2-3 ventas de prueba después.

Si quieres, después puedo inyectar 1 turno cerrado + 3 ventas históricas para probar el módulo de Reportes, pero eso requiere decidir contra qué usuario atribuirlas.

## Cómo lo voy a ejecutar

1. **Edge function call** para los 5 usuarios (no migración, llamada HTTP a `create-user` con el service role).
2. **Una sola sentencia SQL transaccional** (`supabase--insert`) que crea: categorías, productos, recetas, tarifas, amenities, upsells, plataformas delivery y precios delivery. Todo con `ON CONFLICT DO NOTHING` para que sea idempotente.
3. Verificación final con `SELECT count(*)` en cada tabla afectada.

## Lo que **no** se va a tocar
- `areas_coworking`, `insumos`, `configuracion_ventas`: ya están bien.
- Tablas transaccionales: se quedan vacías como debe ser.
- Esquema: cero migraciones, solo inserts.

## Riesgos
- Si algún insumo referenciado por nombre ya no existe, la receta de ese producto se omitirá (uso lookup por `nombre` exacto). Te avisaré si pasa.
- Los precios de venta son orientativos basados en mercado de cafetería en México; tú deberás ajustarlos al menú real cuando los validemos.
