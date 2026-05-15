import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Check, Clock as ClockIcon, UtensilsCrossed, Play, Undo2, Bike, ShoppingBag, Coffee, Building2, Ban, PackageCheck, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KdsOrderItem {
  id: string;
  nombre_producto: string;
  cantidad: number;
  notas: string | null;
  cancel_requested?: boolean;
  cancel_qty?: number;
}

/** Solicitud de cancelación pendiente asociada a un item KDS */
export interface KdsItemCancelacion {
  id: string;
  kds_item_id: string;
  kds_order_id: string | null;
  cantidad: number;
  motivo: string;
  nombre_producto: string;
}

export type KdsEstado = 'pendiente' | 'en_preparacion' | 'listo';

export interface KdsOrder {
  id: string;
  venta_id: string | null;
  folio: number;
  tipo_consumo: string;
  estado: KdsEstado;
  created_at: string;
  items: KdsOrderItem[];
  /** Si proviene de coworking, id de la sesión origen */
  coworking_session_id?: string | null;
  /** Metadatos enriquecidos desde la sesión coworking (cliente y área) */
  coworking_cliente?: string | null;
  coworking_area?: string | null;
}

interface Props {
  order: KdsOrder;
  onStart?: (orderId: string) => void;
  onMarkReady?: (orderId: string) => void;
  onRevert?: (orderId: string) => void;
  onDismiss?: (orderId: string) => void;
  /** Cancelaciones pendientes asociadas a esta orden, indexadas por kds_item_id */
  cancelaciones?: KdsItemCancelacion[];
  /** Resolver una cancelación (cocina decide retorno o merma, con notas opcionales) */
  onResolveCancel?: (cancelId: string, decision: 'retornado_stock' | 'merma', notas?: string | null) => void;
  /** Indica si una resolución está en curso (deshabilita botones) */
  resolvingCancelId?: string | null;
  busy?: boolean;
}

const tipoLabel: Record<string, string> = {
  sitio: 'En sitio',
  para_llevar: 'Para llevar',
  delivery: 'Delivery',
};

const ConsumoIcon = ({ tipo }: { tipo: string }) => {
  if (tipo === 'delivery') return <Bike className="h-3 w-3" />;
  if (tipo === 'para_llevar') return <ShoppingBag className="h-3 w-3" />;
  return <Coffee className="h-3 w-3" />;
};

export function KdsOrderCard({ order, onStart, onMarkReady, onRevert, onDismiss, cancelaciones, onResolveCancel, resolvingCancelId, busy }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [resolveDialog, setResolveDialog] = useState<{ cancelId: string; decision: 'retornado_stock' | 'merma'; nombre: string } | null>(null);
  const [notas, setNotas] = useState('');

  useEffect(() => {
    const start = new Date(order.created_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [order.created_at]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const urgency =
    minutes >= 10 ? 'urgent' : minutes >= 5 ? 'warning' : 'normal';

  const urgencyStyles = {
    normal: 'border-emerald-500/40 bg-emerald-500/5',
    warning: 'border-amber-500/60 bg-amber-500/5',
    urgent: 'border-red-500/70 bg-red-500/10 animate-pulse',
  };

  const timerColor = {
    normal: 'text-emerald-600',
    warning: 'text-amber-600',
    urgent: 'text-red-600 font-bold',
  };

  const isReady = order.estado === 'listo';
  const isInProgress = order.estado === 'en_preparacion';
  const isPending = order.estado === 'pendiente';

  const cardStyle = isReady
    ? 'border-muted bg-muted/40 opacity-85'
    : isInProgress
      ? 'border-primary/60 bg-primary/5'
      : urgencyStyles[urgency];

  const isCoworking = !!order.coworking_session_id;
  const cancelList = cancelaciones ?? [];
  const cancelByItem = new Map<string, KdsItemCancelacion>();
  cancelList.forEach((c) => { if (c.kds_item_id) cancelByItem.set(c.kds_item_id, c); });
  const hasCancel = cancelList.length > 0;
  const coworkingCardStyle = isCoworking && !isReady && !isInProgress
    ? 'border-amber-500/60 bg-amber-500/10 shadow-amber-500/20'
    : '';
  const cancelCardStyle = hasCancel ? 'border-destructive/70 bg-destructive/5' : '';

  return (
    <Card
      role="article"
      aria-label={`Orden #${String(order.folio).padStart(4, '0')}, ${tipoLabel[order.tipo_consumo] || order.tipo_consumo}, ${order.estado}, ${minutes} minutos ${seconds} segundos`}
      className={cn('border-2 transition-all duration-300', cardStyle, coworkingCardStyle, cancelCardStyle)}
    >
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-lg font-bold font-mono text-foreground">
              #{String(order.folio).padStart(4, '0')}
            </span>
            {isCoworking ? (
              <Badge className="text-xs font-semibold gap-1 bg-amber-500/90 text-amber-50 hover:bg-amber-500/90 border-0">
                <Building2 className="h-3 w-3" />
                Coworking
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-normal gap-1">
                <ConsumoIcon tipo={order.tipo_consumo} />
                {tipoLabel[order.tipo_consumo] || order.tipo_consumo}
              </Badge>
            )}
          </div>
          {!isReady && (
            <div className={cn('flex items-center gap-1 text-sm shrink-0', timerColor[urgency])}>
              <ClockIcon className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">
                {minutes}:{String(seconds).padStart(2, '0')}
              </span>
            </div>
          )}
          {isReady && (
            <Badge className="bg-primary text-primary-foreground shrink-0">
              <Check className="h-3 w-3 mr-1" /> Listo
            </Badge>
          )}
        </div>
        {isCoworking && (order.coworking_cliente || order.coworking_area) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground/80 font-medium">
            {order.coworking_cliente && (
              <span className="truncate">{order.coworking_cliente}</span>
            )}
            {order.coworking_cliente && order.coworking_area && (
              <span className="text-muted-foreground">·</span>
            )}
            {order.coworking_area && (
              <span className="text-muted-foreground truncate">{order.coworking_area}</span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-2">
        {hasCancel && (
          <div className="rounded-md border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive font-semibold uppercase tracking-wide flex items-center gap-1.5">
            <Ban className="h-3.5 w-3.5" /> ¡Cancelación solicitada!
          </div>
        )}
        <div className="space-y-1.5">
          {order.items.map((item) => {
            const cancel = cancelByItem.get(item.id);
            const fullyCanceled = cancel && cancel.cantidad >= item.cantidad;
            return (
              <div key={item.id} className="flex items-start gap-2">
                <span className={cn('text-sm font-semibold min-w-[24px]', fullyCanceled ? 'text-destructive line-through' : 'text-foreground')}>
                  {item.cantidad}x
                </span>
                <div className="flex-1 min-w-0">
                  <span className={cn('text-sm', fullyCanceled ? 'text-destructive line-through' : 'text-foreground')}>
                    {item.nombre_producto}
                  </span>
                  {cancel && !fullyCanceled && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-destructive font-semibold">
                      Cancelar ×{cancel.cantidad}
                    </span>
                  )}
                  {item.notas && (
                    <p className="text-xs text-accent-foreground italic mt-0.5 font-medium bg-accent/40 rounded px-1.5 py-0.5 inline-block">
                      📝 {item.notas}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {hasCancel && onResolveCancel && (
          <div className="space-y-2 mt-2 pt-2 border-t border-destructive/30">
            {cancelList.map((c) => (
              <div key={c.id} className="rounded-md bg-background/60 border border-border p-2 space-y-2">
                <div className="text-xs">
                  <div className="font-semibold text-destructive">{c.nombre_producto} ×{c.cantidad}</div>
                  <div className="text-muted-foreground italic mt-0.5">"{c.motivo}"</div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs font-semibold border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10"
                    onClick={() => { setNotas(''); setResolveDialog({ cancelId: c.id, decision: 'retornado_stock', nombre: c.nombre_producto }); }}
                    disabled={busy || resolvingCancelId === c.id}
                    title="No se preparó: regresa los insumos al inventario"
                  >
                    <PackageCheck className="h-3.5 w-3.5 mr-1" />
                    Retornar a stock
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs font-semibold border-amber-500/50 text-amber-700 hover:bg-amber-500/10"
                    onClick={() => { setNotas(''); setResolveDialog({ cancelId: c.id, decision: 'merma', nombre: c.nombre_producto }); }}
                    disabled={busy || resolvingCancelId === c.id}
                    title="Ya se preparó: registra los insumos como merma"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Registrar merma
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isPending && onStart && (
          <Button
            size="lg"
            variant="outline"
            className="w-full mt-2 h-11 text-base font-semibold border-primary/40 text-primary hover:bg-primary/10"
            onClick={() => onStart(order.id)}
            disabled={busy}
          >
            <Play className="h-4 w-4 mr-2" />
            Iniciar
          </Button>
        )}

        {isInProgress && onMarkReady && (
          <Button
            size="lg"
            className="w-full mt-2 h-12 text-base font-semibold"
            onClick={() => onMarkReady(order.id)}
            disabled={busy}
          >
            <UtensilsCrossed className="h-5 w-5 mr-2" />
            Marcar Listo
          </Button>
        )}

        {isReady && (
          <div className="flex flex-col gap-1.5 mt-2">
            {onDismiss && (
              <Button
                size="lg"
                className="w-full h-11 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                onClick={() => onDismiss(order.id)}
                disabled={busy}
              >
                <Check className="h-5 w-5 mr-2" />
                Entregado
              </Button>
            )}
            {onRevert && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onRevert(order.id)}
                disabled={busy}
              >
                <Undo2 className="h-3 w-3 mr-1.5" />
                Revertir a "En preparación"
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!resolveDialog} onOpenChange={(o) => { if (!o) setResolveDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resolveDialog?.decision === 'retornado_stock' ? 'Retornar a stock' : 'Registrar merma'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resolveDialog?.decision === 'retornado_stock'
                ? `Los insumos de "${resolveDialog?.nombre}" se reintegrarán al inventario.`
                : `Se mantendrá el descuento de inventario y se registrará "${resolveDialog?.nombre}" como merma.`}
              {' '}Puedes agregar una nota visible para el solicitante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Notas opcionales para cocina/solicitante…"
            className="min-h-[80px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resolveDialog && onResolveCancel) {
                  onResolveCancel(resolveDialog.cancelId, resolveDialog.decision, notas.trim() || null);
                }
                setResolveDialog(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
