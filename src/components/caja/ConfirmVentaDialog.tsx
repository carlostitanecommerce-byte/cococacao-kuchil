import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle2, Printer } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { VentaSummary } from '@/components/pos/types';
import type { Json } from '@/integrations/supabase/types';
import { nowCDMX } from '@/lib/utils';

interface Props {
  summary: VentaSummary | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ConfirmVentaDialog({ summary, onClose, onSuccess }: Props) {
  const { user, profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [ticket, setTicket] = useState<VentaSummary | null>(null);
  const inFlightRef = useRef(false);

  if (!summary && !ticket) return null;

  const handleConfirm = async () => {
    if (!user || !summary) return;
    // Anti doble-clic: lock síncrono que bloquea aunque setState aún no haya hecho re-render
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSaving(true);
    try {
      // 0. Pre-validar inventario unificado vía RPC (considera consumos comprometidos en coworking)
      // Los items con open_account_detalle_id YA existen en detalle_ventas y su stock ya se descontó
      // al crearlos vía registrar_consumo_coworking — no validar ni reinsertar.
      const isOpenItem = (it: typeof summary.items[number]) => !!it.open_account_detalle_id;
      const openItems = summary.items.filter(isOpenItem);
      const newItems = summary.items.filter(it => !isOpenItem(it));

      const qtyByProduct = new Map<string, number>();

      const productoItems = newItems.filter(
        (item) => item.tipo_concepto === 'producto' && !!item.producto_id && !item.producto_id.startsWith('coworking-')
      );
      for (const item of productoItems) {
        const productId = item.producto_id as string;
        qtyByProduct.set(productId, (qtyByProduct.get(productId) ?? 0) + item.cantidad);
      }

      const paqueteItems = newItems.filter(item => item.tipo_concepto === 'paquete');
      // Guardia: cada paquete debe haber expandido sus opciones a componentes con producto_id válido,
      // de lo contrario el trigger descontar_inventario_venta no podría descontar insumos correctamente.
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const pq of paqueteItems) {
        const comps = pq.componentes ?? [];
        if (comps.length === 0 || comps.some(c => !c.producto_id || !uuidRe.test(c.producto_id))) {
          toast.error(`El paquete "${pq.nombre}" no tiene opciones válidas. Vuelve a seleccionarlo.`);
          return;
        }
      }
      for (const pq of paqueteItems) {
        for (const comp of (pq.componentes ?? [])) {
          const totalQty = comp.cantidad * pq.cantidad;
          qtyByProduct.set(comp.producto_id, (qtyByProduct.get(comp.producto_id) ?? 0) + totalQty);
        }
      }

      if (qtyByProduct.size > 0) {
        const cartItems = Array.from(qtyByProduct.entries()).map(([producto_id, cantidad]) => ({
          producto_id,
          cantidad,
        }));
        const { data: validacion, error: valErr } = await supabase.rpc('validar_stock_carrito', {
          p_items: cartItems as any,
        });
        if (valErr) throw valErr;
        const result = validacion as { valido: boolean; error?: string };
        if (!result?.valido) {
          toast.error(result?.error ?? 'Stock insuficiente para completar la venta');
          return;
        }
      }

      // 1. Calcular distribución de pagos (incluye propina)
      // F1: Respetar propina_en_digital. Si el método principal es efectivo
      // pero el cajero marcó la propina como digital, enrutarla a tarjeta.
      // En mixto, la distribución viene completa del usuario (incluye propina);
      // no se vuelve a sumar.
      const propinaAmount = summary.propina || 0;
      const propinaDigital = !!summary.propina_en_digital;

      let montoEfectivo = summary.mixed_payment?.efectivo ?? (summary.metodo_pago === 'efectivo' ? summary.subtotal : 0);
      let montoTarjeta = summary.mixed_payment?.tarjeta ?? (summary.metodo_pago === 'tarjeta' ? summary.subtotal : 0);
      let montoTransferencia = summary.mixed_payment?.transferencia ?? (summary.metodo_pago === 'transferencia' ? summary.subtotal : 0);

      if (summary.metodo_pago !== 'mixto' && propinaAmount > 0) {
        if (summary.metodo_pago === 'tarjeta') {
          montoTarjeta += propinaAmount;
        } else if (summary.metodo_pago === 'transferencia') {
          montoTransferencia += propinaAmount;
        } else if (summary.metodo_pago === 'efectivo') {
          if (propinaDigital) {
            // Propina cobrada por terminal aunque la venta fue en efectivo
            montoTarjeta += propinaAmount;
          } else {
            montoEfectivo += propinaAmount;
          }
        }
      }

      const comisionAmount = summary.comision || 0;

      // 2. Construir detalle_ventas — expandiendo paquetes en componentes
      // Para paquetes: prorrateamos el precio del paquete entre componentes proporcional al costo
      // Para productos simples y coworking/amenity: una línea cada uno
      type DetalleRow = {
        producto_id: string | null;
        cantidad: number;
        precio_unitario: number;
        subtotal: number;
        tipo_concepto: any;
        coworking_session_id: string | null;
        descripcion: string | null;
        paquete_id?: string | null;
        paquete_nombre?: string | null;
      };
      const detalles: DetalleRow[] = [];

      // Cargar costos de componentes (para prorrateo) si hay paquetes
      const componentProductIds = new Set<string>();
      for (const pq of paqueteItems) {
        for (const c of (pq.componentes ?? [])) componentProductIds.add(c.producto_id);
      }
      let costoMap = new Map<string, number>();
      if (componentProductIds.size > 0) {
        const { data: prods } = await supabase
          .from('productos')
          .select('id, costo_total')
          .in('id', Array.from(componentProductIds));
        for (const p of prods ?? []) costoMap.set(p.id, Number(p.costo_total) || 0);
      }

      for (const item of newItems) {
        if (item.tipo_concepto === 'paquete') {
          const pq = item;
          const componentes = pq.componentes ?? [];
          if (componentes.length === 0) continue;

          // Prorrateo proporcional al costo (con fallback a partes iguales si todos los costos = 0)
          const costos = componentes.map(c => (costoMap.get(c.producto_id) ?? 0) * c.cantidad);
          const sumaCostos = costos.reduce((s, c) => s + c, 0);
          const totalPaquete = +(pq.subtotal).toFixed(2);

          let precios: number[];
          if (sumaCostos > 0) {
            precios = costos.map(c => +(totalPaquete * (c / sumaCostos)).toFixed(2));
          } else {
            const equal = +(totalPaquete / componentes.length).toFixed(2);
            precios = componentes.map(() => equal);
          }
          // Ajustar el último componente para cuadrar centavos, evitando negativos
          const sumaPrecios = precios.reduce((s, p) => s + p, 0);
          const diff = +(totalPaquete - sumaPrecios).toFixed(2);
          if (precios.length > 0) {
            const lastIdx = precios.length - 1;
            const adjusted = +(precios[lastIdx] + diff).toFixed(2);
            if (adjusted >= 0) {
              precios[lastIdx] = adjusted;
            } else {
              // Si el ajuste haría negativo el último, distribuir la diferencia entre todos los componentes
              precios[lastIdx] = 0;
              const remainder = +(totalPaquete - precios.reduce((s, p) => s + p, 0)).toFixed(2);
              if (remainder !== 0 && precios.length > 1) {
                // Buscar el componente con mayor precio para absorber el residuo
                let maxIdx = 0;
                for (let i = 1; i < precios.length - 1; i++) if (precios[i] > precios[maxIdx]) maxIdx = i;
                precios[maxIdx] = +Math.max(0, precios[maxIdx] + remainder).toFixed(2);
              }
            }
          }
          // Asegurar que ningún precio quede negativo
          precios = precios.map(v => v < 0 ? 0 : v);

          componentes.forEach((c, idx) => {
            const cantTotal = Math.round(c.cantidad * pq.cantidad);
            const subtotalLinea = precios[idx];
            const precioUnitario = cantTotal > 0 ? +(subtotalLinea / cantTotal).toFixed(4) : 0;
            detalles.push({
              producto_id: c.producto_id,
              cantidad: cantTotal,
              precio_unitario: precioUnitario,
              subtotal: subtotalLinea,
              tipo_concepto: 'producto',
              coworking_session_id: null,
              descripcion: c.nombre,
              paquete_id: pq.paquete_id ?? pq.producto_id,
              paquete_nombre: pq.nombre,
            });
          });
        } else {
          detalles.push({
            producto_id: item.tipo_concepto === 'coworking' ? null : (item.producto_id || null),
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
            subtotal: item.subtotal,
            tipo_concepto: item.tipo_concepto as any,
            coworking_session_id: item.coworking_session_id ?? null,
            descripcion: item.descripcion ?? item.nombre,
          });
        }
      }

      // detalle_ventas.producto_id has FK constraint — strip synthetic coworking IDs
      const realDetalles = detalles.map(d => {
        if (d.producto_id && d.producto_id.startsWith('coworking-')) {
          const { producto_id, ...rest } = d;
          return rest;
        }
        return d;
      });

      // 3. RPC atómica: crea venta + detalles + finaliza coworking + bitácora en una sola transacción
      const numPaquetes = paqueteItems.length;
      const ventaPayload = {
        usuario_id: user.id,
        total_bruto: summary.subtotal,
        iva: summary.iva,
        comisiones_bancarias: comisionAmount,
        monto_propina: propinaAmount,
        total_neto: +(summary.subtotal - comisionAmount).toFixed(2),
        metodo_pago: summary.metodo_pago,
        tipo_consumo: summary.tipo_consumo,
        fecha: nowCDMX(),
        monto_efectivo: montoEfectivo,
        monto_tarjeta: montoTarjeta,
        monto_transferencia: montoTransferencia,
        coworking_session_id: summary.coworking_session_id ?? null,
        caja_id: summary.caja_id ?? null,
      };
      const isCoworkingCheckout = !!summary.coworking_session_id;
      const openIds = openItems.map(it => it.open_account_detalle_id!).filter(Boolean);

      const auditPayload = {
        accion: isCoworkingCheckout
          ? 'cierre_cuenta_coworking'
          : (numPaquetes > 0 ? 'venta_completada_con_paquetes' : 'venta_completada'),
        descripcion: `Venta por $${summary.total.toFixed(2)} (${summary.metodo_pago})${isCoworkingCheckout ? ' + Coworking' : ''}${numPaquetes > 0 ? ` + ${numPaquetes} paquete(s)` : ''}${propinaAmount > 0 ? ` + Propina $${propinaAmount.toFixed(2)}` : ''}${openIds.length > 0 ? ` + ${openIds.length} consumo(s) abierto(s)` : ''}`,
        metadata: {
          total: summary.total,
          propina: propinaAmount,
          items: summary.items.length,
          open_lines_count: openIds.length,
          paquetes: paqueteItems.map(p => ({ paquete_id: p.paquete_id ?? p.producto_id, nombre: p.nombre, cantidad: p.cantidad, componentes: p.componentes })),
        },
      };

      const { data: rpcData, error: rpcErr } = isCoworkingCheckout
        ? await supabase.rpc('cerrar_cuenta_coworking', {
            p_venta: ventaPayload as unknown as Json,
            p_detalles_nuevos: realDetalles as unknown as Json,
            p_detalles_open_ids: openIds,
            p_audit: auditPayload as unknown as Json,
          })
        : await supabase.rpc('crear_venta_completa', {
            p_venta: ventaPayload as unknown as Json,
            p_detalles: realDetalles as unknown as Json,
            p_audit: auditPayload as unknown as Json,
          });

      if (rpcErr || !rpcData) {
        // Bitácora del rollback (best-effort)
        await supabase.from('audit_logs').insert({
          user_id: user.id,
          accion: 'venta_fallida_rollback',
          descripcion: `Venta rechazada: ${rpcErr?.message ?? 'sin detalle'} — Total intentado $${summary.total.toFixed(2)} (${summary.metodo_pago})`,
          metadata: {
            error: rpcErr?.message ?? null,
            total: summary.total,
            metodo_pago: summary.metodo_pago,
            coworking_session_id: summary.coworking_session_id ?? null,
            items_count: summary.items.length,
          },
        });
        throw rpcErr || new Error('No se pudo crear la venta');
      }

      const venta = rpcData as unknown as { id: string; folio: number };

      // 4. Create KDS order for kitchen (productos simples + componentes de paquetes)
      // - Excluir tiempo de servicio coworking (no preparable).
      // - Excluir items que ya provienen de una sesión coworking (amenities + extras
      //   añadidos en check-in o "Cuenta de la sesión"): esos ya se enviaron a cocina
      //   en su momento por `enviarASesionKDS`. Re-enviarlos aquí duplicaría comandas.
      // - Filtrar productos marcados como `requiere_preparacion=false` (retail, agua embotellada, etc.).
      type KdsRaw = { producto_id: string | null; nombre_producto: string; cantidad: number; notas: string | null };
      const kdsItemsRaw: KdsRaw[] = [];
      for (const item of summary.items) {
        // Skip todo lo que ya fue enviado a cocina desde la sesión de coworking
        if (item.coworking_session_id) continue;

        if (item.tipo_concepto === 'producto') {
          if (item.producto_id?.startsWith('coworking-')) continue;
          kdsItemsRaw.push({
            producto_id: item.producto_id ?? null,
            nombre_producto: item.nombre,
            cantidad: item.cantidad,
            notas: item.notas?.trim() || null,
          });
        } else if (item.tipo_concepto === 'amenity' && item.producto_id && !item.producto_id.startsWith('coworking-')) {
          // Amenities sueltos sin sesión (caso raro, conservamos legacy behavior)
          kdsItemsRaw.push({
            producto_id: item.producto_id,
            nombre_producto: `${item.nombre} ☕ (cortesía coworking)`,
            cantidad: item.cantidad,
            notas: item.notas?.trim() || null,
          });
        } else if (item.tipo_concepto === 'paquete') {
          for (const c of (item.componentes ?? [])) {
            kdsItemsRaw.push({
              producto_id: c.producto_id,
              nombre_producto: `${c.nombre} (📦 ${item.nombre.replace(/^📦\s*/, '')})`,
              cantidad: c.cantidad * item.cantidad,
              notas: item.notas?.trim() || null,
            });
          }
        }
      }


      // Filter out products that don't require kitchen preparation
      const productIds = kdsItemsRaw.map(i => i.producto_id).filter((x): x is string => !!x);
      let preparacionMap = new Map<string, boolean>();
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from('productos')
          .select('id, requiere_preparacion')
          .in('id', productIds);
        preparacionMap = new Map((prods ?? []).map((p: any) => [p.id, p.requiere_preparacion !== false]));
      }
      const kdsItemsFiltered = kdsItemsRaw.filter(it => {
        if (!it.producto_id) return true;
        return preparacionMap.get(it.producto_id) !== false;
      });

      if (kdsItemsFiltered.length > 0) {
        try {
          const { data: kdsOrder, error: kdsOrderErr } = await supabase.from('kds_orders').insert({
            venta_id: venta.id,
            folio: venta.folio,
            tipo_consumo: summary.tipo_consumo,
            estado: 'pendiente' as any,
          }).select('id').single();

          if (kdsOrderErr) throw kdsOrderErr;

          if (kdsOrder) {
            const kdsItems = kdsItemsFiltered.map(it => ({ kds_order_id: kdsOrder.id, ...it }));
            const { error: kdsItemsErr } = await supabase.from('kds_order_items').insert(kdsItems as any);
            if (kdsItemsErr) throw kdsItemsErr;
          }
        } catch (kdsErr: any) {
          console.error('Error creando orden KDS:', kdsErr);
          toast.warning('Venta registrada, pero la orden no llegó a Cocina. Notifica al barista manualmente.');
        }
      }

      // (La bitácora de la venta se inserta atómicamente dentro de crear_venta_completa)


      // Show ticket
      setTicket({
        ...summary,
        folio: venta.folio,
        usuario_nombre: profile?.nombre ?? user.email ?? '',
        fecha: nowCDMX(),
      });

      toast.success('Venta registrada exitosamente');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Error al procesar la venta');
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  const handleCloseTicket = () => {
    setTicket(null);
    onSuccess();
    onClose();
  };

  // Ticket view after successful sale
  if (ticket) {
    const coworkingItems = ticket.items.filter(i => i.tipo_concepto === 'coworking');
    const amenityItems = ticket.items.filter(i => i.tipo_concepto === 'amenity');
    const productoItems = ticket.items.filter(i => i.tipo_concepto === 'producto');
    const paqueteItemsTicket = ticket.items.filter(i => i.tipo_concepto === 'paquete');

    const metodoPagoLabel: Record<string, string> = {
      efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Mixto'
    };

    return (
      <Dialog open onOpenChange={handleCloseTicket}>
        <DialogContent className="sm:max-w-md overflow-hidden print:shadow-none print:border-0 print:max-w-full">
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              #ticket-print-area, #ticket-print-area * { visibility: visible !important; }
              #ticket-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 8px; font-size: 12px; }
              .no-print, .no-print * { display: none !important; }
            }
          `}</style>
          <DialogHeader>
            <DialogTitle className="text-center">🧾 Ticket de Venta</DialogTitle>
            {ticket.folio && (
              <p className="text-center text-sm font-bold text-primary">Folio: #{String(ticket.folio).padStart(4, '0')}</p>
            )}
          </DialogHeader>
          <div id="ticket-print-area" className="space-y-3 text-sm font-mono overflow-hidden">
            <div className="text-center space-y-1">
              <div className="font-bold text-base">Coco & Cacao + Kúuchil Meyaj</div>
              <p className="text-xs text-muted-foreground">Mérida, Yucatán</p>
              {ticket.folio && (
                <p className="text-xs font-bold">Folio: #{String(ticket.folio).padStart(4, '0')}</p>
              )}
              <p className="text-xs text-muted-foreground">{new Date(ticket.fecha!).toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p className="text-xs text-muted-foreground">{new Date(ticket.fecha!).toLocaleTimeString('es-MX')}</p>
              <p className="text-xs text-muted-foreground">Atendió: {ticket.usuario_nombre}</p>
            </div>

            <Separator />

            {coworkingItems.length > 0 && (
              <>
                <p className="font-bold text-xs uppercase text-muted-foreground">Coworking</p>
                {coworkingItems.map(i => (
                  <div key={i.producto_id} className="flex justify-between gap-2">
                    <span className="flex-1 break-words min-w-0">{i.nombre}</span>
                    <span className="shrink-0">${i.subtotal.toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}

            {amenityItems.length > 0 && (
              <>
                <p className="font-bold text-xs uppercase text-muted-foreground">Amenities (incluidos)</p>
                {amenityItems.map(i => (
                  <div key={i.producto_id} className="flex justify-between gap-2 text-muted-foreground">
                    <span className="flex-1 break-words min-w-0">{i.cantidad}x {i.nombre}</span>
                    <span className="shrink-0">$0.00</span>
                  </div>
                ))}
              </>
            )}

            {paqueteItemsTicket.length > 0 && (
              <>
                <p className="font-bold text-xs uppercase text-muted-foreground">Paquetes</p>
                {paqueteItemsTicket.map(p => (
                  <div key={p.lineId ?? p.producto_id}>
                    <div className="flex justify-between gap-2">
                      <span className="flex-1 break-words min-w-0">{p.cantidad}x {p.nombre}</span>
                      <span className="shrink-0">${p.subtotal.toFixed(2)}</span>
                    </div>
                    {(p.componentes ?? []).length > 0 && (
                      <ul className="ml-3 mt-0.5 space-y-0.5">
                        {(p.componentes ?? []).map((c, idx) => (
                          <li key={idx} className="text-[11px] text-muted-foreground">
                            • {c.cantidad * p.cantidad}x {c.nombre}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </>
            )}

            {productoItems.length > 0 && (
              <>
                <p className="font-bold text-xs uppercase text-muted-foreground">Productos</p>
                {productoItems.map(i => (
                  <div key={i.producto_id} className="flex justify-between gap-2">
                    <span className="flex-1 break-words min-w-0">{i.cantidad}x {i.nombre}</span>
                    <span className="shrink-0">${i.subtotal.toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}

            <Separator />

            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Subtotal (sin IVA)</span>
                <span>${(ticket.subtotal - ticket.iva).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>IVA</span>
                <span>${ticket.iva.toFixed(2)}</span>
              </div>
              {ticket.propina > 0 && (
                <div className="flex justify-between">
                  <span>Propina</span>
                  <span>+${ticket.propina.toFixed(2)}</span>
                </div>
              )}
            </div>

            <Separator />

            <div className="flex justify-between font-bold text-base">
              <span>TOTAL</span>
              <span>${ticket.total.toFixed(2)}</span>
            </div>

            <div className="text-xs text-muted-foreground text-center">
              <p>Método: {metodoPagoLabel[ticket.metodo_pago]}</p>
              {ticket.metodo_pago === 'mixto' && ticket.mixed_payment && (
                <p>
                  Efvo: ${ticket.mixed_payment.efectivo.toFixed(2)} |
                  Tarj: ${ticket.mixed_payment.tarjeta.toFixed(2)} |
                  Transf: ${ticket.mixed_payment.transferencia.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="no-print gap-2">
            <Button variant="outline" className="flex-1" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" /> Imprimir
            </Button>
            <Button className="flex-1" onClick={handleCloseTicket}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Confirmation view before sale
  const metodoPagoLabel: Record<string, string> = {
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Mixto'
  };
  const tipoConsumoLabel: Record<string, string> = {
    sitio: 'En sitio', para_llevar: 'Para llevar', delivery: 'Delivery'
  };

  return (
    <Dialog open={!!summary} onOpenChange={() => !saving && onClose()}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" /> Confirmar Venta
          </DialogTitle>
          <DialogDescription>Revisa el desglose antes de confirmar</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="max-h-40 overflow-y-auto space-y-1">
            {summary!.items.map(item => (
              <div key={item.lineId ?? item.producto_id}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="flex-1 break-words min-w-0">{item.cantidad}x {item.nombre}</span>
                  <span className="font-medium shrink-0">${item.subtotal.toFixed(2)}</span>
                </div>
                {item.tipo_concepto === 'paquete' && (item.componentes ?? []).length > 0 && (
                  <ul className="ml-3 mt-0.5 space-y-0.5">
                    {(item.componentes ?? []).map((c, idx) => (
                      <li key={idx} className="text-[11px] text-muted-foreground">
                        • {c.cantidad * item.cantidad}x {c.nombre}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal (sin IVA)</span>
              <span>${(summary!.subtotal - summary!.iva).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">IVA</span>
              <span>${summary!.iva.toFixed(2)}</span>
            </div>
            {summary!.propina > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Propina</span>
                <span className="text-primary">+${summary!.propina.toFixed(2)}</span>
              </div>
            )}
          </div>

          <Separator />

          <div className="flex justify-between font-bold text-lg">
            <span>Total a cobrar</span>
            <span className="text-primary">${summary!.total.toFixed(2)}</span>
          </div>

          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Pago: {metodoPagoLabel[summary!.metodo_pago]}</span>
            <span>Consumo: {tipoConsumoLabel[summary!.tipo_consumo]}</span>
          </div>

          {summary!.metodo_pago === 'mixto' && summary!.mixed_payment && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
              Efectivo: ${summary!.mixed_payment.efectivo.toFixed(2)} |
              Tarjeta: ${summary!.mixed_payment.tarjeta.toFixed(2)} |
              Transferencia: ${summary!.mixed_payment.transferencia.toFixed(2)}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar Venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
