import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2, Printer } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface VentaResumen {
  id: string;
  folio: number;
  fecha: string;
  metodo_pago: string;
  total_neto: number;
  iva: number;
  monto_propina: number;
  monto_efectivo: number;
  monto_tarjeta: number;
  monto_transferencia: number;
  usuario_id: string;
}

interface DetalleLinea {
  id: string;
  cantidad: number;
  subtotal: number;
  precio_unitario: number;
  descripcion: string | null;
  tipo_concepto: string;
  paquete_nombre: string | null;
  productos?: { nombre: string } | null;
}

interface Props {
  venta: VentaResumen | null;
  onClose: () => void;
}

const NEGOCIO_NOMBRE = 'Coco & Cacao + Kúuchil Meyaj';
const NEGOCIO_DIRECCION = 'Mérida, Yucatán';
const NEGOCIO_RFC = ''; // Configurable a futuro

export function TicketReimprimirDialog({ venta, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [detalles, setDetalles] = useState<DetalleLinea[]>([]);
  const [usuarioNombre, setUsuarioNombre] = useState('');

  useEffect(() => {
    if (!venta) return;
    const load = async () => {
      setLoading(true);
      try {
        const [{ data: det }, { data: prof }] = await Promise.all([
          supabase
            .from('detalle_ventas')
            .select('id, cantidad, subtotal, precio_unitario, descripcion, tipo_concepto, paquete_nombre, productos:producto_id(nombre)')
            .eq('venta_id', venta.id),
          supabase.from('profiles').select('nombre').eq('id', venta.usuario_id).maybeSingle(),
        ]);
        setDetalles((det as any) ?? []);
        setUsuarioNombre(prof?.nombre ?? '');
      } catch (err: any) {
        toast.error('No se pudo cargar el ticket');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [venta]);

  if (!venta) return null;

  // Agrupar componentes de paquetes: una sola línea por paquete (cantidad real, precio total real)
  // con sus componentes listados debajo sin precio individual.
  type LineaSimple = { kind: 'simple'; id: string; cantidad: number; subtotal: number; displayName: string };
  type LineaPaquete = { kind: 'paquete'; id: string; cantidad: number; subtotal: number; nombre: string; componentes: { cantidad: number; nombre: string }[] };
  const lineasMostrar: (LineaSimple | LineaPaquete)[] = [];
  const paqueteBuckets = new Map<string, LineaPaquete>();
  for (const d of detalles) {
    const nombreLinea = d.descripcion || d.productos?.nombre || 'Concepto';
    if (d.paquete_nombre) {
      // Agrupar por paquete_nombre (ya viene normalizado por venta; suficiente para diferenciar paquetes)
      const key = `pq:${d.paquete_nombre}`;
      let bucket = paqueteBuckets.get(key);
      if (!bucket) {
        bucket = {
          kind: 'paquete',
          id: key,
          cantidad: 1,
          subtotal: 0,
          nombre: d.paquete_nombre,
          componentes: [],
        };
        paqueteBuckets.set(key, bucket);
        lineasMostrar.push(bucket);
      }
      bucket.subtotal += Number(d.subtotal) || 0;
      bucket.componentes.push({ cantidad: Number(d.cantidad) || 0, nombre: nombreLinea });
    } else {
      lineasMostrar.push({
        kind: 'simple',
        id: d.id,
        cantidad: Number(d.cantidad) || 0,
        subtotal: Number(d.subtotal) || 0,
        displayName: nombreLinea,
      });
    }
  }

  const subtotalSinIva = venta.total_neto - venta.iva;
  const metodoPagoLabel: Record<string, string> = {
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Mixto',
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md overflow-hidden print:shadow-none print:border-0 print:max-w-full">
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            #ticket-reprint-area, #ticket-reprint-area * { visibility: visible !important; }
            #ticket-reprint-area { position: absolute; left: 0; top: 0; width: 100%; padding: 8px; font-size: 12px; }
            .no-print, .no-print * { display: none !important; }
          }
        `}</style>
        <DialogHeader>
          <DialogTitle className="text-center">🧾 Re-impresión de Ticket</DialogTitle>
          <p className="text-center text-sm font-bold text-primary">Folio: #{String(venta.folio).padStart(4, '0')}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div id="ticket-reprint-area" className="space-y-3 text-sm font-mono overflow-hidden">
            <div className="text-center space-y-1">
              <div className="font-bold text-base">{NEGOCIO_NOMBRE}</div>
              <p className="text-xs text-muted-foreground">{NEGOCIO_DIRECCION}</p>
              {NEGOCIO_RFC && <p className="text-xs text-muted-foreground">RFC: {NEGOCIO_RFC}</p>}
              <p className="text-xs font-bold">Folio: #{String(venta.folio).padStart(4, '0')}</p>
              <p className="text-xs">{new Date(venta.fecha).toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p className="text-xs">{new Date(venta.fecha).toLocaleTimeString('es-MX')}</p>
              {usuarioNombre && <p className="text-xs">Atendió: {usuarioNombre}</p>}
              <p className="text-[10px] italic text-muted-foreground">** REIMPRESIÓN **</p>
            </div>

            <Separator />

            <div className="space-y-1">
              {lineasMostrar.map(l => l.kind === 'simple' ? (
                <div key={l.id} className="flex justify-between gap-2">
                  <span className="flex-1 break-words min-w-0">{l.cantidad}x {l.displayName}</span>
                  <span className="shrink-0">${l.subtotal.toFixed(2)}</span>
                </div>
              ) : (
                <div key={l.id}>
                  <div className="flex justify-between gap-2">
                    <span className="flex-1 break-words min-w-0">{l.cantidad}x 📦 {l.nombre}</span>
                    <span className="shrink-0">${l.subtotal.toFixed(2)}</span>
                  </div>
                  {l.componentes.length > 0 && (
                    <ul className="ml-3 mt-0.5 space-y-0.5">
                      {l.componentes.map((c, idx) => (
                        <li key={idx} className="text-[11px] text-muted-foreground">
                          • {c.cantidad}x {c.nombre}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-1">
              <div className="flex justify-between"><span>Subtotal (sin IVA)</span><span>${subtotalSinIva.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>IVA</span><span>${Number(venta.iva).toFixed(2)}</span></div>
              {venta.monto_propina > 0 && (
                <div className="flex justify-between"><span>Propina</span><span>+${Number(venta.monto_propina).toFixed(2)}</span></div>
              )}
            </div>

            <Separator />

            <div className="flex justify-between font-bold text-base">
              <span>TOTAL</span>
              <span>${(Number(venta.total_neto) + Number(venta.monto_propina)).toFixed(2)}</span>
            </div>

            <div className="text-xs text-center space-y-0.5">
              <p>Método: {metodoPagoLabel[venta.metodo_pago] ?? venta.metodo_pago}</p>
              {venta.metodo_pago === 'mixto' && (
                <p>
                  Efvo: ${Number(venta.monto_efectivo).toFixed(2)} |
                  Tarj: ${Number(venta.monto_tarjeta).toFixed(2)} |
                  Transf: ${Number(venta.monto_transferencia).toFixed(2)}
                </p>
              )}
            </div>

            <p className="text-center text-[10px] text-muted-foreground pt-2">¡Gracias por tu visita!</p>
          </div>
        )}

        <DialogFooter className="no-print gap-2">
          <Button variant="outline" className="flex-1" onClick={() => window.print()} disabled={loading}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir
          </Button>
          <Button className="flex-1" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
