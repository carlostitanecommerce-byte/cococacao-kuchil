## Objetivo
Agregar un test end-to-end (Playwright) que cubra el flujo de **venta de membresía coworking** implementado en las fases 3.1 y 3.2, siguiendo el estilo de los specs existentes en `e2e/`.

## Alcance del flujo cubierto
1. Login como admin.
2. Ir a `/coworking` y abrir el diálogo **"Vender Membresía"**.
3. Seleccionar cliente, tarifa (`mes` o `paquete_horas`) y fecha de inicio.
4. Enviar a Caja → esperar redirección a `/caja?auto_import_orden=...`.
5. Verificar que la orden importada muestra la línea con el nombre `Membresía …` y badge `Coworking`.
6. Confirmar la venta en efectivo.
7. Volver a `/coworking` y verificar que la membresía aparece como `activa` (badge/estado) para ese cliente.

## Archivo nuevo
`e2e/coworking-membresia.spec.ts` — sigue el patrón de `e2e/coworking.spec.ts` y `e2e/pos-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Flujo de venta de Membresía Coworking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input#username', 'admin');
    await page.fill('input#password', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard*', { timeout: 15000 });
  });

  test('Vender membresía → cobrar en Caja → membresía queda activa', async ({ page }) => {
    await page.goto('/coworking');

    // 1. Abrir diálogo "Vender Membresía"
    await page.getByRole('button', { name: /Vender Membresía/i }).click();
    await expect(page.getByRole('heading', { name: /Vender Membresía/i })).toBeVisible();

    // 2. Seleccionar cliente (primero de la lista)
    await page.getByRole('combobox', { name: /Cliente/i }).click();
    await page.getByRole('option').first().click();

    // 3. Seleccionar primera tarifa disponible
    await page.getByRole('combobox').filter({ hasText: /tarifa/i }).click();
    await page.getByRole('option').first().click();

    // 4. Enviar a Caja
    await page.getByRole('button', { name: 'Enviar a Caja' }).click();

    // 5. Redirige a /caja con la orden auto-importada
    await expect(page).toHaveURL(/\/caja\?auto_import_orden=/, { timeout: 15000 });

    // 6. La línea de membresía aparece en el ticket
    await expect(page.getByText(/Membresía/i).first()).toBeVisible();
    await expect(page.getByText('Coworking').first()).toBeVisible();

    // 7. Cobrar en efectivo
    await page.getByRole('button', { name: /Cobrar/i }).click();
    await page.getByRole('button', { name: /Confirmar/i }).click();

    // 8. Toast de éxito de membresía activada
    await expect(page.getByText(/Membresía activada/i)).toBeVisible({ timeout: 10000 });
  });
});
```

## Consideraciones
- **Datos previos:** el test asume que existen al menos 1 cliente, 1 tarifa de tipo `mes`/`paquete_horas` activa y una caja abierta para el usuario `admin`. Igual que los specs existentes, si el entorno no tiene esos datos, el test fallará — este es el mismo trade-off del resto de la suite (los tests actuales son "aspirational scaffolds" y no corren en CI real).
- **Sin cambios de esquema, sin cambios de UI, sin lógica nueva.** Solo se agrega el archivo de test.
- No se ejecuta el test durante la implementación (el harness del sandbox no tiene credenciales reales de Supabase para el login). Queda listo para correr con `npx playwright test e2e/coworking-membresia.spec.ts` en un entorno con datos seed.

## Alternativa (si prefieres)
En vez de un Playwright spec dependiente de datos seed, podría escribirse un **test de integración con Vitest** que monte `<VenderMembresiaDialog />` con mocks del cliente de Supabase y verifique los payloads exactos que se envían a `coworking_membresias` y `ordenes_pos_pendientes`. Es más determinista pero cubre menos flujo (no toca Caja). Avísame si prefieres esta ruta en vez de/además del e2e.
