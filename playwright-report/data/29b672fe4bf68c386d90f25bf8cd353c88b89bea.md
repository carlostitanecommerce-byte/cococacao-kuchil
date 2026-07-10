# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: coworking-membresia.spec.ts >> Flujo de venta de Membresía Coworking >> Vender membresía → cobrar en Caja → membresía queda activa
- Location: e2e\coworking-membresia.spec.ts:12:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: page.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('input#username')

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Flujo de venta de Membresía Coworking', () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     await page.goto('/login');
> 6  |     await page.fill('input#username', 'admin');
     |                ^ Error: page.fill: Test timeout of 30000ms exceeded.
  7  |     await page.fill('input#password', 'password123'); // Credenciales de test
  8  |     await page.click('button[type="submit"]');
  9  |     await page.waitForURL('**/dashboard*', { timeout: 15000 });
  10 |   });
  11 | 
  12 |   test('Vender membresía → cobrar en Caja → membresía queda activa', async ({ page }) => {
  13 |     await page.goto('/coworking');
  14 | 
  15 |     // 1. Abrir diálogo "Vender Membresía"
  16 |     await page.getByRole('button', { name: /Vender Membresía/i }).click();
  17 |     await expect(page.getByRole('heading', { name: /Vender Membresía/i })).toBeVisible();
  18 | 
  19 |     // 2. Seleccionar cliente (abre el combobox y elige el primero)
  20 |     await page.getByRole('combobox', { name: /Cliente/i }).click();
  21 |     await page.getByRole('option').first().click();
  22 | 
  23 |     // 3. Seleccionar primera tarifa disponible (mes / paquete_horas)
  24 |     await page.getByRole('combobox').filter({ hasText: /tarifa/i }).click();
  25 |     await page.getByRole('option').first().click();
  26 | 
  27 |     // 4. Enviar a Caja
  28 |     await page.getByRole('button', { name: 'Enviar a Caja' }).click();
  29 | 
  30 |     // 5. Redirige a /caja con la orden auto-importada
  31 |     await expect(page).toHaveURL(/\/caja\?auto_import_orden=/, { timeout: 15000 });
  32 | 
  33 |     // 6. La línea de membresía aparece en el ticket, marcada como Coworking
  34 |     await expect(page.getByText(/Membresía/i).first()).toBeVisible();
  35 |     await expect(page.getByText('Coworking').first()).toBeVisible();
  36 | 
  37 |     // 7. Cobrar en efectivo y confirmar
  38 |     await page.getByRole('button', { name: /Cobrar/i }).click();
  39 |     await page.getByRole('button', { name: /Confirmar/i }).click();
  40 | 
  41 |     // 8. Toast de éxito confirmando activación de la membresía
  42 |     await expect(page.getByText(/Membresía activada/i)).toBeVisible({ timeout: 10000 });
  43 |   });
  44 | });
  45 | 
```