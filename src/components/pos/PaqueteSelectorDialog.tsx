import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Package, Plus, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import type { PaqueteOpcionSeleccionada } from './types';

interface Grupo {
  id: string;
  nombre_grupo: string;
  cantidad_incluida: number;
  es_obligatorio: boolean;
  orden: number;
  opciones: Opcion[];
}

interface Opcion {
  id: string;
  producto_id: string;
  precio_adicional: number;
  nombre_producto: string;
  activo: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paquete: { id: string; nombre: string; precio_venta: number } | null;
  onConfirm: (payload: {
    opciones: PaqueteOpcionSeleccionada[];
    precioFinal: number;
  }) => void;
}

export function PaqueteSelectorDialog({ open, onOpenChange, paquete, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  // Selecciones por grupo: array de opciones (permite repetir la misma)
  const [seleccion, setSeleccion] = useState<Record<string, Opcion[]>>({});

  useEffect(() => {
    if (!open || !paquete) return;
    let cancelled = false;
    setLoading(true);
    setSeleccion({});
    (async () => {
      const { data, error } = await supabase
        .from('paquete_grupos')
        .select(`
          id, nombre_grupo, cantidad_incluida, es_obligatorio, orden,
          paquete_opciones_grupo (
            id, producto_id, precio_adicional,
            productos:producto_id ( nombre, activo )
          )
        `)
        .eq('paquete_id', paquete.id)
        .order('orden');
      if (cancelled) return;
      if (error) {
        toast.error('Error al cargar grupos del paquete');
        setGrupos([]);
        setLoading(false);
        return;
      }
      const mapped: Grupo[] = (data ?? []).map((g: any) => ({
        id: g.id,
        nombre_grupo: g.nombre_grupo,
        cantidad_incluida: g.cantidad_incluida,
        es_obligatorio: g.es_obligatorio,
        orden: g.orden,
        opciones: (g.paquete_opciones_grupo ?? [])
          .map((o: any) => ({
            id: o.id,
            producto_id: o.producto_id,
            precio_adicional: Number(o.precio_adicional) || 0,
            nombre_producto: o.productos?.nombre ?? '—',
            activo: o.productos?.activo !== false,
          }))
          .filter((o: Opcion) => o.activo)
          .sort((a: Opcion, b: Opcion) => a.nombre_producto.localeCompare(b.nombre_producto)),
      }));
      setGrupos(mapped);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, paquete]);

  const extras = useMemo(() => {
    let total = 0;
    for (const g of grupos) {
      for (const op of (seleccion[g.id] ?? [])) total += op.precio_adicional;
    }
    return total;
  }, [grupos, seleccion]);

  const total = (paquete?.precio_venta ?? 0) + extras;

  const completo = useMemo(() => {
    return grupos.every(g => {
      const elegidas = seleccion[g.id]?.length ?? 0;
      if (g.es_obligatorio) return elegidas === g.cantidad_incluida;
      return elegidas <= g.cantidad_incluida;
    });
  }, [grupos, seleccion]);

  // Validación de stock por opción: mapa producto_id -> { viable, motivo? }
  const [stockMap, setStockMap] = useState<Record<string, { viable: boolean; motivo?: string }>>({});
  const [validating, setValidating] = useState(false);
  const validateSeqRef = useRef(0);
  const cartItems = useCartStore(s => s.items);

  // IDs únicos de productos candidatos en el diálogo
  const candidateProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of grupos) for (const op of g.opciones) ids.add(op.producto_id);
    return Array.from(ids);
  }, [grupos]);

  // Recalcular viabilidad de cada opción cuando cambia la selección o el carrito
  useEffect(() => {
    if (!open || !paquete || candidateProductIds.length === 0) {
      setStockMap({});
      return;
    }

    const seq = ++validateSeqRef.current;
    setValidating(true);

    // Componentes ya seleccionados (cuenta cada opción como 1 unidad)
    const seleccionados: Record<string, number> = {};
    for (const g of grupos) {
      for (const op of (seleccion[g.id] ?? [])) {
        seleccionados[op.producto_id] = (seleccionados[op.producto_id] ?? 0) + 1;
      }
    }

    // Snapshot del carrito (sin el paquete tentativo)
    const cartSnapshot = cartItems.map((i) => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      tipo_concepto: i.tipo_concepto,
      componentes: (i as any).componentes,
    }));

    const buildTentativeForOption = (productoId: string) => {
      const counts = new Map<string, number>(Object.entries(seleccionados));
      counts.set(productoId, (counts.get(productoId) ?? 0) + 1);
      const componentes = Array.from(counts.entries()).map(([pid, cant]) => ({
        producto_id: pid, cantidad: cant,
      }));
      return [
        ...cartSnapshot,
        {
          producto_id: paquete.id,
          cantidad: 1,
          tipo_concepto: 'paquete',
          componentes,
        },
      ];
    };

    (async () => {
      const results = await Promise.all(
        candidateProductIds.map(async (pid) => {
          const items = buildTentativeForOption(pid);
          const { data, error } = await supabase.rpc('validar_stock_carrito', { p_items: items as any });
          if (error) return [pid, { viable: true }] as const;
          const r = data as unknown as { valido: boolean; error?: string };
          return [pid, { viable: !!r?.valido, motivo: r?.error }] as const;
        })
      );
      if (seq !== validateSeqRef.current) return;
      const next: Record<string, { viable: boolean; motivo?: string }> = {};
      for (const [pid, v] of results) next[pid] = v;
      setStockMap(next);
      setValidating(false);
    })();
  }, [open, paquete, grupos, seleccion, cartItems, candidateProductIds]);

  // Indica si la selección actual ya es inviable de por sí
  const seleccionInviable = useMemo(() => {
    for (const g of grupos) {
      for (const op of (seleccion[g.id] ?? [])) {
        if (stockMap[op.producto_id]?.viable === false) return true;
      }
    }
    return false;
  }, [grupos, seleccion, stockMap]);

  const addOpcion = (grupo: Grupo, opcion: Opcion) => {
    const stockInfo = stockMap[opcion.producto_id];
    if (stockInfo && !stockInfo.viable) {
      toast.error(stockInfo.motivo || `Sin stock suficiente para "${opcion.nombre_producto}"`);
      return;
    }
    setSeleccion(prev => {
      const actuales = prev[grupo.id] ?? [];
      if (actuales.length >= grupo.cantidad_incluida) {
        toast.info(`Solo puedes elegir ${grupo.cantidad_incluida} opción(es) en "${grupo.nombre_grupo}"`);
        return prev;
      }
      return { ...prev, [grupo.id]: [...actuales, opcion] };
    });
  };


  const removeOpcionAt = (grupoId: string, idx: number) => {
    setSeleccion(prev => {
      const actuales = [...(prev[grupoId] ?? [])];
      actuales.splice(idx, 1);
      return { ...prev, [grupoId]: actuales };
    });
  };

  const handleConfirm = () => {
    if (!paquete) return;
    if (!completo) {
      toast.error('Completa todas las opciones obligatorias');
      return;
    }
    const opciones: PaqueteOpcionSeleccionada[] = [];
    for (const g of grupos) {
      for (const op of (seleccion[g.id] ?? [])) {
        opciones.push({
          grupo_id: g.id,
          nombre_grupo: g.nombre_grupo,
          producto_id: op.producto_id,
          nombre_producto: op.nombre_producto,
          precio_adicional: op.precio_adicional,
        });
      }
    }
    onConfirm({ opciones, precioFinal: total });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            {paquete?.nombre ?? 'Paquete'}
          </DialogTitle>
          <DialogDescription>
            Elige las opciones incluidas para armar este paquete.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando opciones…
            </div>
          ) : grupos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Este paquete no tiene grupos configurados.
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {grupos.map(g => {
                const elegidas = seleccion[g.id] ?? [];
                const completo = elegidas.length === g.cantidad_incluida;
                const cumplido = g.es_obligatorio
                  ? elegidas.length === g.cantidad_incluida
                  : elegidas.length <= g.cantidad_incluida;
                return (
                  <Card key={g.id} className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm">{g.nombre_grupo}</h3>
                        {g.es_obligatorio
                          ? <Badge variant="default" className="text-[10px] h-5">Obligatorio</Badge>
                          : <Badge variant="outline" className="text-[10px] h-5">Opcional</Badge>}
                      </div>
                      <Badge
                        variant={cumplido ? 'secondary' : 'destructive'}
                        className="text-[10px] tabular-nums"
                      >
                        {elegidas.length} / {g.cantidad_incluida}
                      </Badge>
                    </div>

                    {elegidas.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {elegidas.map((op, idx) => (
                          <Badge
                            key={`${op.id}-${idx}`}
                            variant="secondary"
                            className="gap-1 pl-2 pr-1 py-1 text-xs"
                          >
                            {op.nombre_producto}
                            {op.precio_adicional > 0 && (
                              <span className="opacity-70">+${op.precio_adicional.toFixed(2)}</span>
                            )}
                            <button
                              type="button"
                              onClick={() => removeOpcionAt(g.id, idx)}
                              className="ml-0.5 rounded-sm hover:bg-background p-0.5"
                              aria-label="Quitar"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {g.opciones.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic col-span-full">
                          Sin opciones disponibles
                        </p>
                      ) : g.opciones.map(op => (
                        <button
                          key={op.id}
                          type="button"
                          disabled={completo}
                          onClick={() => addOpcion(g, op)}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-left transition',
                            'hover:border-primary hover:bg-primary/5 active:scale-[0.98]',
                            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-card'
                          )}
                        >
                          <span className="text-sm font-medium leading-tight truncate">
                            {op.nombre_producto}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {op.precio_adicional > 0 && (
                              <span className="text-xs font-semibold text-primary tabular-nums">
                                +${op.precio_adicional.toFixed(2)}
                              </span>
                            )}
                            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="p-6 pt-3 border-t flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="text-sm">
            <div className="text-muted-foreground text-xs">
              Base ${(paquete?.precio_venta ?? 0).toFixed(2)}
              {extras > 0 && <> + Extras ${extras.toFixed(2)}</>}
            </div>
            <div className="font-bold text-lg text-primary tabular-nums">
              Total ${total.toFixed(2)}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={loading || !completo || grupos.length === 0}>
              Agregar al ticket
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
