import { test, expect } from '@playwright/test';

test.describe('Flujo de Punto de Venta (POS)', () => {
  // NOTA: Para que estas pruebas funcionen sin problemas, se recomienda
  // configurar globalSetup en Playwright para guardar el estado de sesión (cookies/tokens)
  // o utilizar un test fixture que haga login automático.
  
  test.beforeEach(async ({ page }) => {
    // Login temporal antes de cada prueba de POS
    await page.goto('/login');
    await page.fill('input#username', 'caja');
    await page.fill('input#password', 'password123'); // Cambiar por credenciales válidas en test
    await page.click('button[type="submit"]');
    await page.waitForURL('**/pos*', { timeout: 15000 });
  });

  test('Permite agregar un producto al carrito y parquear la orden a Caja', async ({ page }) => {
    await page.goto('/pos');

    // 1. Esperamos a que cargue el grid de productos
    // Buscamos un producto por algún texto genérico o test-id. 
    // Aquí asumimos que existe al menos un botón de producto.
    const productButton = page.locator('.grid button').first();
    await expect(productButton).toBeVisible();
    
    // 2. Click para agregar al carrito
    await productButton.click();

    // 3. Verificamos que el botón de Checkout se habilite y diga "Procesar pago en Caja"
    const checkoutBtn = page.getByRole('button', { name: /Procesar pago en Caja/i });
    await expect(checkoutBtn).toBeEnabled();

    // 4. Click en checkout para abrir el dialog de "Enviar a Caja"
    await checkoutBtn.click();

    // 5. Verificamos que el dialog aparezca
    const dialogTitle = page.getByRole('heading', { name: /Enviar orden a Caja/i });
    await expect(dialogTitle).toBeVisible();

    // 6. Llenamos referencia del cliente
    await page.fill('input#cliente-ref', 'Cliente E2E Test');
    
    // 7. Click en enviar a caja
    await page.getByRole('button', { name: 'Enviar a Caja' }).click();

    // 8. Verificamos que se parquéo la orden y redirigió a caja
    await expect(page).toHaveURL(/.*caja/, { timeout: 10000 });
  });
});
