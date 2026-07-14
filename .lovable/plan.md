
## Alcance

Fase 6.1 y 6.2 del plan maestro: reestructurar la pestaña "Directorio" de `CoworkingPage` como "Clientes" con dos sub-pestañas (Directorio + Membresías), y crear el componente `MembresiasDashboardTab` para administrar contratos y paquetes de horas.

Sin cambios de esquema en la base de datos. Reutiliza `VenderMembresiaDialog` para la renovación mediante props de pre-llenado.

---

## 1. `src/pages/CoworkingPage.tsx`

**a) Renombrar la pestaña principal:**

- Cambiar `<TabsTrigger value="directorio">Directorio</TabsTrigger>` por `<TabsTrigger value="clientes">Clientes</TabsTrigger>`.
- Cambiar `<TabsContent value="directorio">` a `<TabsContent value="clientes">`.

**b) Sub-pestañas dentro de "Clientes":**

Dentro del `TabsContent value="clientes"` anidar un `<Tabs defaultValue="directorio">` de shadcn con dos triggers:

```
Directorio  → <DirectorioClientesTab />
Membresías  → <MembresiasDashboardTab
                membresias={data.membresias}
                areas={data.areas}
                onSuccess={data.fetchData}
                onRenew={handleOpenRenewDialog}
              />
```

**c) State y handler para renovación:**

- Nuevo state `const [renewMembresia, setRenewMembresia] = useState<Membresia | null>(null)`.
- Nuevo handler `handleOpenRenewDialog = (m: Membresia) => setRenewMembresia(m)`.
- El `VenderMembresiaDialog` ya montado se extiende para aceptar la prop opcional `renewFrom?: Membresia | null`. Se pasan `open={venderMembresiaOpen || !!renewMembresia}` y `onOpenChange` que limpia ambos states.

**d) Import nuevo:** `MembresiasDashboardTab` desde `@/components/coworking/MembresiasDashboardTab`.

---

## 2. `src/components/coworking/VenderMembresiaDialog.tsx` (extensión mínima)

Añadir prop opcional:

```ts
renewFrom?: Membresia | null;
```

Cuando `renewFrom` esté presente al abrir:
- Pre-llenar `cliente` (fetch a `clientes` por `renewFrom.cliente_id` una sola vez al abrir, para hidratar nombre/email/telefono).
- Pre-seleccionar `tarifaId = renewFrom.tarifa_id`.
- Pre-seleccionar `areaId = renewFrom.area_id ?? ''`.
- `fechaInicio` = día siguiente a `renewFrom.fecha_fin` si es futuro, en otro caso `todayCDMX()`.
- `horasTotales` = valor `horas_totales` original si la tarifa es `paquete_horas`.

Título del diálogo cambia a "Renovar Membresía" cuando `renewFrom` está activo. Al cerrar se limpia igual que antes.

Ningún cambio en la lógica de INSERT: se sigue creando una nueva membresía en `estado = 'pendiente_pago'` (no se toca la anterior).

---

## 3. `src/components/coworking/MembresiasDashboardTab.tsx` (nuevo)

**Props:**

```ts
interface Props {
  membresias: Membresia[];
  areas: Area[];
  onSuccess: () => void | Promise<void>;
  onRenew: (m: Membresia) => void;
}
```

**UI y comportamiento:**

- Header con título "Membresías" e icono `Package`.
- Barra superior:
  - Input de búsqueda con icono `Search`, placeholder "Buscar por cliente".
  - Filtro segmentado (grupo de `<Button variant={...}>` o `ToggleGroup`) con opciones: `Todos`, `Activas`, `Pendientes de Pago`, `Vencidas`. Estado inicial `Todos`.

- Enriquecimiento de datos (una consulta al montar y cuando cambien `membresias`):
  - `clientes`: `id, nombre_completo` de todos los `cliente_id` únicos.
  - `tarifas`: `id, nombre, tipo_cobro` de todos los `tarifa_id` únicos.
  - Se guardan en `Map` para lookup O(1). Fallback a `—` si falta el dato.

- Tabla (`shadcn Table`) con columnas:
  1. **Cliente** — nombre_completo del cliente.
  2. **Tarifa** — `${nombre}` con sub-línea muted mostrando el `tipo_cobro` legible (`Mensual`, `Paquete de horas`).
  3. **Área** — `area.nombre_area` o `—` si `area_id` es null.
  4. **Vigencia** — `fecha_inicio → fecha_fin` formateadas `dd MMM yyyy`.
  5. **Horas** — solo si `tipo_cobro === 'paquete_horas'`: `${horas_disponibles} / ${horas_totales} h`. En otro caso `—`.
  6. **Estado** — Badge coloreado:
     - `activa`: `bg-emerald-500/15 text-emerald-700 border-emerald-500/30`
     - `pendiente_pago`: `bg-amber-500/15 text-amber-700 border-amber-500/30`
     - `vencida`: `variant="destructive"`
     - `cancelada`: `variant="secondary"` (muted)
  7. **Acciones**:
     - Botón "Renovar" (icono `RefreshCw`) → llama `onRenew(m)`. Deshabilitado si `estado === 'cancelada'`.
     - Botón "Cancelar" (icono `XCircle`, `variant="ghost"` destructive) → abre `AlertDialog` de confirmación. Solo visible si `estado IN ('activa', 'pendiente_pago')`.

- **Cancelar membresía:**
  - `AlertDialog` con texto "¿Cancelar la membresía de <cliente>? Esta acción marca la membresía como cancelada y libera el espacio."
  - Confirmar ejecuta:
    ```ts
    await supabase
      .from('coworking_membresias')
      .update({ estado: 'cancelada' })
      .eq('id', m.id);
    ```
    Luego `audit_logs` insert con acción `cancelar_membresia_coworking` y metadata `{ membresia_id, cliente_id }`.
  - Toast success + `await onSuccess()`.

- **Filtrado + búsqueda** en un `useMemo`:
  - Aplica el filtro de estado (`Todos` = sin filtro, resto compara con `m.estado`).
  - Aplica búsqueda case-insensitive contra el nombre del cliente resuelto.

- **Paginación** con `DataPagination` (mismo patrón que `DirectorioClientesTab`, pageSize default 20, opciones `[10,20,50,100]`).

- **Estados vacíos:** filas placeholder con "Sin membresías" o "Sin resultados para \"…\"".

---

## Detalles técnicos

- **Sin cambios de BD.** El estado `vencida` ya se muestra si otra parte del sistema lo asigna; este tab no automatiza vencimientos.
- **`useCoworkingData`** ya carga `data.membresias` con `estado IN ('activa','pendiente_pago')`. Para que las canceladas/vencidas se listen aquí sin ampliar ese hook, `MembresiasDashboardTab` hace una fetch propia complementaria a `coworking_membresias` (todas las membresías) con suscripción realtime al mismo canal. Se prioriza esta consulta local para no romper otros consumidores de `data.membresias` que dependen de que sean solo las utilizables.

  ```
  Datos que muestra el tab
       ↓
  fetch local (todas) ⇢ enriquece con clientes/tarifas
       ↓
  filtros UI (estado + búsqueda)
       ↓
  tabla + acciones (renovar / cancelar)
  ```

- Toasts (`sonner`) y confirmaciones (`AlertDialog`) siguen el patrón de `DirectorioClientesTab`.
- Timezone: usar `formatDate` local con locale `es-MX` sobre `fecha_inicio` / `fecha_fin` (ya son `DATE`).

---

## Fuera de alcance

- Lógica automática de expiración (marcar `vencida` cuando `fecha_fin < hoy`) — se maneja aparte.
- Cambios en `CajaCheckoutPanel` (la renovación ya reutiliza el flujo existente de "Enviar a Caja").
- Reportes / dashboard analítico de membresías.

## Verificación

- La pestaña principal muestra "Clientes" con dos sub-tabs; "Directorio" queda idéntico al comportamiento actual.
- La sub-tab "Membresías" lista todas las membresías con badges de color correctos.
- Filtro por estado y búsqueda por nombre funcionan combinados.
- "Renovar" abre `VenderMembresiaDialog` pre-llenado con cliente, tarifa, área y horas de la membresía original.
- "Cancelar" con confirmación actualiza `estado` a `cancelada` y refresca la tabla.
- Columna Horas solo aparece con valor en filas `paquete_horas`.
