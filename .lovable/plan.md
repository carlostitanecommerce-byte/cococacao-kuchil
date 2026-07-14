## Hallazgo

La tabla `public.clientes` tiene una única política RLS `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Esto es permisivo para `INSERT/UPDATE/DELETE` (cualquier usuario autenticado puede modificar o borrar cualquier cliente del directorio). El linter marca este patrón como riesgo.

Contexto: `clientes` es el directorio compartido de clientes (usado por coworking, membresías, ventas). Todos los roles operativos legítimamente necesitan leer y crear/actualizar clientes durante la operación diaria; sólo la eliminación debería restringirse.

## Cambio propuesto (migración SQL)

Reemplazar la política única por políticas separadas por comando:

```sql
DROP POLICY "Usuarios autenticados pueden leer/escribir clientes" ON public.clientes;

-- Lectura: cualquier usuario autenticado (necesario para selectores en POS, coworking, reportes)
CREATE POLICY "clientes_select_authenticated"
  ON public.clientes FOR SELECT TO authenticated
  USING (true);

-- Alta: cualquier usuario autenticado (recepción/caja/admin dan de alta clientes)
CREATE POLICY "clientes_insert_authenticated"
  ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (true);

-- Edición: roles operativos y administración
CREATE POLICY "clientes_update_operativos"
  ON public.clientes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'administrador'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'caja'::app_role)
    OR public.has_role(auth.uid(), 'recepcion'::app_role)
  );

-- Borrado: sólo administradores
CREATE POLICY "clientes_delete_admin"
  ON public.clientes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'administrador'::app_role));
```

## Impacto

- SELECT/INSERT: sin cambio funcional (siguen abiertos a autenticados).
- UPDATE: bloqueado para roles no operativos (por ejemplo `barista`); los flujos actuales de edición de clientes viven en Coworking/Caja/Directorio, operados por admin/supervisor/caja/recepción.
- DELETE: restringido a administradores. Alineado con la regla del proyecto de no borrar registros transaccionales.

## Fuera de alcance

- No se toca ninguna otra tabla ni política.
- Sin cambios en frontend.

## Pregunta

¿Los roles `caja` y `recepcion` deben poder **editar** clientes (propuesta actual), o preferís restringir UPDATE también sólo a `administrador`/`supervisor`?
