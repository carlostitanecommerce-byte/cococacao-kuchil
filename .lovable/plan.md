## Objetivo

Vincular formalmente las sesiones y reservaciones de coworking al directorio de clientes, reemplazando el input libre de nombre por el `ClienteSelector` y persistiendo `cliente_id` en ambas tablas (sin romper datos históricos).

## 1. Migración de base de datos

Una sola migración que toca dos tablas:

- `ALTER TABLE public.coworking_sessions ADD COLUMN cliente_id UUID NULL REFERENCES public.clientes(id) ON DELETE SET NULL;`
- `ALTER TABLE public.coworking_reservaciones ADD COLUMN cliente_id UUID NULL REFERENCES public.clientes(id) ON DELETE SET NULL;`
- Índices: `CREATE INDEX ... ON (cliente_id)` en ambas tablas.

Notas importantes:
- `cliente_id` queda **nullable** para no romper filas históricas (todavía conservamos `cliente_nombre` como espejo/denormalizado para mostrar en UI sin un join extra y para sesiones/reservaciones antiguas).
- `ON DELETE SET NULL` evita que borrar un cliente del directorio rompa el historial transaccional.
- No se crean nuevas tablas → no hace falta bloque `GRANT` adicional (las tablas ya tienen RLS y grants).
- No se tocan otras políticas, triggers, ni se borra `cliente_nombre`.

## 2. `src/components/coworking/types.ts`

Agregar el campo opcional a las interfaces existentes:
- `CoworkingSession`: `cliente_id?: string | null;`
- `Reservacion`: `cliente_id?: string | null;`

(No quitar `cliente_nombre` — sigue siendo la fuente de visualización.)

## 3. `src/components/coworking/CheckInDialog.tsx`

- Reemplazar el bloque del `<Input id="cliente">` por `<ClienteSelector>`.
- Nuevo estado: `const [cliente, setCliente] = useState<{ id: string; nombre_completo: string } | null>(null);` (sustituye a `clienteNombre`).
- Validación: requerir `cliente` antes de permitir submit (`disabled={!cliente || ...}`).
- En el `insert` a `coworking_sessions`:
  - `cliente_id: cliente.id`
  - `cliente_nombre: cliente.nombre_completo` (se mantiene por compatibilidad y para evitar joins en listados).
- Sustituir las referencias a `clienteNombre.trim()` en el flujo de KDS, audit log y toast por `cliente.nombre_completo`.
- En `resetForm` / cierre del diálogo, hacer `setCliente(null)`.

## 4. `src/components/coworking/ReservacionesTab.tsx`

- Reemplazar el `<Input>` "Cliente" por `<ClienteSelector>`.
- Nuevo estado `cliente` (igual que en CheckInDialog) que sustituye a `clienteNombre`.
- `openEdit(r)`: precargar `cliente` con `{ id: r.cliente_id, nombre_completo: r.cliente_nombre }` cuando `r.cliente_id` exista; si no (reservaciones legacy), dejar el selector vacío mostrando el nombre actual como placeholder informativo (string `r.cliente_nombre` arriba del selector para no perder contexto al reagendar).
- En `insert` y `update` a `coworking_reservaciones`:
  - `cliente_id: cliente.id`
  - `cliente_nombre: cliente.nombre_completo`
- Botón Submit deshabilitado mientras `!cliente`.
- `resetForm` → `setCliente(null)`.

## 5. Lo que NO cambia

- `cliente_nombre` se mantiene en ambas tablas e interfaces (denormalizado, lectura barata, no rompe vistas/reportes existentes).
- `DirectorioClientesTab`, `ClienteSelector`, RLS, edge functions, KDS, billing → sin cambios.
- Componentes que solo leen `cliente_nombre` (tabla de sesiones activas, calendario, reportes) siguen funcionando sin tocarlos.

## 6. Verificación post-cambio

- Build + tsgo deben pasar (tipos regenerados de Supabase incluirán `cliente_id`).
- Check-in nuevo → fila en `coworking_sessions` con `cliente_id` y `cliente_nombre` poblados.
- Reservación nueva y reagendar → fila en `coworking_reservaciones` con ambos campos.
- Editar reservación legacy (sin `cliente_id`) → al guardar, queda enlazada al cliente elegido.

## Resumen técnico

```text
DB:    + coworking_sessions.cliente_id (FK clientes, nullable, SET NULL)
       + coworking_reservaciones.cliente_id (FK clientes, nullable, SET NULL)
Types: + cliente_id?: string | null  (en CoworkingSession, Reservacion)
UI:    Input cliente → ClienteSelector (CheckInDialog, ReservacionesTab)
Writes: insert/update guardan { cliente_id, cliente_nombre }
```
