## Diagnóstico

El error nuevo confirma una causa distinta a la primera pantalla blanca:

```text
Uncaught Error: supabaseUrl is required.
```

Eso ocurre cuando el build publicado ejecuta el cliente de backend con `VITE_SUPABASE_URL` vacío/undefined. La preview interna sí funciona porque ahí el entorno de desarrollo sí tiene esas variables; el dominio publicado está usando un build donde las variables de Lovable Cloud no quedaron inyectadas correctamente.

## Objetivo

1. Recuperar el app publicado para que cargue normalmente.
2. Evitar que futuros builds se publiquen “rotos” y terminen en pantalla blanca.
3. Mantener la integración de Lovable Cloud segura, sin tocar archivos autogenerados ni guardar llaves privadas en código.

## Plan de resolución

### 1. Validación profesional en tiempo de build

Agregar una validación en `vite.config.ts` para producción que revise estas variables antes de compilar:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

Si falta alguna, el build debe fallar con un error claro, por ejemplo:

```text
Missing Lovable Cloud build environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
```

Así no vuelve a generarse un deploy aparentemente exitoso pero inutilizable.

### 2. Pantalla de error controlada en runtime

Modificar `src/main.tsx` para hacer una verificación temprana antes de importar el resto del app.

Actualmente `App.tsx` importa módulos que usan el cliente de backend, y si falta `VITE_SUPABASE_URL`, React ni siquiera alcanza a renderizar. La solución será cargar `App` de forma diferida solo después de confirmar que el entorno existe.

Si el entorno está incompleto, se mostrará una pantalla controlada con un mensaje claro de configuración, no una pantalla blanca.

### 3. No tocar archivos autogenerados

No se modificará:

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `.env`

Estos archivos son administrados automáticamente por Lovable Cloud.

### 4. Recuperar el deploy publicado

Después del cambio, hay que regenerar el build publicado con **Publish → Update**.

Resultado esperado:

- Si Lovable Cloud ya entrega bien las variables al build: el app carga normalmente.
- Si el entorno de publicación sigue roto: el build falla con un error claro antes de publicar, en lugar de subir una pantalla blanca.

En ese segundo caso, el siguiente paso correcto sería refrescar/revisar la conexión de Lovable Cloud desde el proyecto y volver a publicar.

### 5. Verificación final

Después de republicar, validaré:

- Que el dominio publicado ya no arroje `supabaseUrl is required`.
- Que el HTML publicado incluya el bundle correcto.
- Que `/login` renderice la pantalla de inicio de sesión.
- Que una recarga limpia del navegador no deje la app en blanco.

## Archivos a cambiar

- `vite.config.ts` — validación de variables requeridas en producción.
- `src/main.tsx` — arranque defensivo para evitar pantalla blanca si falta configuración.

## Resultado esperado

El app dejará de fallar silenciosamente en blanco. Si la configuración de publicación vuelve a romperse, el problema quedará bloqueado antes del deploy o mostrado con un mensaje claro en pantalla, permitiendo corregirlo sin afectar operación.