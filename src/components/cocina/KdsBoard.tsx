import { ScrollArea } from '@/components/ui/scroll-area';
import { KdsOrderCard, type KdsOrder, type KdsItemCancelacion } from './KdsOrderCard';
import { Clock, ChefHat, CheckCircle2 } from 'lucide-react';

interface Props {
  orders: KdsOrder[];
  onStart: (orderId: string) => void;
  onMarkReady: (orderId: string) => void;
  onRevert: (orderId: string) => void;
  onDismiss?: (orderId: string) => void;
  cancelacionesPorOrden?: Record<string, KdsItemCancelacion[]>;
  onResolveCancel?: (cancelId: string, decision: 'retornado_stock' | 'merma', notas?: string | null) => void;
  resolvingCancelId?: string | null;
  busyId: string | null;
}

interface ColumnProps {
  title: string;
  icon: React.ReactNode;
  iconColor: string;
  orders: KdsOrder[];
  empty: string;
  children: (order: KdsOrder) => React.ReactNode;
}

function Column({ title, icon, iconColor, orders, empty, children }: ColumnProps) {
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={iconColor}>{icon}</span>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <span className="ml-auto text-sm font-mono text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">
          {orders.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 pr-2 pb-4">
          {orders.length === 0 && (
            <p className="text-center text-muted-foreground py-12 text-sm">{empty}</p>
          )}
          {orders.map((o) => children(o))}
        </div>
      </ScrollArea>
    </div>
  );
}

export function KdsBoard({ orders, onStart, onMarkReady, onRevert, onDismiss, cancelacionesPorOrden, onResolveCancel, resolvingCancelId, busyId }: Props) {
  const pendientes = orders.filter((o) => o.estado === 'pendiente');
  const enPrep = orders.filter((o) => o.estado === 'en_preparacion');
  const listos = orders.filter((o) => o.estado === 'listo');

  const cancelsFor = (id: string) => cancelacionesPorOrden?.[id];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
      <Column
        title="Pendiente"
        icon={<Clock className="h-5 w-5" />}
        iconColor="text-amber-500"
        orders={pendientes}
        empty="Sin órdenes pendientes 🎉"
      >
        {(order) => (
          <KdsOrderCard
            key={order.id}
            order={order}
            onStart={onStart}
            cancelaciones={cancelsFor(order.id)}
            onResolveCancel={onResolveCancel}
            resolvingCancelId={resolvingCancelId}
            busy={busyId === order.id}
          />
        )}
      </Column>

      <Column
        title="En preparación"
        icon={<ChefHat className="h-5 w-5" />}
        iconColor="text-primary"
        orders={enPrep}
        empty="Ninguna en preparación"
      >
        {(order) => (
          <KdsOrderCard
            key={order.id}
            order={order}
            onMarkReady={onMarkReady}
            cancelaciones={cancelsFor(order.id)}
            onResolveCancel={onResolveCancel}
            resolvingCancelId={resolvingCancelId}
            busy={busyId === order.id}
          />
        )}
      </Column>

      <Column
        title="Listo"
        icon={<CheckCircle2 className="h-5 w-5" />}
        iconColor="text-emerald-600"
        orders={listos}
        empty="Sin órdenes listas"
      >
        {(order) => (
          <KdsOrderCard
            key={order.id}
            order={order}
            onRevert={onRevert}
            onDismiss={onDismiss}
            cancelaciones={cancelsFor(order.id)}
            onResolveCancel={onResolveCancel}
            resolvingCancelId={resolvingCancelId}
            busy={busyId === order.id}
          />
        )}
      </Column>
    </div>
  );
}
