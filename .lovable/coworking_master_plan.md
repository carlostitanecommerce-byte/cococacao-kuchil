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

## Fase 5: Check-in Gratuito para Miembros (Integración Operativa)

**Objetivo:** Cuando el cliente mensual llegue al coworking, registrar su ingreso físico sin sumarle cargos monetarios de tiempo.

### 5.1 Modificación en `CheckInDialog.tsx`
- Al seleccionar un Cliente en `ClienteSelector`, buscar en el estado global si tiene una membresía `activa` válida hoy.
- Mostrar alerta visual: *"Membresía Activa: [Nombre de Tarifa]"*.
- Si se procede con el Check-in, insertar en `coworking_sessions`:
  - `membresia_id` = ID de la membresía activa.
  - `tarifa_id` = null (o la tarifa base a precio 0).

### 5.2 Modificación en `CheckoutDialog.tsx`
- Si la sesión tiene `membresia_id != null`:
  - El cálculo de `tiempoContratadoMin`, `tiempoExcedidoMin` y `subtotalContratado` debe ser **$0.00**.
  - Cobrar únicamente Upsells (amenities de cafetería extras consumidos durante la sesión).

---

## Fase 6: Módulo de Pestaña de Membresías y Reportes

**Objetivo:** Interfaz para administrar clientes y renovaciones.

### 6.1 Componente `MembresiasDashboardTab.tsx`
- Tabla que lista todas las membresías (`coworking_membresias_activas`).
- Botones de acción:
  - **Renovar**: Abre el modal de venta pre-llenado para empujar la fecha 30 días más.
  - **Cancelar Membresía**: Cambia estado a `cancelada`.
- Mostrar visualmente el estado: Activa (Verde), Vencida (Rojo), Pendiente de Pago (Naranja).
