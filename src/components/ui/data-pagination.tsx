import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DataPaginationProps {
  paginaActual: number;        // 1-based
  totalItems: number;
  porPagina: number;
  onPaginaChange: (p: number) => void;
  onPorPaginaChange: (n: number) => void;
  etiqueta?: string;
  opcionesPorPagina?: number[];
}

export function DataPagination({
  paginaActual,
  totalItems,
  porPagina,
  onPaginaChange,
  onPorPaginaChange,
  etiqueta = 'registros',
  opcionesPorPagina = [10, 25, 50, 100],
}: DataPaginationProps) {
  const totalPaginas = Math.max(1, Math.ceil(totalItems / porPagina));
  const paginaSegura = Math.min(Math.max(1, paginaActual), totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const fin = inicio + porPagina;

  const numerosPagina = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    const total = totalPaginas;
    const cur = paginaSegura;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (cur > 3) pages.push('ellipsis');
      const start = Math.max(2, cur - 1);
      const end = Math.min(total - 1, cur + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (cur < total - 2) pages.push('ellipsis');
      pages.push(total);
    }
    return pages;
  }, [totalPaginas, paginaSegura]);

  if (totalItems === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-muted-foreground">
        Mostrando {inicio + 1}–{Math.min(fin, totalItems)} de {totalItems} {etiqueta}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Por página</Label>
          <Select value={String(porPagina)} onValueChange={v => onPorPaginaChange(Number(v))}>
            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {opcionesPorPagina.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={paginaSegura === 1}
            onClick={() => onPaginaChange(Math.max(1, paginaSegura - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {numerosPagina.map((n, idx) =>
            n === 'ellipsis' ? (
              <span key={`e-${idx}`} className="px-2 text-muted-foreground text-sm">…</span>
            ) : (
              <Button
                key={n}
                variant={n === paginaSegura ? 'default' : 'outline'}
                size="icon"
                className="h-8 w-8 text-xs"
                onClick={() => onPaginaChange(n)}
              >
                {n}
              </Button>
            )
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={paginaSegura === totalPaginas}
            onClick={() => onPaginaChange(Math.min(totalPaginas, paginaSegura + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DataPagination;
