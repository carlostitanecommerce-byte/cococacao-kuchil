import { test, expect } from '@playwright/test';

test.describe('Flujo de venta de Membresía Coworking', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000); // Dar 90 segundos para compilar y cargar módulos en frío
    await page.goto('/login');
    await page.fill('input#username', 'admin');
    await page.fill('input#password', 'Coco2024!'); // Credenciales reales de test
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/.*login/, { timeout: 30000 });
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await page.screenshot({ path: 'test-results/failure-screenshot.png' });
    }
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
    await expect(page.locator('.bg-card').getByText('Coworking').first()).toBeVisible();

    // 7. Cobrar en efectivo y confirmar
    await page.getByRole('button', { name: /Cobrar/i }).click();
    await page.getByRole('button', { name: /Confirmar/i }).click();

    // 7.5 Cerrar el modal del ticket para disparar onSuccess y activar la membresía
    await page.getByRole('button', { name: /Cerrar/i }).click();

    // 8. Toast de éxito confirmando activación de la membresía
    await expect(page.getByText(/Membresía activada/i)).toBeVisible({ timeout: 10000 });
  });
});
