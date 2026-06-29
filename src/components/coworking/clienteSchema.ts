import { z } from 'zod';

/**
 * Schema usado por el Directorio: teléfono y email son opcionales,
 * pero si se proveen deben cumplir el formato (10 dígitos / email válido).
 */
export const clienteSchema = z.object({
  nombre_completo: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(120, 'Máximo 120 caracteres'),
  telefono: z
    .string()
    .trim()
    .max(20, 'Máximo 20 caracteres')
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || v.replace(/\D/g, '').length === 10,
      'El teléfono debe tener 10 dígitos',
    ),
  email: z
    .string()
    .trim()
    .max(255, 'Máximo 255 caracteres')
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'El email debe incluir una @ válida',
    ),
});

/**
 * Schema para creación rápida desde ClienteSelector: nombre, teléfono y
 * email son obligatorios para asegurar que el directorio quede completo.
 */
export const clienteRequiredSchema = z.object({
  nombre_completo: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(120, 'Máximo 120 caracteres'),
  telefono: z
    .string()
    .trim()
    .min(1, 'El teléfono es obligatorio')
    .refine(
      (v) => v.replace(/\D/g, '').length === 10,
      'El teléfono debe tener 10 dígitos',
    ),
  email: z
    .string()
    .trim()
    .min(1, 'El email es obligatorio')
    .max(255, 'Máximo 255 caracteres')
    .refine(
      (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'El email debe incluir una @ válida',
    ),
});
