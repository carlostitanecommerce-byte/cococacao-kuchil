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
import { Search, Inbox, Plus, Clock, Wallet, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { useCajaCartStore } from '@/stores/cartStore';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
  const { user, session, roles } = useAuth();
  const puedeCancelar =
    roles.includes('administrador') ||
    roles.includes('supervisor') ||
    roles.includes('caja') ||
    roles.includes('recepcion');

  const cartItemCount = useCajaCartStore((s) => s.items.length);
  const ordenPendienteId = useCajaCartStore((s) => s.ordenPendienteId);
  const clearCart = useCajaCartStore((s) => s.clear);

  const [ordenes, setOrdenes] = useState<OrdenPendiente[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [blockedFor, setBlockedFor] = useState<OrdenPendiente | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OrdenPendiente | null>(null);
  const [motivo, setMotivo] = useState('');
  const [cancelling, setCancelling] = useState(false);

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
    if (!session) return;
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
  }, [session]);

  const handleClick = (orden: OrdenPendiente) => {
    if (cartItemCount > 0 && ordenPendienteId !== orden.id) {
      setBlockedFor(orden);
      return;
    }
    onImport(orden);
  };

  const handleCancelConfirm = async () => {
    if (!cancelTarget || !user) return;
    if (!motivo.trim()) {
      toast.error('Especifica el motivo de la cancelación');
      return;
    }
    setCancelling(true);
    try {
      const { error } = await supabase
        .from('ordenes_pos_pendientes')
        .update({
          estado: 'cancelada' as any,
          cancelada_por: user.id,
          motivo_cancelacion: motivo.trim(),
        })
        .eq('id', cancelTarget.id);

      if (error) throw error;

      // Audit log
      const folioStr = String(cancelTarget.folio).padStart(4, '0');
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'cancelar_orden_pendiente_pos',
        descripcion: `Orden POS Pendiente cancelada - Folio: #${folioStr} - Cliente: ${cancelTarget.cliente_nombre || 'Sin nombre'} - Motivo: ${motivo.trim()}`,
        metadata: {
          orden_id: cancelTarget.id,
          folio: cancelTarget.folio,
          cliente_nombre: cancelTarget.cliente_nombre,
          total: cancelTarget.total,
          motivo: motivo.trim(),
        },
      });

      // Si está cargada en el carrito activo de Caja, la des-importamos
      if (ordenPendienteId === cancelTarget.id) {
        clearCart();
        toast.info('La orden cargada en el carrito activo fue cancelada.');
      }

      toast.success(`Orden #${folioStr} cancelada con éxito`);
      setCancelTarget(null);
      setMotivo('');
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo cancelar la orden');
    } finally {
      setCancelling(false);
    }
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
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    {puedeCancelar && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setCancelTarget(o)}
                        disabled={isImported}
                        title="Cancelar orden"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    )}
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

      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o && !cancelling) { setCancelTarget(null); setMotivo(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              Cancelar Orden POS Pendiente
            </DialogTitle>
            <DialogDescription className="text-left">
              ¿Estás seguro de que deseas cancelar la orden{' '}
              <span className="font-mono font-semibold">
                #{cancelTarget && String(cancelTarget.folio).padStart(4, '0')}
              </span>
              {cancelTarget?.cliente_nombre ? ` de ${cancelTarget.cliente_nombre}` : ''}?
              Esta acción liberará la orden de la cola y no se podrá cobrar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="motivo-cancel-orden" className="text-sm font-medium">
              Motivo de cancelación <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="motivo-cancel-orden"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: Cliente canceló consumo, error al capturar, etc..."
              className="min-h-[80px]"
              maxLength={200}
              disabled={cancelling}
            />
            <p className="text-xs text-muted-foreground text-right">{motivo.length}/200</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCancelTarget(null); setMotivo(''); }}
              disabled={cancelling}
            >
              Regresar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelConfirm}
              disabled={!motivo.trim() || cancelling}
            >
              {cancelling ? 'Cancelando...' : 'Confirmar Cancelación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export type { OrdenPendiente };
