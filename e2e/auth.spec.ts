import { test, expect } from '@playwright/test';

test.describe('Flujo de Autenticación', () => {
  test('Inicio de sesión y redirección exitosa', async ({ page }) => {
    await page.goto('/login');
    
    // Verificar que estamos en la página de login
    await expect(page.getByRole('heading', { name: 'Coco & Cacao' })).toBeVisible();

    // Rellenar credenciales (se recomienda usar variables de entorno o un test user)
    await page.fill('input#username', 'admin');
    await page.fill('input#password', 'password123'); 
    
    await page.click('button[type="submit"]');

    // Debe redirigir al dashboard o ruta principal (dependiendo del rol)
    // El timeout es un poco más largo en caso de que la API de Supabase tarde
    await expect(page).not.toHaveURL(/.*login/, { timeout: 10000 });
  });

  test('Muestra error con credenciales incorrectas', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input#username', 'usuario.invalido');
    await page.fill('input#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Verificar que aparece el mensaje de error
    await expect(page.locator('p.text-destructive')).toHaveText('Usuario o contraseña incorrectos');
  });
});
