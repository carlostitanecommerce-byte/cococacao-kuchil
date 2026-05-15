import { supabase } from '@/integrations/supabase/client';

export interface KitchenItemInput {
  producto_id: string;
  nombre: string;
  cantidad: number;
  /** True para amenities incluidos (cortesía coworking) */
  isAmenity?: boolean;
  notas?: string | null;
}

export interface KitchenContext {
  sessionId: string;
  clienteNombre: string;
  /** Etiqueta corta de origen mostrada en KDS (ej. "Check-in" o "Add") */
  motivo: 'checkin' | 'add' | 'incremento';
}

/**
 * Crea una orden KDS originada desde una sesión de coworking.
 *
 * - Filtra productos con `requiere_preparacion = false` (no se envían).
 * - Asigna folio propio desde `kds_coworking_folio_seq` (no choca con ventas).
 * - Etiqueta amenities como cortesía y extras pagados con marca de coworking.
 * - Devuelve el id de la orden creada o null si nada se envió.
 */
export async function enviarASesionKDS(params: {
  context: KitchenContext;
  items: KitchenItemInput[];
}): Promise<{ orderId: string | null; folio: number | null; itemsEnviados: number }> {
  const { context, items } = params;
  if (items.length === 0) return { orderId: null, folio: null, itemsEnviados: 0 };

  // Filtrar productos que requieren preparación
  const productIds = [...new Set(items.map(i => i.producto_id))];
  const { data: prods } = await supabase
    .from('productos')
    .select('id, requiere_preparacion')
    .in('id', productIds);

  const preparacionMap = new Map(
    (prods ?? []).map((p: any) => [p.id, p.requiere_preparacion !== false]),
  );

  const itemsParaCocina = items
    .filter(it => preparacionMap.get(it.producto_id) !== false && it.cantidad > 0);

  if (itemsParaCocina.length === 0) {
    return { orderId: null, folio: null, itemsEnviados: 0 };
  }

  // Pedir folio coworking propio
  const { data: folioRes, error: folioErr } = await supabase.rpc(
    'next_kds_coworking_folio' as any,
  );
  if (folioErr || folioRes == null) {
    console.error('Error obteniendo folio KDS coworking:', folioErr);
    return { orderId: null, folio: null, itemsEnviados: 0 };
  }
  const folio = Number(folioRes);

  // Crear orden KDS
  const { data: order, error: orderErr } = await supabase
    .from('kds_orders')
    .insert({
      venta_id: null,
      coworking_session_id: context.sessionId,
      folio,
      tipo_consumo: 'sitio',
      estado: 'pendiente' as any,
    } as any)
    .select('id')
    .single();

  if (orderErr || !order) {
    console.error('Error creando orden KDS coworking:', orderErr);
    return { orderId: null, folio: null, itemsEnviados: 0 };
  }

  // Etiquetado consistente
  const sufijo = `(coworking — ${context.clienteNombre})`;
  const rows = itemsParaCocina.map(it => ({
    kds_order_id: order.id,
    producto_id: it.producto_id,
    nombre_producto: it.isAmenity
      ? `${it.nombre} ☕ ${sufijo}`
      : `${it.nombre} ${sufijo}`,
    cantidad: it.cantidad,
    notas: it.notas ?? null,
  }));

  const { error: itemsErr } = await supabase
    .from('kds_order_items')
    .insert(rows as any);

  if (itemsErr) {
    console.error('Error insertando items KDS coworking:', itemsErr);
    // Limpiar orden vacía
    await supabase.from('kds_orders').delete().eq('id', order.id);
    return { orderId: null, folio: null, itemsEnviados: 0 };
  }

  return { orderId: order.id, folio, itemsEnviados: rows.length };
}
