# Fix: limitar edición de pax a áreas privadas + recálculo de amenities por pax

## Contexto

En `ManageSessionAccountDialog` (cuenta de una sesión activa) hay un botón de lápiz junto a `{pax} pax` que abre el editor inline para cambiar `pax_count`. Esto solo tiene sentido para **áreas privadas** (`areas_coworking.es_privado = true`), donde la tarifa cubre todo el espacio y el número de personas dentro puede variar durante la sesión.

En **áreas públicas** la tarifa es **por persona** y el pax queda fijado en el check-in: permitir editarlo aquí abre una vía para alterar la base de cobro y disparar recálculos de amenities incoherentes con la facturación por persona.

Adicionalmente, en áreas privadas las amenities incluidas son **por persona** (ej. 1 agua por pax). Cuando se edita el pax — pasar de 1 a 2, o de 3 a 2 — las amenities deben escalar en consecuencia automáticamente, sin requerir un paso manual.

## Solución

Cambios quirúrgicos, solo en el frontend de presentación + una validación defensiva en el handler. El recálculo de amenities ya existe vía RPC y se reutiliza tal cual.

### 1. UI — gatear el control de edición por `es_privado`

En `src/components/coworking/ManageSessionAccountDialog.tsx`:

- Calcular `const canEditPax = !!sessionArea?.es_privado;` junto a `sessionArea` (línea ~231).
- Mostrar el botón lápiz **y** la rama `isEditingPax` solo cuando `canEditPax` es `true`. En áreas públicas se sigue mostrando `{session.pax_count} pax` (lectura) pero sin el lápiz ni el input.
- En áreas públicas el control simplemente desaparece, consistente con cómo el dashboard ya oculta acciones no disponibles.

### 2. Defensa en `handleSavePax`

Aunque la UI no exponga el botón, blindar el handler para evitar manipulación vía estado local:

```ts
if (!sessionArea?.es_privado) {
  toast({ variant: 'destructive', title: 'No permitido', description: 'Solo las áreas privadas permiten editar el pax.' });
  return;
}
```

Esto bloquea el `update` antes de tocar Supabase.

### 3. Recálculo automático de amenities al cambiar pax (privadas)

Esta lógica **ya existe** en `handleSavePax` + `handleConfirmAmenityRecalc` (RPC `recalcular_amenities_pax`), que ajusta líneas de amenity en la cuenta, crea mermas si hay reducción y envía nuevas amenities al KDS si hay incremento. Se mantiene tal cual y queda restringida implícitamente a privadas porque solo desde privadas se puede llegar al handler.

Pequeño refuerzo de UX: dado que el recálculo es la consecuencia natural (no opcional) en una privada, el diálogo de confirmación `pendingAmenityUpdate` debe presentarse con copy explícito que comunique el ajuste 1:1 por pax, p. ej.:

> "El área es privada y las amenities están ligadas al pax. Se actualizarán de N → M personas:
> • +X agua (al KDS), -Y agua (a merma)…"

Sin cambios funcionales en la RPC ni en la lógica de cálculo — solo el texto del `AlertDialog` para que el operador entienda la causa.

### 4. Validación a nivel BD (defer)

Hoy `coworking_sessions.pax_count` se actualiza con un `update` directo (no RPC), regulado solo por la RLS de "owner o admin". Un trigger que rechace cambios de `pax_count` cuando el área es pública sería el cierre profesional ideal, pero también afectaría flujos legítimos (admin corrigiendo, scripts). **No se incluye**: anotado como mejora futura.

## Validación

1. Check-in en un área **pública** → abrir cuenta → lápiz **no aparece**; solo `N pax` en lectura.
2. Check-in en un área **privada** con 1 pax y tarifa con 1 amenity por persona → editar a 2 pax → confirmar diálogo → la cuenta refleja 2 amenities, el KDS recibe la amenity adicional, no se crean mermas.
3. Misma área privada con 3 pax → editar a 2 pax → confirmar → la cuenta reduce a 2 amenities, se registra 1 merma del amenity sobrante, KDS sin cambios.
4. Resto del diálogo (cobros, agregar al POS, cancelaciones) sin cambios en ambos casos.

## Archivos afectados

```text
~ src/components/coworking/ManageSessionAccountDialog.tsx
```
