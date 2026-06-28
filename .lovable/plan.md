## Objetivo

Reforzar la validación de los campos `telefono` y `email` en el diálogo "Nuevo cliente" / "Editar cliente" del `DirectorioClientesTab`.

## Cambios

En `src/components/coworking/DirectorioClientesTab.tsx`:

1. **Schema `zod`**:
   - `telefono`: opcional; si se llena, debe ser exactamente 10 dígitos. Se acepta entrada con espacios/guiones (`(55) 1234-5678`) pero al validar se eliminan caracteres no numéricos y se exige `length === 10`. El valor guardado en BD será el string original tal cual lo tecleó el usuario.
   - `email`: opcional; si se llena, debe contener `@` y un dominio con punto (regex simple `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), además del límite de 255 chars actual.
   - Mensajes de error específicos en español: "El teléfono debe tener 10 dígitos", "El email debe incluir una @ válida".

2. **UX en el input de teléfono**:
   - `maxLength={15}` para permitir formato con separadores.
   - `inputMode="tel"`.
   - Hint visual debajo del campo: "10 dígitos".

3. **UX en el input de email**:
   - `type="email"` (ya estaba).
   - Hint visual: "Debe incluir @".

4. **Feedback de errores**:
   - Mantener el `toast.error` actual con el primer mensaje del schema (suficiente, no es un formulario complejo).

## Fuera de alcance

- No se cambia la forma en que se guardan los datos (sigue siendo el string tal cual, o `null` si está vacío).
- No se modifica el `ClienteSelector` (diálogo de creación inline) en esta iteración; si lo quieres también, lo agrego después.
