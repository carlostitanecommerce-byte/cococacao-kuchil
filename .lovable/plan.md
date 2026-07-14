## Alcance

Crear un trigger en PostgreSQL que descuente automáticamente las horas consumidas del saldo de una membresía tipo `paquete_horas` cuando la sesión enlazada pase a `estado = 'finalizado'`. Sin cambios en el frontend.

## Migración

Un solo archivo SQL con:

**1. Función `public.descontar_horas_membresia()`** — `RETURNS trigger`, `SECURITY DEFINER`, `SET search_path = public`.

Lógica:
- Se dispara solo cuando `NEW.estado = 'finalizado'` y `OLD.estado IS DISTINCT FROM 'finalizado'` (evita doble descuento en updates posteriores).
- Salir temprano si `NEW.membresia_id IS NULL` o `NEW.fecha_salida_real IS NULL` o `NEW.fecha_inicio IS NULL`.
- Buscar la tarifa de la membresía:
  ```sql
  SELECT t.tipo_cobro
  FROM public.coworking_membresias m
  JOIN public.tarifas_coworking t ON t.id = m.tarifa_id
  WHERE m.id = NEW.membresia_id;
  ```
- Solo continuar si `tipo_cobro = 'paquete_horas'`.
- `horas_consumidas = EXTRACT(EPOCH FROM (NEW.fecha_salida_real - NEW.fecha_inicio)) / 3600.0`.
- `UPDATE public.coworking_membresias SET horas_disponibles = GREATEST(0, horas_disponibles - horas_consumidas), updated_at = now() WHERE id = NEW.membresia_id;`
- `INSERT INTO public.audit_logs (…)` con acción `descontar_horas_membresia`, metadata con `session_id`, `membresia_id`, `horas_consumidas`, `saldo_anterior`, `saldo_nuevo`.
- `RETURN NEW`.

**2. Trigger `trg_descontar_horas_membresia`**:
```sql
CREATE TRIGGER trg_descontar_horas_membresia
AFTER UPDATE OF estado ON public.coworking_sessions
FOR EACH ROW
WHEN (NEW.estado = 'finalizado' AND OLD.estado IS DISTINCT FROM 'finalizado')
EXECUTE FUNCTION public.descontar_horas_membresia();
```

## Fuera de alcance

- No se cambia ninguna función existente (`freeze_checkout_coworking`, `cancelar_sesion_coworking`, etc.).
- No se cobra excedente aquí — eso ya lo hace `handleCheckOut` en la UI.
- No se modifica el frontend.
- No se decrementan horas al pasar a `pendiente_pago` (solo cuando la venta se completa y la sesión llega a `finalizado`).

## Verificación

- Sesión con membresía mensual pasando a `finalizado` → no se toca `horas_disponibles`.
- Sesión sin membresía pasando a `finalizado` → no efecto.
- Sesión con `paquete_horas`, 2h reales, saldo 10h → saldo queda en 8h.
- Sesión con `paquete_horas`, 12h reales, saldo 10h → saldo queda en 0 (por el `GREATEST(0, …)`).
- Reversión: si por alguna operación una sesión vuelve a pasar a `finalizado`, el `WHEN` con `IS DISTINCT FROM` evita doble descuento en el mismo `UPDATE`; solo se re-ejecutaría si la sesión sale de `finalizado` y regresa (flujo hoy no ocurre).
- Consultar `audit_logs` para trazabilidad del descuento.
