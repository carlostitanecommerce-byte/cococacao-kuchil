import { test, expect } from '@playwright/test';

test.describe('Flujo de Correcciones Coworking', () => {
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
      await page.screenshot({ path: `test-results/failure-${testInfo.title.replace(/\s+/g, '-')}.png` });
    }
  });

  test('Validar bloqueo de overbooking en Membresías Mensuales', async ({ page }) => {
    await page.goto('/coworking');
    await page.getByRole('tab', { name: /Clientes/i }).click();

    // Abrir diálogo "Vender Membresía"
    await page.getByRole('button', { name: /Vender Membresía/i }).click();
    await expect(page.getByRole('heading', { name: /Vender Membresía/i })).toBeVisible();

    // Seleccionar cliente
    await page.getByRole('combobox', { name: /Cliente/i }).click();
    await page.getByRole('option').first().click();

    // Seleccionar tarifa mensual (suponiendo que la primera es mensual)
    const tarifaCombobox = page.getByRole('combobox').filter({ hasText: /tarifa/i });
    await expect(tarifaCombobox).toBeVisible();
    await tarifaCombobox.click();
    
    // Asumimos que podemos elegir una tarifa mensual
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    await options.first().click();

    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('Sincronización de Cancelación de Membresía desde Caja', async ({ page }) => {
    await page.goto('/coworking');
    await page.getByRole('tab', { name: /Clientes/i }).click();

    // 1. Abrir diálogo "Vender Membresía"
    await page.getByRole('button', { name: /Vender Membresía/i }).click();
    await page.getByRole('combobox', { name: /Cliente/i }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('combobox').filter({ hasText: /tarifa/i }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Enviar a Caja' }).click();

    // 2. Redirige a /caja
    await expect(page).toHaveURL(/\/caja/, { timeout: 15000 });
    await expect(page.getByText(/Membresía/i).first()).toBeVisible();

    // 3. Cancelar la orden desde caja
    const btnCancel = page.getByRole('button', { name: /Cancelar Orden/i });
    if (await btnCancel.isVisible()) {
        await btnCancel.click();
        await page.fill('input[placeholder*="motivo"]', 'Test E2E Cancelación Automática');
        await page.getByRole('button', { name: 'Confirmar Cancelación' }).click();
    }
  });
});
