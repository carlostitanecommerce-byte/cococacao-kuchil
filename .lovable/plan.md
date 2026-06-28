## Objetivo

Crear `src/components/coworking/DirectorioClientesTab.tsx`: pestaña CRUD para administrar el directorio de clientes (listar, buscar, crear, editar, eliminar) e integrarla como nueva pestaña "Directorio" en `CoworkingPage`.

## UI

- **Encabezado**: título "Directorio de clientes" + buscador (`Input` con ícono) + botón "Nuevo cliente".
- **Tabla** (`@/components/ui/table`): columnas `Nombre`, `Teléfono`, `Email`, `Creado`, `Acciones` (editar / eliminar).
- **Estado vacío**: mensaje "Sin clientes registrados" o "Sin resultados para '{query}'".
- **Paginación**: cliente-side simple usando `data-pagination` (20 por página) ya que el catálogo será pequeño/medio.
- **Realtime**: suscripción a `clientes` para refrescar la lista al vuelo.

## Diálogos

- **Crear / Editar**: un solo `Dialog` con campos `nombre_completo` (obligatorio), `telefono`, `email`. Validación con `zod` (nombre 1–120 chars, email opcional pero válido si se llena, teléfono opcional máx 30 chars).
- **Eliminar**: `AlertDialog` con confirmación. Antes de borrar, verifica si el cliente tiene sesiones de coworking asociadas (hoy `coworking_sessions` solo guarda `cliente_nombre` como texto, sin FK, así que el borrado es seguro a nivel de integridad). Si en el futuro se añade FK, este check se ampliará.

## Datos

- Fetch: `supabase.from('clientes').select('*').order('nombre_completo')`.
- Búsqueda: filtro local sobre el resultado (los volúmenes esperados son bajos); si hay >500 registros, se cambia a `ilike` server-side.
- Mutaciones: `insert`, `update`, `delete` directos; toasts con sonner para feedback y manejo de errores.

## Integración en `CoworkingPage`

- Agregar `<TabsTrigger value="directorio">Directorio</TabsTrigger>` (visible para todos los roles operativos; sin restricción adicional).
- Agregar `<TabsContent value="directorio"><DirectorioClientesTab /></TabsContent>`.

## Fuera de alcance

- No se modifica la tabla `clientes` ni sus políticas RLS.
- No se vinculan sesiones existentes ni se hace migración de `cliente_nombre` (texto) hacia `cliente_id` (FK) — eso será una fase posterior.
- No se exporta a Excel ni se importa en lote.

## Detalles técnicos

- Componentes shadcn: `Table`, `Dialog`, `AlertDialog`, `Input`, `Label`, `Button`, `DataPagination`.
- Iconos: `Users`, `Pencil`, `Trash2`, `Plus`, `Search` de `lucide-react`.
- Tipo `Cliente` ya disponible en `src/components/coworking/types.ts`.
- Patrón de realtime: igual al usado en `useCoworkingData` (canal único, cleanup en unmount).
