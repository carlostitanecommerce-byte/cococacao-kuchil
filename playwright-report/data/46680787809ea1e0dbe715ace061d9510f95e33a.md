# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: coworking.spec.ts >> Flujo de Coworking >> Apertura de sesión de coworking y cobro
- Location: e2e\coworking.spec.ts:12:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/dashboard*" until "load"
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
            - text: admin
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
  3  | test.describe('Flujo de Coworking', () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     await page.goto('/login');
  6  |     await page.fill('input#username', 'admin');
  7  |     await page.fill('input#password', 'password123'); // Cambiar por credenciales válidas en test
  8  |     await page.click('button[type="submit"]');
> 9  |     await page.waitForURL('**/dashboard*', { timeout: 15000 });
     |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  10 |   });
  11 | 
  12 |   test('Apertura de sesión de coworking y cobro', async ({ page }) => {
  13 |     await page.goto('/coworking');
  14 | 
  15 |     // Asumimos que hay un botón de "Nueva Sesión"
  16 |     const btnNuevaSesion = page.getByRole('button', { name: /Nueva Sesión/i });
  17 |     if (await btnNuevaSesion.isVisible()) {
  18 |       await btnNuevaSesion.click();
  19 | 
  20 |       // Llenar datos de sesión
  21 |       await page.fill('input[placeholder*="Nombre"]', 'Cliente Coworking E2E');
  22 |       await page.click('button:has-text("Iniciar sesión")');
  23 | 
  24 |       // Verificar que la sesión se haya creado
  25 |       await expect(page.getByText('Cliente Coworking E2E')).toBeVisible();
  26 | 
  27 |       // Flujo de cierre (click en la sesión y luego en cobrar)
  28 |       // await page.click('text="Cliente Coworking E2E"');
  29 |       // await page.click('button:has-text("Cerrar cuenta")');
  30 |       // await expect(page.getByText('Cobrar')).toBeVisible();
  31 |     } else {
  32 |       console.log('No hay botón de Nueva Sesión visible.');
  33 |     }
  34 |   });
  35 | });
  36 | 
```