## Diagnóstico

Al pedir el HTML de `https://cococacao-kuchil.lovable.app` el servidor devuelve esto:

```html
<!DOCTYPE html><html lang="en">
  <body>
    <div id="root"></div>
  </body></html>
```

No hay `<head>`, no hay `<title>`, y lo más importante: **no hay `<script type="module" src="/assets/index-*.js">`**. Sin ese script, React nunca arranca y queda una pantalla blanca. Es exactamente el síntoma que ves.

En cambio, el `index.html` del repositorio está correcto (head completo + `<script type="module" src="/src/main.tsx">`) y la preview interna de Lovable funciona porque sirve el código actual del sandbox vía Vite, no el build publicado.

## Causa

El bundle publicado en `cococacao-kuchil.lovable.app` está desactualizado / corrupto: corresponde a un deploy donde el `index.html` final no incluyó los assets compilados. Los cambios recientes (correcciones de secretos, imports a Supabase, etc.) no se han re-publicado, así que el dominio sigue sirviendo ese HTML roto.

No es un bug del código fuente — el código actual compila bien y la preview lo demuestra. Es un problema de deploy.

## Plan de corrección

1. Abrir el diálogo **Publish** (botón arriba a la derecha en el editor de Lovable).
2. Pulsar **Update** para regenerar el build y subirlo al dominio `cococacao-kuchil.lovable.app`.
3. Esperar ~30–60s a que termine el deploy.
4. Recargar `https://cococacao-kuchil.lovable.app` con cache limpio (Cmd/Ctrl+Shift+R). Debe aparecer la pantalla de login de Coco & Cacao.
5. Si tras republicar el HTML servido sigue sin incluir el `<script type="module" …>` en `<head>`, entonces sí es un incidente del hosting de Lovable y habría que reportarlo a soporte con la URL — pero lo normal es que el Update lo resuelva.

## Notas

- No hay cambios de código que hacer: el `index.html`, `main.tsx` y `vite.config.ts` están correctos.
- Los cambios de frontend en Lovable **no salen a producción automáticamente**; requieren pulsar Update en el diálogo de Publish. Los cambios de backend (edge functions, migraciones) sí se despliegan solos, por eso la base de datos ya tiene los datos que importamos aunque el front publicado esté roto.
