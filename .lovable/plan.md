# Causa raíz

Al revisar la base de datos encontré lo siguiente:

- En `auth.users` existen 3 usuarios (admin + 2 supervisores nuevos) y en `user_roles` los 3 tienen su rol asignado correctamente.
- En `public.profiles` solo existe 1 fila: la del admin.
- La función `public.handle_new_user()` existe y está diseñada para insertar en `profiles` cada vez que se crea un usuario en `auth.users`… **pero el trigger que la dispara (`on_auth_user_created` sobre `auth.users`) NO existe** (consulta a `pg_trigger` devuelve vacío).
- La Edge Function `create-user` asume que el trigger existe: crea el usuario con `auth.admin.createUser`, y después llama al RPC `encrypt_and_save_password`, el cual hace `UPDATE public.profiles ... WHERE id = p_user_id`. Como el trigger no existe, no hay fila que actualizar y el `UPDATE` afecta 0 registros silenciosamente. Tampoco se asigna `username` ni `password_encrypted`.
- Por eso en la tarjeta "Colaboradores Registrados" no aparecen: `UsersPage` lista a partir de `profiles`, y los supervisores no tienen perfil.

# Plan de solución

## 1. Restaurar el trigger faltante (migración)

```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## 2. Respaldo de los 2 supervisores existentes (data fix vía insert tool)

- Insertar en `profiles` las filas faltantes para `rocio` y `prueba`, tomando `nombre` de `raw_user_meta_data` y `username` del prefijo del email (`split_part(email,'@',1)`).
- No es posible recuperar la contraseña en texto plano (no se guardó), así que `password_encrypted` quedará `NULL` para esos dos. La columna "Contraseña" mostrará "No disponible" hasta que un admin les reasigne contraseña.

```sql
INSERT INTO public.profiles (id, nombre, email, username)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'nombre', u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)),
       u.email,
       COALESCE(u.raw_user_meta_data->>'username', split_part(u.email,'@',1))
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
```

## 3. Blindar `create-user` (edge function)

Cambiar la llamada al RPC `encrypt_and_save_password` por un patrón **upsert-safe**: primero hacer `upsert` en `profiles` con `{ id, nombre, email, username }`, y luego sí encriptar la contraseña. Así, aunque el trigger falle en el futuro, el perfil siempre se crea desde la edge function.

Adicionalmente, si el upsert o el `insert` del rol falla, hacer rollback eliminando el usuario recién creado en `auth.admin` para no dejar usuarios huérfanos.

## 4. (Opcional, recomendado) Endpoint "Restablecer contraseña"

Agregar un botón en `UsersPage` que invoque una nueva edge function `reset-user-password` (solo admin) para asignar nueva contraseña a Rocío y Prueba — actualiza `auth` y vuelve a llamar `encrypt_and_save_password`. Esto restablece la visibilidad de la contraseña para ese par de usuarios. Se incluye en el plan; si lo prefieres después, lo dejamos fuera.

# Resultado esperado

- Cualquier usuario futuro creado desde "Gestión de Usuarios" tendrá automáticamente fila en `profiles`, `username`, `password_encrypted` y rol — incluso si el trigger se vuelve a perder, porque la edge function ya lo hace por sí misma.
- Los 2 supervisores aparecerán inmediatamente en la tarjeta "Colaboradores Registrados" con su nombre, usuario y badge de rol.
- Admin podrá restablecerles la contraseña para reactivar la visibilidad cifrada (si aprobamos el paso 4).

# Archivos a tocar

- `supabase/migrations/<nuevo>.sql` — recrear trigger.
- Data fix vía `supabase--insert` — backfill de los 2 profiles.
- `supabase/functions/create-user/index.ts` — upsert defensivo + rollback.
- (Opcional) `supabase/functions/reset-user-password/index.ts` + botón en `src/pages/UsersPage.tsx`.

¿Incluyo el paso 4 (reset de contraseña) o lo dejamos para después?
