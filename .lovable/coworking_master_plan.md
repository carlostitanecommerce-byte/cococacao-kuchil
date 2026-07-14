# Plan Maestro Determinístico: Escalabilidad Profesional de Coworking

De acuerdo a tus requerimientos, he diseñado el **Plan de Implementación Determinístico**. Este plan elimina la ambigüedad y define paso a paso, a nivel técnico, qué tablas, funciones y componentes se deben construir o modificar. Cualquier agente de IA o desarrollador podrá tomar una fase de este documento y ejecutarla con precisión milimétrica.

## Fase 1: Directorio Formal de Clientes (✅ COMPLETADO)

**Objetivo:** Eliminar el uso de texto libre para nombres de clientes y establecer una entidad relacional estricta para ligar membresías y reservaciones.

*(Nota: La base de la Fase 1 ya fue implementada y validada en el repositorio. Queda pendiente aplicar la mejora del mini-diálogo en `ClienteSelector` para capturar teléfono y correo al vuelo sin problemas de focus-trap).*

---

## Fase 2: Motor de Membresías (Backend & Estado)

**Objetivo:** Crear la arquitectura para almacenar contratos mensuales, pases y asignaciones.

### 2.1 Esquema de Base de Datos (SQL)
- **Crear tabla `coworking_membresias_activas`**
  ```sql
  CREATE TABLE public.coworking_membresias_activas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id UUID REFERENCES public.clientes(id) NOT NULL,
      tarifa_id UUID REFERENCES public.tarifas_coworking(id) NOT NULL,
      area_id UUID REFERENCES public.areas_coworking(id), -- Null si es general (ej. hot desk)
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      estado TEXT CHECK (estado IN ('pendiente_pago', 'activa', 'vencida', 'cancelada')) NOT NULL DEFAULT 'pendiente_pago',
      horas_disponibles NUMERIC DEFAULT 0, -- Para paquetes de horas
      created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE public.coworking_membresias_activas ENABLE ROW LEVEL SECURITY;
  -- Añadir políticas RLS.
  ```
- **Modificar `coworking_sessions`**: Añadir columna `membresia_id UUID REFERENCES public.coworking_membresias_activas(id)`.

### 2.2 Integración en Frontend (`useCoworkingData.ts`)
- Añadir el estado `const [membresias, setMembresias] = useState<Membresia[]>([]);`
- Modificar `fetchData()` para consultar `coworking_membresias_activas` donde `estado IN ('activa', 'pendiente_pago')`.
- Añadir suscripción en tiempo real a esta nueva tabla.

---

## Fase 3: Flujo de Venta (Coworking -> Caja)

**Objetivo:** Permitir vender una membresía mensual sin crear una "sesión física", enviando la cuenta directamente a la Caja.

### 3.1 Nuevo Componente de Venta
- **Crear `src/components/coworking/VenderMembresiaDialog.tsx`**:
  - Inputs: Cliente (`ClienteSelector`), Tarifa (filtrada por `tipo_cobro === 'mes' || 'paquete_horas'`), Área asignada (si la tarifa lo requiere), y Fecha de Inicio (por defecto hoy).
  - Acción "Enviar a Caja": Al hacer submit:
    1. Inserta un registro en `coworking_membresias_activas` con `estado = 'pendiente_pago'`.
    2. Crea una entrada en la cuenta de cobro del POS (dependiendo de la tabla de ventas actual en tu POS, por ejemplo insertando en el `carrito` o `cuentas_pendientes` global con tipo "Membresía").

### 3.2 Modificación en Caja (`CajaCheckoutPanel.tsx`)
- Detectar ítems de tipo "Membresía Coworking".
- Al procesar el pago exitosamente (Confirmar Venta), ejecutar una actualización:
  ```sql
  UPDATE coworking_membresias_activas SET estado = 'activa' WHERE id = [ID de membresía ligada a la venta];
  ```

---

## Fase 4: Bloqueo de Espacios a Largo Plazo y Calendario

**Objetivo:** Prevenir que un espacio alquilado por mes sea reservado o usado por alguien más.

### 4.1 Lógica de Disponibilidad (`conflictCheck.ts` y `useCoworkingData.ts`)
- **Modificar `getAvailablePax(areaId)`**:
  - Identificar si el `area_id` tiene una membresía `estado = 'activa'` cuya `fecha_inicio <= hoy` y `fecha_fin >= hoy`.
  - Si es oficina privada y está bajo membresía, retornar `0` (Bloqueo total).
- **Modificar `checkReservationConflict`**:
  - Al validar una nueva reservación, consultar `coworking_membresias_activas`. Si la fecha de la reservación cae dentro de la vigencia de una membresía en esa misma `area_id` privada, rechazar la reservación: `hasConflict: true, message: 'Espacio bajo renta mensual'`.

### 4.2 Visualización (`ReservationCalendar.tsx`)
- Inyectar en el calendario eventos de tipo "background" o "block" (FullCalendar soporta `rendering: 'background'`) desde `fecha_inicio` hasta `fecha_fin` para mostrar el espacio visualmente bloqueado.

---

## Fase 5: Integración Operativa de Membresías y Paquetes de Horas

**Objetivo:** Registrar el ingreso y salida de clientes con membresías mensuales o paquetes de horas, aplicando descuentos automáticos y cobro de excedentes.

### 5.1 Modificación en `CheckInDialog.tsx`
- Al seleccionar un Cliente en `ClienteSelector`, buscar si tiene una membresía `activa` válida hoy.
- **Validación de Paquete de Horas:**
  - Si es una membresía de tipo `paquete_horas`, verificar que `horas_disponibles > 0`.
  - Si no tiene saldo (`horas_disponibles <= 0`), mostrar alerta roja: *"Membresía Agotada: El cliente no tiene horas disponibles en su paquete."* e impedir enlazar la membresía a la sesión (se cobrará tarifa regular).
  - Si tiene saldo, mostrar alerta verde: *"Membresía Activa: Paquete de Horas (Saldo: X horas)"*.
  - Si es una membresía mensual (`mes`), mostrar alerta verde: *"Membresía Activa: Mensual [Nombre de Tarifa]"*.
- Si se procede con el Check-in, insertar en `coworking_sessions`:
  - `membresia_id` = ID de la membresía activa.
  - `tarifa_id` = null (o la tarifa base a precio 0).

### 5.2 Modificación en `CheckoutDialog.tsx` / Lógica de Cobro (`CoworkingPage.tsx`)
- Si la sesión tiene `membresia_id != null` (el cliente entró bajo una membresía activa):
  - **Caso 1: Membresía Mensual (`mes`):**
    - El cálculo de `tiempoContratadoMin`, `tiempoExcedidoMin` y `subtotalContratado` debe ser **$0.00** (tiempo ilimitado).
    - Cobrar únicamente Upsells.
  - **Caso 2: Paquete de Horas (`paquete_horas`):**
    - Calcular la duración real de la sesión: `horas_sesion = tiempoRealMin / 60.0`.
    - Calcular excedente: `horas_excedidas = Math.max(0, horas_sesion - membresia.horas_disponibles)`.
    - `subtotalContratado` = **$0.00** (tiempo cubierto por el paquete prepagado).
    - `cargoExtra` = `horas_excedidas * precioBase` (las horas consumidas que superen el saldo disponible de la membresía se cobrarán a tarifa por hora regular).
    - Cobrar de forma normal los Upsells.

### 5.3 Descuento Automático de Saldo en Base de Datos
- Crear un trigger en PostgreSQL (`trg_descontar_horas_membresia` en `public.coworking_sessions`) que se ejecute `AFTER UPDATE` cuando la sesión pase a `estado = 'finalizado'`:
  - Si `membresia_id` no es nulo y la tarifa asociada de la membresía es `tipo_cobro = 'paquete_horas'`:
    - Calcular las horas consumidas: `horas_consumidas = (fecha_salida_real - fecha_inicio) en horas`.
    - Ejecutar: `UPDATE coworking_membresias SET horas_disponibles = GREATEST(0, horas_disponibles - horas_consumidas) WHERE id = membresia_id;`.


---

## Fase 6: Módulo de Gestión de Clientes y Membresías (Enfoque Unificado)

**Objetivo:** Rediseñar la sección de Directorio a una pestaña unificada llamada **"Clientes"** que contenga sub-pestañas internas (segmentos) para alternar entre el Directorio de Clientes y el Panel de Control de Membresías. Esto optimiza el espacio en pantalla (ideal para POS) y consolida la administración del usuario.

### 6.1 Modificación en `src/pages/CoworkingPage.tsx`
- Renombrar la pestaña principal de `"directorio"` a `"clientes"` en el componente `<Tabs>`:
  - Cambiar `<TabsTrigger value="directorio">Directorio</TabsTrigger>` por `<TabsTrigger value="clientes">Clientes</TabsTrigger>`.
  - Reemplazar el bloque `<TabsContent value="directorio">` por un bloque `<TabsContent value="clientes">` que implemente un control interno de sub-pestañas (utilizando el componente `<Tabs>` de Shadcn con `defaultValue="directorio"`):
    - Sub-tab 1: `Clientes` → Renderiza `<DirectorioClientesTab />`.
    - Sub-tab 2: `Membresías` → Renderiza `<MembresiasDashboardTab membresias={data.membresias} areas={data.areas} onSuccess={data.fetchData} onRenew={handleOpenRenewDialog} />`.

### 6.2 Crear Componente `src/components/coworking/MembresiasDashboardTab.tsx`
Componente para la visualización y gestión administrativa de los contratos y paquetes:
- **Filtros de búsqueda y estado:** Búsqueda rápida por nombre de cliente y filtro segmentado por estado (`Todos`, `Activas`, `Vencidas`, `Pendientes de Pago`).
- **Tabla de Membresías:**
  - **Columnas:** Cliente, Tarifa (tipo de cobro y nombre), Área Asignada (si aplica), Vigencia (Inicio a Fin), Horas (Totales vs. Disponibles, visible solo si es `paquete_horas`), Estado y Acciones.
  - **Visualización de Estados (Aesthetics):**
    - `activa`: Badge verde (`emerald`).
    - `pendiente_pago`: Badge naranja (`amber`).
    - `vencida`: Badge rojo (`destructive`).
    - `cancelada`: Badge gris (`muted`).
- **Acciones Directas:**
  - **Botón "Renovar":** Abre el modal de venta pre-llenado con los datos del cliente, la tarifa y el área anterior para agilizar la renovación.
  - **Botón "Cancelar":** Muestra un diálogo de confirmación y actualiza el estado de la membresía en la base de datos a `cancelada`.
