import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle } from 'lucide-react';
import { useNow } from '@/hooks/useNow';

interface Props {
  fechaInicio: string;
  fechaFinEstimada: string;
  fechaSalidaReal?: string | null;
  variant?: 'inline' | 'compact';
}

function formatHMS(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatRemainingMin(min: number) {
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = Math.floor(abs % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SessionTimer({ fechaInicio, fechaFinEstimada, fechaSalidaReal, variant = 'inline' }: Props) {
  const frozen = !!fechaSalidaReal;
  const now = useNow(!frozen);
  const ref = frozen ? new Date(fechaSalidaReal!).getTime() : now;
  const inicio = new Date(fechaInicio).getTime();
  const fin = new Date(fechaFinEstimada).getTime();

  const elapsedSec = (ref - inicio) / 1000;
  const remainingMin = (fin - ref) / 60000;
  const excedido = remainingMin < 0;

  const tone = excedido
    ? 'text-destructive'
    : remainingMin <= 10
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-emerald-600 dark:text-emerald-400';

  if (variant === 'compact') {
    return (
      <span className={`text-[11px] font-mono ${tone} inline-flex items-center gap-1`}>
        <Clock className="h-3 w-3" />
        {formatHMS(elapsedSec)}
        {excedido && <AlertTriangle className="h-3 w-3" />}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`font-mono text-sm font-semibold ${tone} inline-flex items-center gap-1.5`}>
        <Clock className="h-3.5 w-3.5" />
        {formatHMS(elapsedSec)}
        {frozen && (
          <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase tracking-wide">
            Congelado
          </Badge>
        )}
      </span>
      {excedido ? (
        <span className="text-[11px] text-destructive font-medium inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />+{formatRemainingMin(remainingMin)} excedido
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          Restan {formatRemainingMin(remainingMin)}
        </span>
      )}
    </div>
  );
}
