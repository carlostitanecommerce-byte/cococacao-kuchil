import { test, expect } from '@playwright/test';

test.describe('Flujo de venta de Membresía Coworking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input#username', 'admin');
    await page.fill('input#password', 'password123'); // Credenciales de test
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard*', { timeout: 15000 });
  });

  test('Vender membresía → cobrar en Caja → membresía queda activa', async ({ page }) => {
    await page.goto('/coworking');

    // 1. Abrir diálogo "Vender Membresía"
    await page.getByRole('button', { name: /Vender Membresía/i }).click();
    await expect(page.getByRole('heading', { name: /Vender Membresía/i })).toBeVisible();

    // 2. Seleccionar cliente (abre el combobox y elige el primero)
    await page.getByRole('combobox', { name: /Cliente/i }).click();
    await page.getByRole('option').first().click();

    // 3. Seleccionar primera tarifa disponible (mes / paquete_horas)
    await page.getByRole('combobox').filter({ hasText: /tarifa/i }).click();
    await page.getByRole('option').first().click();

    // 4. Enviar a Caja
    await page.getByRole('button', { name: 'Enviar a Caja' }).click();

    // 5. Redirige a /caja con la orden auto-importada
    await expect(page).toHaveURL(/\/caja\?auto_import_orden=/, { timeout: 15000 });

    // 6. La línea de membresía aparece en el ticket, marcada como Coworking
    await expect(page.getByText(/Membresía/i).first()).toBeVisible();
    await expect(page.getByText('Coworking').first()).toBeVisible();

    // 7. Cobrar en efectivo y confirmar
    await page.getByRole('button', { name: /Cobrar/i }).click();
    await page.getByRole('button', { name: /Confirmar/i }).click();

    // 8. Toast de éxito confirmando activación de la membresía
    await expect(page.getByText(/Membresía activada/i)).toBeVisible({ timeout: 10000 });
  });
});
