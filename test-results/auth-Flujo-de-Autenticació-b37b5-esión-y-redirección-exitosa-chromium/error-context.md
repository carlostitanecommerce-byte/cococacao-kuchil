# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Flujo de Autenticación >> Inicio de sesión y redirección exitosa
- Location: e2e\auth.spec.ts:4:3

# Error details

```
Error: expect(page).not.toHaveURL(expected) failed

Expected pattern: not /.*login/
Received string: "http://localhost:8080/login"
Timeout: 10000ms

Call log:
  - Expect "not toHaveURL" with timeout 10000ms
    23 × unexpected value "http://localhost:8080/login"

```

```yaml
- region "Notifications (F8)":
  - list
- region "Notifications alt+T"
- img
- heading "Coco & Cacao" [level=1]
- paragraph: + Kúuchil Meyaj
- heading "Iniciar sesión" [level=3]
- paragraph: Ingresa con tus credenciales
- text: Usuario
- textbox "Usuario":
  - /placeholder: tu.usuario
  - text: admin
- text: Contraseña
- textbox "Contraseña":
  - /placeholder: ••••••••
  - text: password123
- paragraph: Usuario o contraseña incorrectos
- button "Iniciar sesión"
- paragraph: Sistema de Punto de Venta — v1.3
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Flujo de Autenticación', () => {
  4  |   test('Inicio de sesión y redirección exitosa', async ({ page }) => {
  5  |     await page.goto('/login');
  6  |     
  7  |     // Verificar que estamos en la página de login
  8  |     await expect(page.getByRole('heading', { name: 'Coco & Cacao' })).toBeVisible();
  9  | 
  10 |     // Rellenar credenciales (se recomienda usar variables de entorno o un test user)
  11 |     await page.fill('input#username', 'admin');
  12 |     await page.fill('input#password', 'password123'); 
  13 |     
  14 |     await page.click('button[type="submit"]');
  15 | 
  16 |     // Debe redirigir al dashboard o ruta principal (dependiendo del rol)
  17 |     // El timeout es un poco más largo en caso de que la API de Supabase tarde
> 18 |     await expect(page).not.toHaveURL(/.*login/, { timeout: 10000 });
     |                            ^ Error: expect(page).not.toHaveURL(expected) failed
  19 |   });
  20 | 
  21 |   test('Muestra error con credenciales incorrectas', async ({ page }) => {
  22 |     await page.goto('/login');
  23 |     
  24 |     await page.fill('input#username', 'usuario.invalido');
  25 |     await page.fill('input#password', 'wrongpassword');
  26 |     await page.click('button[type="submit"]');
  27 | 
  28 |     // Verificar que aparece el mensaje de error
  29 |     await expect(page.locator('p.text-destructive')).toHaveText('Usuario o contraseña incorrectos');
  30 |   });
  31 | });
  32 | 
```