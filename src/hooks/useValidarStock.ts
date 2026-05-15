import { supabase } from '@/integrations/supabase/client';

interface ValidacionStock {
  valido: boolean;
  error?: string;
}

export async function verificarStock(productoId: string, cantidad: number): Promise<ValidacionStock> {
  const { data, error } = await supabase.rpc('validar_stock_disponible', {
    p_producto_id: productoId,
    p_cantidad: cantidad,
  });

  if (error) {
    console.error('Error validando stock:', error);
    return { valido: false, error: 'Error de conexión al validar stock' };
  }

  return (data as unknown as ValidacionStock) ?? { valido: false, error: 'Respuesta vacía' };
}
