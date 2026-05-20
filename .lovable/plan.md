
# Auditoría y solución definitiva: pantalla "Configuración incompleta" en producción

## Diagnóstico (causa raíz)

1. `src/integrations/supabase/client.ts` (auto-generado, no editable) crea el cliente con `import.meta.env.VITE_SUPABASE_URL` e `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`. Vite **inlinea** esas variables en el bundle **en tiempo de build**.
2. Esos valores viven en `.env`, que está listado en `.gitignore` (líneas 26-28). En la previsualización Lovable inyecta `.env` en el sandbox, por eso funciona. En el pipeline de publicación a `cococacao-kuchil.lovable.app` el `.env` no siempre llega, así que Vite reemplaza las variables por `undefined` y el bundle queda con `createClient(undefined, undefined, …)` → error `supabaseUrl is required` → pantalla blanca.
3. El parche actual en `src/main.tsx` solo cambia la pantalla blanca por la tarjeta "Configuración incompleta", pero no resuelve la raíz: el build sigue saliendo sin credenciales.
4. No podemos editar `.gitignore` (Lovable lo bloquea) ni `src/integrations/supabase/client.ts` (auto-generado).

## Solución profesional

Inyectar los valores **públicos** (URL del proyecto, anon key y project ID son publicables — los maneja el navegador) como **defaults a nivel de build** desde `vite.config.ts`, usando la opción `define` de Vite. Así:

- En desarrollo y en el sandbox de Lovable, si existe `.env`, esos valores tienen prioridad (comportamiento actual sin cambios).
- En el build publicado, si Lovable no entrega `.env`, Vite usa los valores hardcoded de respaldo y el bundle siempre arranca.
- `src/integrations/supabase/client.ts` no se toca; sigue leyendo `import.meta.env.VITE_SUPABASE_URL` como antes.
- La pantalla defensiva de `src/main.tsx` se conserva como red de seguridad, pero ya no debería activarse.

Los valores que se embeben son los mismos que ya están expuestos al navegador (anon key con RLS activa), no se filtra ningún secreto.

## Cambios concretos

### 1. `vite.config.ts`
Calcular un objeto `defines` con las tres variables `VITE_SUPABASE_*`:
- Prioridad: `process.env[KEY]` → `env[KEY]` (de `loadEnv`) → fallback hardcoded del proyecto Lovable Cloud actual.
- Pasarlo a Vite vía `define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(...), ... }`.
- Quitar el `console.warn` actual (ya no aplica, siempre habrá valor).

Fallbacks que se incluyen:
```text
VITE_SUPABASE_URL            = https://zidlmhqzyffrrsqhdfib.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = (anon JWT del proyecto, ya público)
VITE_SUPABASE_PROJECT_ID     = zidlmhqzyffrrsqhdfib
```

### 2. `src/main.tsx`
Conservar la validación defensiva y la pantalla de error como salvaguarda; no requiere cambios funcionales.

### 3. Sin tocar
- `src/integrations/supabase/client.ts` (auto-generado).
- `src/integrations/supabase/types.ts`.
- `.env`, `.gitignore`, `supabase/config.toml`.
- Edge functions (usan `Deno.env`, ya funcionan con secretos del proyecto).

## Verificación post-cambio

1. Publicar (Publish → Update) para regenerar el bundle.
2. Abrir `https://cococacao-kuchil.lovable.app/login` en una ventana de incógnito:
   - Debe cargar el login normalmente.
   - Consola sin `supabaseUrl is required`.
   - Network: la primera petición a `https://zidlmhqzyffrrsqhdfib.supabase.co/auth/v1/...` debe responder 200/401 (no error de URL).
3. Probar login con cuenta válida y navegar a una ruta protegida para confirmar sesión.

## Por qué no volverá a ocurrir

- El bundle ya no depende de variables externas en tiempo de publicación: los valores quedan embebidos como literales por Vite.
- Cualquier futura regeneración de `client.ts` mantiene la misma firma (`import.meta.env.VITE_SUPABASE_URL`), que ahora Vite siempre puede resolver.
- Si en el futuro se migra a otro proyecto de Lovable Cloud, basta actualizar los tres literales del `define` (o seguir usando `.env`, que sigue teniendo prioridad).
