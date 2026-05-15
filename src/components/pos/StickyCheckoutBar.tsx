import { Button } from '@/components/ui/button';
import { ShoppingCart, ArrowRight } from 'lucide-react';

interface Props {
  itemCount: number;
  total: number;
  onViewTicket: () => void;
  onCheckout: () => void;
}

export function StickyCheckoutBar({ itemCount, total, onViewTicket, onCheckout }: Props) {
  const disabled = itemCount === 0;
  return (
    <div className="border-t border-border bg-card/95 backdrop-blur-sm px-3 py-2 flex items-center gap-3 shadow-[0_-2px_8px_-4px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        onClick={onViewTicket}
        disabled={disabled}
        className="flex items-center gap-2 min-w-0 flex-1 text-left disabled:opacity-60"
      >
        <div className="relative shrink-0">
          <ShoppingCart className="h-6 w-6 text-foreground" />
          {itemCount > 0 && (
            <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center tabular-nums">
              {itemCount}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground leading-tight">
            {itemCount === 0 ? 'Sin productos' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
          </p>
          <p className="text-lg font-bold text-primary tabular-nums leading-tight">
            ${total.toFixed(2)}
          </p>
        </div>
      </button>

      <Button
        variant="outline"
        size="lg"
        className="h-12"
        onClick={onViewTicket}
        disabled={disabled}
      >
        Ver ticket
      </Button>
      <Button
        size="lg"
        className="h-12"
        onClick={onCheckout}
        disabled={disabled}
      >
        Cobrar
        <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>
    </div>
  );
}
