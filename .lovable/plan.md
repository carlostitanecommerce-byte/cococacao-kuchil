# Plan: Correcciones a sesiones pendientes de pago en Caja (4 observaciones)

Cerrar los 4 hallazgos de la auditoría sobre `CoworkingSessionSelector` y el flujo de cancelación/importación de sesiones pendientes de pago.

---

## Paso 1 — 🔴 Permitir cancelar sesiones en `pendiente_pago`

**Archivo:** Migración SQL sobre la RPC `cancelar_sesion_coworking`.

**Problema:** La RPC bloquea cualquier estado distinto de `'activo'`. El botón "Cancelar" en el selector de Caja apunta a sesiones `pendiente_pago` y siempre falla con `Solo se pueden cancelar sesiones activas (estado actual: pendiente_pago)`. Lo mismo bloquea la aprobación de solicitudes de cancelación enviadas por operadores sobre sesiones que ya pasaron a pendiente_pago.

**Corrección:**
- Cambiar la guarda a aceptar ambos estados:
  ```sql
  IF v_session.estado NOT IN ('activo', 'pendiente_pago') THEN
    RAISE EXCEPTION 'Solo se pueden cancelar sesiones activas o pendientes de pago (estado actual: %)', v_session.estado USING ERRCODE = '22023';
  END IF;
  ```
- El resto de la lógica de la RPC funciona igual para ambos estados: las líneas con `venta_id IS NULL` se procesan (mermas por entregados, reposición de stock por no entregados, `DELETE` final), la sesión pasa a `cancelado`, `monto_acumulado = 0`, `fecha_salida_real = now()`, y se registra la bitácora. No hace falta una rama distinta.
- Mantener la doctrina: si la sesión ya tiene `venta_id` estampado en líneas (i.e. `finalizado`), sigue bloqueada — la guarda solo abre los dos estados pre-cobro.

**Verificación post-cambio:**
- Crear sesión, mandar al cobro (queda `pendiente_pago`), regresar a Caja, presionar el botón rojo de basura → la cancelación pasa, la sesión cae a `cancelado`, los consumos abiertos se procesan según entregas declaradas.

---

## Paso 2 — Mostrar monto acumulado en la lista de sesiones

**Archivo:** `src/components/caja/CoworkingSessionSelector.tsx`

**Problema:** El listado solo muestra tiempo transcurrido. `monto_acumulado` se trae en el query pero nunca se pinta, así que el cajero importa "a ciegas".

**Corrección:**
- En la fila de cada sesión pendiente, mostrar el monto acumulado como badge a la derecha del tiempo:
  ```tsx
  <Badge variant="secondary" className="text-[10px] px-1 h-4 font-mono">
    ${Number(s.monto_acumulado ?? 0).toFixed(2)}
  </Badge>
  ```
- Etiquetar como "Acumulado" en tooltip para no confundir con el total final post-cobro (que incluye excedente de tiempo + propina y se calcula al importar). El propósito es dar referencia previa.
- No agregar nuevas queries ni cálculos pesados — usar el valor ya disponible.

---

## Paso 3 — Restringir el botón de cancelar por rol

**Archivos:** `src/components/caja/CoworkingSessionSelector.tsx`

**Problema:** El botón `Ban` (basura roja) se muestra a todos los roles que entran a `/caja`. Aunque `isAdmin` controla la rama interna del dialog (RPC directa vs. solicitud), la *visibilidad* del botón no está gobernada y cualquier cajero podría iniciar el flujo.

**Corrección:**
- Derivar `puedeCancelar` con la misma política que ya rige cancelaciones operativas en POS/Caja: **administrador, supervisor o caja** pueden invocar el flujo (admin = directo, supervisor/caja = solicitud). Barista u otros roles no ven el botón.
  ```ts
  const puedeCancelar =
    roles.includes('administrador') ||
    roles.includes('supervisor') ||
    roles.includes('caja');
  ```
- Renderizar el botón `Ban` solo cuando `puedeCancelar === true`.
- `isAdmin` se sigue pasando al dialog tal cual para que la rama interna no cambie.

---

## Paso 4 — Confirmar antes de sobrescribir el carrito al importar

**Archivos:** `src/components/caja/CoworkingSessionSelector.tsx`

**Problema:** `handleSelect` llama directo a `onImportSession()`, que reemplaza el array completo del carrito. Si el cajero tiene productos sueltos sin sesión activa, los pierde sin aviso.

**Corrección:**
- Leer del store `useCartStore` el `items.length` y `coworkingSessionId` actuales.
- Si `items.length > 0` y la sesión a importar es **distinta** a la `coworkingSessionId` actual, abrir un `AlertDialog` de confirmación con texto claro:
  > "El carrito tiene N producto(s) sin guardar. Si importas esta sesión, el carrito actual se reemplazará. ¿Continuar?"
- El `AlertDialog` reutiliza el patrón de `CajaCheckoutPanel` (mismo componente shadcn).
- Si el carrito está vacío, o si la sesión a importar es la misma ya activa (caso "refrescar consumos"), no se interrumpe — se importa directo.
- Acción confirmar → ejecuta el flujo actual de `handleSelect` (snapshot, cálculo de tiempo, líneas abiertas, etc.).

---

## Sección técnica (resumen)

| # | Tipo | Archivo / Objeto | Riesgo |
|---|---|---|---|
| 1 | Migración SQL | RPC `cancelar_sesion_coworking` (cambio de guarda) | Bajo — solo amplía estados permitidos |
| 2 | UI | `CoworkingSessionSelector.tsx` (badge de monto) | Muy bajo — solo render |
| 3 | UI/permiso | `CoworkingSessionSelector.tsx` (condicional sobre botón Ban) | Bajo — restringe, no expande |
| 4 | UI | `CoworkingSessionSelector.tsx` (AlertDialog previo a import) | Bajo — agrega confirmación |

## Validación final

1. **Admin** cancela sesión `pendiente_pago` desde Caja → éxito, sesión a `cancelado`, mermas correctas.
2. **Supervisor/Caja** ve botón, abre dialog, envía solicitud → admin la aprueba → RPC ya no falla.
3. **Barista** entra a `/caja` (caso extremo, normalmente no debería) → no ve el botón.
4. Cada fila del listado muestra el monto acumulado con dos decimales.
5. Carrito con productos sueltos + importar sesión → aparece AlertDialog; cancelar conserva carrito, confirmar lo reemplaza.

## Fuera de alcance

- No se altera la lógica de cálculo de tiempo/excedente/IVA/propina (intacta del sprint anterior).
- No se cambia el flujo de cobro (`cerrar_cuenta_coworking`).
- No se modifican políticas RLS.
- No se persisten cambios al diseño visual general más allá del badge y el dialog.
