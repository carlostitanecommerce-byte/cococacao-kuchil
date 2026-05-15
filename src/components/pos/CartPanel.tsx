import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Trash2, Plus, Minus, ShoppingCart, Package, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { CartItem } from './types';

interface Props {
  items: CartItem[];
  onUpdateQty: (lineId: string, delta: number) => void;
  onUpdateNotas?: (lineId: string, notas: string) => void;
  onRemove: (lineId: string) => void;
  onClear: () => void;
  subtotal: number;
  coworkingSessionActive?: boolean;
  clienteNombre?: string | null;
}

const keyOf = (i: CartItem) => i.lineId ?? i.producto_id;

function NotesPopover({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const hasNotes = !!value?.trim();

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(value); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', hasNotes ? 'text-primary' : 'text-muted-foreground')}
          title={hasNotes ? `Nota: ${value}` : 'Agregar nota'}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <Label className="text-xs text-muted-foreground">Nota para cocina</Label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ej: sin azúcar, leche deslactosada..."
          rows={3}
          maxLength={200}
          className="text-sm mt-1"
          autoFocus
        />
        <div className="flex justify-end gap-1 mt-2">
          <Button variant="ghost" size="sm" onClick={() => { onChange(''); setOpen(false); }}>
            Limpiar
          </Button>
          <Button size="sm" onClick={() => { onChange(draft); setOpen(false); }}>
            Guardar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CartPanel({ items, onUpdateQty, onUpdateNotas, onRemove, onClear, subtotal, coworkingSessionActive, clienteNombre }: Props) {
  const productoItems = items.filter(i => i.tipo_concepto === 'producto');
  const paqueteItems = items.filter(i => i.tipo_concepto === 'paquete');

  const renderItem = (item: CartItem) => {
    const isPaquete = item.tipo_concepto === 'paquete';
    const k = keyOf(item);
    // Agrupar opciones por nombre_grupo (paquetes dinámicos)
    const opcionesPorGrupo = new Map<string, typeof item.opciones>();
    if (item.opciones && item.opciones.length > 0) {
      for (const op of item.opciones) {
        const arr = opcionesPorGrupo.get(op.nombre_grupo) ?? [];
        arr.push(op);
        opcionesPorGrupo.set(op.nombre_grupo, arr);
      }
    }
    return (
      <div
        key={k}
        className="rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-primary/30"
      >
        {/* Fila 1: Nombre + subtotal */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0 flex-1">
            {isPaquete && <Package className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight line-clamp-2">{item.nombre}</p>
              {item.precio_especial && (
                <Badge variant="outline" className="mt-1 text-[9px] px-1 py-0 h-4 border-primary text-primary w-fit">
                  Tarifa Coworking
                </Badge>
              )}
            </div>
          </div>
          <p className="text-sm font-bold text-primary shrink-0 tabular-nums">
            ${item.subtotal.toFixed(2)}
          </p>
        </div>

        {/* Fila 2: precio unitario + stepper + acciones */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground tabular-nums">
            ${item.precio_unitario.toFixed(2)} c/u
          </p>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-background"
                onClick={() => onUpdateQty(k, -1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-5 text-center text-xs font-semibold tabular-nums">
                {item.cantidad}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-background"
                onClick={() => onUpdateQty(k, 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {onUpdateNotas && (
              <NotesPopover
                value={item.notas ?? ''}
                onChange={(v) => onUpdateNotas(k, v)}
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(k)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {item.notas && (
          <div className="mt-2 rounded-sm border-l-2 border-primary bg-primary/5 px-2 py-1">
            <p className="text-[11px] text-primary italic">{item.notas}</p>
          </div>
        )}

        {/* Paquete dinámico: opciones agrupadas */}
        {isPaquete && opcionesPorGrupo.size > 0 && (
          <div className="mt-2 ml-1 space-y-1.5 border-l border-border pl-2">
            {Array.from(opcionesPorGrupo.entries()).map(([grupo, ops]) => (
              <div key={grupo}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  {grupo}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {(ops ?? []).map((op, idx) => (
                    <li key={`${op.producto_id}-${idx}`} className="text-[11px] text-foreground/80 flex items-center justify-between gap-2">
                      <span className="truncate">• {op.nombre_producto}</span>
                      {op.precio_adicional > 0 && (
                        <span className="text-primary tabular-nums shrink-0">
                          +${op.precio_adicional.toFixed(2)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Paquete legacy: componentes fijos (solo si NO hay opciones) */}
        {isPaquete && opcionesPorGrupo.size === 0 && item.componentes && item.componentes.length > 0 && (
          <ul className="mt-2 ml-1 space-y-0.5 border-l border-border pl-2">
            {item.componentes.map((c, idx) => (
              <li key={idx} className="text-[11px] text-muted-foreground flex items-center gap-1">
                <span className="font-mono">{c.cantidad * item.cantidad}x</span>
                <span className="truncate">{c.nombre}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-heading font-bold text-base flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Ticket
        </h2>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} className="text-destructive hover:text-destructive">
            Limpiar
          </Button>
        )}
      </div>

      {coworkingSessionActive && (
        <div className="mb-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-sm text-primary">
          <p className="font-semibold">📌 Cargando a sesión de Coworking</p>
          {clienteNombre && (
            <p className="text-xs opacity-80 truncate">Cliente: {clienteNombre}</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">Agrega productos al ticket</p>
        ) : (
          <>
            {paqueteItems.length > 0 && (
              <div className="space-y-1">
                <Badge variant="outline" className="text-xs mb-1 border-primary text-primary">📦 Paquetes</Badge>
                {paqueteItems.map(renderItem)}
              </div>
            )}
            {productoItems.length > 0 && (
              <div className="space-y-1">
                <Badge variant="outline" className="text-xs mb-1">Productos</Badge>
                {productoItems.map(renderItem)}
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border pt-3 mt-3 space-y-1">
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">Subtotal:</span>
          <span>${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center text-lg font-bold">
          <span>Total:</span>
          <span className="text-primary">${subtotal.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
