import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, Inbox, Plus, Clock, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useCajaCartStore } from '@/stores/cartStore';
import type { CartItem } from '@/components/pos/types';

interface OrdenPendiente {
  id: string;
  folio: number;
  cliente_nombre: string | null;
  items: CartItem[];
  total: number;
  created_at: string;
  usuario_id: string;
  usuario_nombre?: string;
}

interface Props {
  onImport: (orden: OrdenPendiente) => void;
}

export function OrdenesPosSelector({ onImport }: Props) {
  const cartItemCount = useCajaCartStore((s) => s.items.length);
  const ordenPendienteId = useCajaCartStore((s) => s.ordenPendienteId);

  const [ordenes, setOrdenes] = useState<OrdenPendiente[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [blockedFor, setBlockedFor] = useState<OrdenPendiente | null>(null);

  const fetchOrdenes = async () => {
    try {
      const { data, error } = await supabase
        .from('ordenes_pos_pendientes')
        .select('id, folio, cliente_nombre, items, total, created_at, usuario_id')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const userIds = [...new Set(rows.map((r) => r.usuario_id).filter(Boolean))];
      let nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, nombre')
          .in('id', userIds);
        nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.nombre]));
      }

      setOrdenes(
        rows.map((r) => ({
          id: r.id,
          folio: r.folio,
          cliente_nombre: r.cliente_nombre,
          items: Array.isArray(r.items) ? (r.items as CartItem[]) : [],
          total: Number(r.total) || 0,
          created_at: r.created_at,
          usuario_id: r.usuario_id,
          usuario_nombre: nameMap.get(r.usuario_id),
        }))
      );
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron cargar las órdenes pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrdenes();
    const channel = supabase
      .channel('ordenes-pos-pendientes-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ordenes_pos_pendientes' },
        () => fetchOrdenes()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleClick = (orden: OrdenPendiente) => {
    if (cartItemCount > 0 && ordenPendienteId !== orden.id) {
      setBlockedFor(orden);
      return;
    }
    onImport(orden);
  };

  const filtered = ordenes.filter((o) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (o.cliente_nombre ?? '').toLowerCase().includes(q) ||
      String(o.folio).padStart(4, '0').includes(q)
    );
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          Órdenes POS Pendientes
          {ordenes.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {ordenes.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente o folio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Cargando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Sin órdenes pendientes en cola
          </p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {filtered.map((o) => {
              const isImported = ordenPendienteId === o.id;
              const folioStr = String(o.folio).padStart(4, '0');
              const elapsed = formatDistanceToNow(new Date(o.created_at), {
                locale: es,
                addSuffix: false,
              });
              const itemCount = o.items.reduce((sum, it) => sum + (it.cantidad ?? 0), 0);
              return (
                <div
                  key={o.id}
                  className={`flex items-center justify-between p-2 rounded-md border text-sm ${
                    isImported ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      <span className="font-mono text-xs text-muted-foreground mr-1">#{folioStr}</span>
                      {o.cliente_nombre || 'Sin nombre'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1 h-4">
                        {itemCount} item{itemCount !== 1 ? 's' : ''}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {elapsed}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-foreground/80">
                        <Wallet className="h-3 w-3" />${o.total.toFixed(2)}
                      </span>
                      {o.usuario_nombre && (
                        <Badge variant="outline" className="text-[10px] px-1 h-4">
                          {o.usuario_nombre}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isImported ? 'secondary' : 'default'}
                    className="h-7 text-xs"
                    disabled={isImported}
                    onClick={() => handleClick(o)}
                  >
                    {isImported ? 'Importado' : <><Plus className="h-3 w-3 mr-1" /> Importar</>}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!blockedFor} onOpenChange={(o) => !o && setBlockedFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tienes un ticket en progreso</AlertDialogTitle>
            <AlertDialogDescription>
              Cóbralo o presiona "Limpiar" antes de importar la orden{' '}
              <span className="font-mono">#{blockedFor && String(blockedFor.folio).padStart(4, '0')}</span>
              {blockedFor?.cliente_nombre ? ` de ${blockedFor.cliente_nombre}` : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBlockedFor(null)}>Entendido</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export type { OrdenPendiente };
