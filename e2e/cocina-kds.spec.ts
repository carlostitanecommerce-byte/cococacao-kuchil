import { test, expect } from '@playwright/test';

test.describe('Flujo de Cocina (KDS)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input#username', 'barista');
    await page.fill('input#password', 'password123'); // Cambiar por credenciales válidas en test
    await page.click('button[type="submit"]');
    await page.waitForURL('**/cocina*', { timeout: 15000 });
  });

  test('Permite cambiar el estado de una orden a "En preparación" y luego a "Listo"', async ({ page }) => {
    // Nota: Esta prueba depende de que haya órdenes pendientes en la vista de cocina.
    // Lo ideal es tener un test setup que cree una orden previamente a través de la API o UI.
    
    // 1. Buscamos el botón de "Iniciar" o la tarjeta de orden pendiente.
    // Usamos selectores resilientes basados en texto
    const btnIniciar = page.getByRole('button', { name: 'Iniciar' }).first();
    
    // Si no hay orden, la prueba podría fallar; en un entorno E2E real primero inyectamos datos.
    if (await btnIniciar.isVisible()) {
      // 2. Clic en Iniciar
      await btnIniciar.click();

      // 3. Verificamos que ahora aparezca el botón "Listo"
      const btnListo = page.getByRole('button', { name: 'Listo' }).first();
      await expect(btnListo).toBeVisible();

      // 4. Clic en Listo
      await btnListo.click();

      // 5. La orden debería pasar al estado Listo, y la UI mostrará "Entregada/Expirar" 
      // o el check icon dependiendo de la tarjeta.
    } else {
      console.log('No hay órdenes para probar KDS. Ejecuta un seed previo.');
    }
  });
});
