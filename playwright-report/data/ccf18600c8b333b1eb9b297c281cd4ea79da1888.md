# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cocina-kds.spec.ts >> Flujo de Cocina (KDS) >> Permite cambiar el estado de una orden a "En preparación" y luego a "Listo"
- Location: e2e\cocina-kds.spec.ts:12:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/cocina*" until "load"
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
            - text: barista
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
  3  | test.describe('Flujo de Cocina (KDS)', () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     await page.goto('/login');
  6  |     await page.fill('input#username', 'barista');
  7  |     await page.fill('input#password', 'password123'); // Cambiar por credenciales válidas en test
  8  |     await page.click('button[type="submit"]');
> 9  |     await page.waitForURL('**/cocina*', { timeout: 15000 });
     |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  10 |   });
  11 | 
  12 |   test('Permite cambiar el estado de una orden a "En preparación" y luego a "Listo"', async ({ page }) => {
  13 |     // Nota: Esta prueba depende de que haya órdenes pendientes en la vista de cocina.
  14 |     // Lo ideal es tener un test setup que cree una orden previamente a través de la API o UI.
  15 |     
  16 |     // 1. Buscamos el botón de "Iniciar" o la tarjeta de orden pendiente.
  17 |     // Usamos selectores resilientes basados en texto
  18 |     const btnIniciar = page.getByRole('button', { name: 'Iniciar' }).first();
  19 |     
  20 |     // Si no hay orden, la prueba podría fallar; en un entorno E2E real primero inyectamos datos.
  21 |     if (await btnIniciar.isVisible()) {
  22 |       // 2. Clic en Iniciar
  23 |       await btnIniciar.click();
  24 | 
  25 |       // 3. Verificamos que ahora aparezca el botón "Listo"
  26 |       const btnListo = page.getByRole('button', { name: 'Listo' }).first();
  27 |       await expect(btnListo).toBeVisible();
  28 | 
  29 |       // 4. Clic en Listo
  30 |       await btnListo.click();
  31 | 
  32 |       // 5. La orden debería pasar al estado Listo, y la UI mostrará "Entregada/Expirar" 
  33 |       // o el check icon dependiendo de la tarjeta.
  34 |     } else {
  35 |       console.log('No hay órdenes para probar KDS. Ejecuta un seed previo.');
  36 |     }
  37 |   });
  38 | });
  39 | 
```