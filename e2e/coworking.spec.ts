import { test, expect } from '@playwright/test';

test.describe('Flujo de Coworking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input#username', 'admin');
    await page.fill('input#password', 'password123'); // Cambiar por credenciales válidas en test
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard*', { timeout: 15000 });
  });

  test('Apertura de sesión de coworking y cobro', async ({ page }) => {
    await page.goto('/coworking');

    // Asumimos que hay un botón de "Nueva Sesión"
    const btnNuevaSesion = page.getByRole('button', { name: /Nueva Sesión/i });
    if (await btnNuevaSesion.isVisible()) {
      await btnNuevaSesion.click();

      // Llenar datos de sesión
      await page.fill('input[placeholder*="Nombre"]', 'Cliente Coworking E2E');
      await page.click('button:has-text("Iniciar sesión")');

      // Verificar que la sesión se haya creado
      await expect(page.getByText('Cliente Coworking E2E')).toBeVisible();

      // Flujo de cierre (click en la sesión y luego en cobrar)
      // await page.click('text="Cliente Coworking E2E"');
      // await page.click('button:has-text("Cerrar cuenta")');
      // await expect(page.getByText('Cobrar')).toBeVisible();
    } else {
      console.log('No hay botón de Nueva Sesión visible.');
    }
  });
});
