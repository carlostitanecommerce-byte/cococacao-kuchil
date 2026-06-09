# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pos-flow.spec.ts >> Flujo de Punto de Venta (POS) >> Permite agregar un producto al carrito y parquear la orden a Caja
- Location: e2e\pos-flow.spec.ts:17:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/pos*" until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications (F8)":
    - list
  - region "Notifications alt+T"
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img [ref=e7]
      - heading "Coco & Cacao" [level=1] [ref=e9]
      - paragraph [ref=e10]: + Kúuchil Meyaj
    - generic [ref=e11]:
      - generic [ref=e12]:
        - heading "Iniciar sesión" [level=3] [ref=e13]
        - paragraph [ref=e14]: Ingresa con tus credenciales
      - generic [ref=e16]:
        - generic [ref=e17]:
          - text: Usuario
          - textbox "Usuario" [ref=e18]:
            - /placeholder: tu.usuario
            - text: caja
        - generic [ref=e19]:
          - text: Contraseña
          - textbox "Contraseña" [ref=e20]:
            - /placeholder: ••••••••
            - text: password123
        - paragraph [ref=e21]: Usuario o contraseña incorrectos
        - button "Iniciar sesión" [ref=e22] [cursor=pointer]
    - paragraph [ref=e23]: Sistema de Punto de Venta — v1.3
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Flujo de Punto de Venta (POS)', () => {
  4  |   // NOTA: Para que estas pruebas funcionen sin problemas, se recomienda
  5  |   // configurar globalSetup en Playwright para guardar el estado de sesión (cookies/tokens)
  6  |   // o utilizar un test fixture que haga login automático.
  7  |   
  8  |   test.beforeEach(async ({ page }) => {
  9  |     // Login temporal antes de cada prueba de POS
  10 |     await page.goto('/login');
  11 |     await page.fill('input#username', 'caja');
  12 |     await page.fill('input#password', 'password123'); // Cambiar por credenciales válidas en test
  13 |     await page.click('button[type="submit"]');
> 14 |     await page.waitForURL('**/pos*', { timeout: 15000 });
     |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  15 |   });
  16 | 
  17 |   test('Permite agregar un producto al carrito y parquear la orden a Caja', async ({ page }) => {
  18 |     await page.goto('/pos');
  19 | 
  20 |     // 1. Esperamos a que cargue el grid de productos
  21 |     // Buscamos un producto por algún texto genérico o test-id. 
  22 |     // Aquí asumimos que existe al menos un botón de producto.
  23 |     const productButton = page.locator('.grid button').first();
  24 |     await expect(productButton).toBeVisible();
  25 |     
  26 |     // 2. Click para agregar al carrito
  27 |     await productButton.click();
  28 | 
  29 |     // 3. Verificamos que el botón de Checkout se habilite y diga "Procesar pago en Caja"
  30 |     const checkoutBtn = page.getByRole('button', { name: /Procesar pago en Caja/i });
  31 |     await expect(checkoutBtn).toBeEnabled();
  32 | 
  33 |     // 4. Click en checkout para abrir el dialog de "Enviar a Caja"
  34 |     await checkoutBtn.click();
  35 | 
  36 |     // 5. Verificamos que el dialog aparezca
  37 |     const dialogTitle = page.getByRole('heading', { name: /Enviar orden a Caja/i });
  38 |     await expect(dialogTitle).toBeVisible();
  39 | 
  40 |     // 6. Llenamos referencia del cliente
  41 |     await page.fill('input#cliente-ref', 'Cliente E2E Test');
  42 |     
  43 |     // 7. Click en enviar a caja
  44 |     await page.getByRole('button', { name: 'Enviar a Caja' }).click();
  45 | 
  46 |     // 8. Verificamos que se parquéo la orden y redirigió a caja
  47 |     await expect(page).toHaveURL(/.*caja/, { timeout: 10000 });
  48 |   });
  49 | });
  50 | 
```