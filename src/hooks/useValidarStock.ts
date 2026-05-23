import { supabase } from '@/integrations/supabase/client';

interface ValidacionStock {
  valido: boolean;
  error?: string;
  /** True si la causa fue un fallo de red/servidor, no una regla de negocio. */
  networkError?: boolean;
}

const RETRY_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Verifica stock disponible para un producto.
 * - Diferencia error de red (con un reintento corto) de error de negocio.
 * - Devuelve un mensaje claro en cada caso.
 */
export async function verificarStock(productoId: string, cantidad: number): Promise<ValidacionStock> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc('validar_stock_disponible', {
      p_producto_id: productoId,
      p_cantidad: cantidad,
    });

    if (error) {
      // Reintento único ante posible error transitorio de red
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      console.error('Error validando stock:', error);
      return {
        valido: false,
        networkError: true,
        error: 'Sin conexión con el servidor al validar stock. Intenta de nuevo.',
      };
    }

    return (data as unknown as ValidacionStock) ?? {
      valido: false,
      error: 'Respuesta vacía del validador de stock',
    };
  }
  return { valido: false, networkError: true, error: 'No se pudo validar stock.' };
}
