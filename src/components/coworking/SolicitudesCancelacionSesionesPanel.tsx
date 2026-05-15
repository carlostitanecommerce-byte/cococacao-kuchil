import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { CheckCircle2, XCircle, Bell, Loader2, Gift, Sparkles, Package } from 'lucide-react';
import { toast } from 'sonner';
import { nowCDMX } from '@/lib/utils';
import {
  fetchSessionUpsellsForCancel,
  cancelarSesionAtomico,
  type SessionUpsellRow,
  type EntregaItem,
} from './cancelacionUtils';

interface Solicitud {
  id: string;
  session_id: string;
  solicitante_id: string;
  motivo: string;
  estado: string;
  created_at: string;
  items_entregados?: EntregaItem[];
  solicitante_nombre?: string;
  cliente_nombre?: string;
  area_nombre?: string;
  pax_count?: number;
}

interface Props {
  onSessionCancelled?: () => void | Promise<void>;
}

interface EntregaState {
  entregado: boolean;
  cantidad: number;
}

export function SolicitudesCancelacionSesionesPanel({ onSessionCancelled }: Props) {
  const { user, profile } = useAuth();
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejecting, setRejecting] = useState<Solicitud | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [processing, setProcessing] = useState(false);

  // Aprobación con auditoría de entregas
  const [approving, setApproving] = useState<Solicitud | null>(null);
  const [approvalUpsells, setApprovalUpsells] = useState<SessionUpsellRow[]>([]);
  const [approvalEntregas, setApprovalEntregas] = useState<Record<string, EntregaState>>({});
  const [loadingApproval, setLoadingApproval] = useState(false);

  const fetchSolicitudes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('solicitudes_cancelacion_sesiones' as any)
      .select('*')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
      setSolicitudes([]);
      setLoading(false);
      return;
    }

    const items = data as any[];
    const sessionIds = [...new Set(items.map(s => s.session_id))];
    const solicitanteIds = [...new Set(items.map(s => s.solicitante_id))];

    const [sessionsRes, profilesRes] = await Promise.all([
      supabase
        .from('coworking_sessions')
        .select('id, cliente_nombre, area_id, pax_count')
        .in('id', sessionIds),
      supabase.from('profiles').select('id, nombre').in('id', solicitanteIds),
    ]);

    const sessionMap = new Map((sessionsRes.data ?? []).map(s => [s.id, s]));
    const profileMap = new Map((profilesRes.data ?? []).map(p => [p.id, p.nombre]));

    const areaIds = [...new Set((sessionsRes.data ?? []).map(s => s.area_id))];
    let areaMap = new Map<string, string>();
    if (areaIds.length > 0) {
      const { data: areasData } = await supabase
        .from('areas_coworking')
        .select('id, nombre_area')
        .in('id', areaIds);
      areaMap = new Map((areasData ?? []).map(a => [a.id, a.nombre_area]));
    }

    setSolicitudes(
      items.map(s => {
        const session = sessionMap.get(s.session_id);
        return {
          ...s,
          items_entregados: Array.isArray(s.items_entregados) ? s.items_entregados : [],
          solicitante_nombre: profileMap.get(s.solicitante_id) ?? 'Desconocido',
          cliente_nombre: session?.cliente_nombre ?? 'Desconocido',
          area_nombre: session ? areaMap.get(session.area_id) ?? 'Desconocida' : 'Desconocida',
          pax_count: session?.pax_count ?? 0,
        };
      }),
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchSolicitudes();

    const channel = supabase
      .channel('solicitudes_cancelacion_sesiones_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'solicitudes_cancelacion_sesiones' },
        () => fetchSolicitudes(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const openApproval = async (solicitud: Solicitud) => {
    setApproving(solicitud);
    setLoadingApproval(true);
    const rows = await fetchSessionUpsellsForCancel(solicitud.session_id);
    setApprovalUpsells(rows);

    // Pre-marcar lo que el operador declaró entregar
    const declarados = new Map<string, number>();
    for (const it of solicitud.items_entregados ?? []) {
      declarados.set(it.producto_id, (declarados.get(it.producto_id) ?? 0) + it.cantidad);
    }
    const initial: Record<string, EntregaState> = {};
    for (const r of rows) {
      const declCant = declarados.get(r.producto_id) ?? 0;
      initial[r.id] = {
        entregado: declCant > 0,
        cantidad: declCant > 0 ? Math.min(declCant, r.cantidad) : r.cantidad,
      };
    }
    setApprovalEntregas(initial);
    setLoadingApproval(false);
  };

  const closeApproval = () => {
    setApproving(null);
    setApprovalUpsells([]);
    setApprovalEntregas({});
  };

  const buildApprovalEntregados = (): EntregaItem[] => {
    const list: EntregaItem[] = [];
    for (const u of approvalUpsells) {
      const st = approvalEntregas[u.id];
      if (!st || !st.entregado) continue;
      const cant = Math.max(0, Math.min(st.cantidad, u.cantidad));
      if (cant <= 0) continue;
      list.push({ producto_id: u.producto_id, nombre: u.nombre, cantidad: cant });
    }
    return list;
  };

  const totalApprovalEntregados = useMemo(
    () => Object.values(approvalEntregas).filter(s => s.entregado && s.cantidad > 0).length,
    [approvalEntregas],
  );

  const handleConfirmApproval = async () => {
    if (!user || !approving) return;
    setProcessing(true);
    try {
      const entregadosFinal = buildApprovalEntregados();

      // Cancelación atómica vía RPC: aplica mermas + descuento + limpieza upsells +
      // estado sesión + cierre de solicitud + audit log en una sola transacción.
      const resumen = await cancelarSesionAtomico({
        sessionId: approving.session_id,
        motivo: approving.motivo,
        entregados: entregadosFinal,
        isAdmin: true,
        solicitudId: approving.id,
      });

      if (!resumen.ok) {
        throw new Error(resumen.error ?? 'No se pudo aprobar la cancelación');
      }

      toast.success(
        entregadosFinal.length > 0
          ? `Aprobada. ${resumen.mermasCreadas} merma(s) registrada(s).`
          : 'Aprobada. Sin descuento de inventario.',
      );
      closeApproval();
      fetchSolicitudes();
      await onSessionCancelled?.();
    } catch (err: any) {
      toast.error(err.message || 'Error al aprobar');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!user || !rejecting) return;
    setProcessing(true);
    try {
      await supabase.from('solicitudes_cancelacion_sesiones' as any).update({
        estado: 'rechazada',
        revisado_por: user.id,
        motivo_rechazo: motivoRechazo.trim() || null,
      }).eq('id', rejecting.id);

      await supabase.from('audit_logs').insert([{
        user_id: user.id,
        accion: 'rechazar_cancelacion_sesion',
        descripcion: `Cancelación rechazada por ${profile?.nombre ?? 'Admin'}. Cliente: ${rejecting.cliente_nombre}`,
        metadata: {
          solicitud_id: rejecting.id,
          session_id: rejecting.session_id,
          motivo_rechazo: motivoRechazo.trim(),
        } as any,
      }]);

      toast.success('Solicitud rechazada');
      setRejecting(null);
      setMotivoRechazo('');
      fetchSolicitudes();
    } catch (err: any) {
      toast.error(err.message || 'Error al rechazar');
    } finally {
      setProcessing(false);
    }
  };

  if (solicitudes.length === 0 && !loading) return null;

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4 text-destructive" />
            Solicitudes de Cancelación de Sesiones
            <Badge variant="destructive" className="ml-auto">{solicitudes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-2">Cargando...</p>
          ) : (
            solicitudes.map(s => (
              <div key={s.id} className="border rounded-md p-3 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="space-y-1 text-sm flex-1">
                    <p className="font-medium">{s.cliente_nombre} · {s.pax_count} pax</p>
                    <p className="text-xs text-muted-foreground">Área: {s.area_nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      Solicitó: <span className="font-medium text-foreground">{s.solicitante_nombre}</span>
                    </p>
                    <p className="text-xs">Motivo: {s.motivo}</p>
                    {(s.items_entregados?.length ?? 0) > 0 && (
                      <p className="text-xs flex items-center gap-1 mt-1">
                        <Package className="h-3 w-3 text-primary" />
                        <span className="text-muted-foreground">Declara entregar:</span>
                        <span className="font-medium">{s.items_entregados!.length} item(s)</span>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-primary border-primary/30"
                      onClick={() => openApproval(s)}
                      disabled={processing}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Revisar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30"
                      onClick={() => setRejecting(s)}
                      disabled={processing}
                    >
                      <XCircle className="h-4 w-4" />
                      Rechazar
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Diálogo de aprobación con auditoría de entregas */}
      <Dialog open={!!approving} onOpenChange={open => { if (!open && !processing) closeApproval(); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Aprobar cancelación
            </DialogTitle>
            <DialogDescription className="text-left">
              Confirma qué se entregó al cliente antes de aprobar.
              Lo marcado se descontará del inventario como merma.
              {approving && (
                <span className="block mt-2 text-foreground/80">
                  Cliente: <span className="font-medium">{approving.cliente_nombre}</span> ·
                  Solicitó: <span className="font-medium">{approving.solicitante_nombre}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {loadingApproval ? (
              <p className="text-sm text-muted-foreground text-center py-4">Cargando...</p>
            ) : approvalUpsells.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                Esta sesión no tiene amenities ni productos asociados.
              </p>
            ) : (
              <>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Pre-marcado según lo que <span className="font-medium text-foreground">declaró el operador</span>.
                  Ajusta si tienes información distinta.
                </div>

                <div className="space-y-2">
                  {approvalUpsells.map(u => {
                    const st = approvalEntregas[u.id] ?? { entregado: false, cantidad: u.cantidad };
                    return (
                      <div
                        key={u.id}
                        className="flex items-center gap-3 rounded-md border border-border/60 bg-background p-3"
                      >
                        <div className="shrink-0">
                          {u.isAmenity ? (
                            <Gift className="h-4 w-4 text-primary" />
                          ) : (
                            <Sparkles className="h-4 w-4 text-accent-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{u.nombre}</span>
                            <span className="text-xs text-muted-foreground">
                              {u.isAmenity ? 'Amenity' : `$${u.precio_especial.toFixed(2)}`} · solicitado ×{u.cantidad}
                            </span>
                          </div>
                          {st.entregado && (
                            <div className="flex items-center gap-2 mt-2">
                              <Label htmlFor={`appqty-${u.id}`} className="text-xs text-muted-foreground">
                                Cantidad entregada:
                              </Label>
                              <Input
                                id={`appqty-${u.id}`}
                                type="number"
                                min={1}
                                max={u.cantidad}
                                value={st.cantidad}
                                onChange={e =>
                                  setApprovalEntregas(prev => ({
                                    ...prev,
                                    [u.id]: {
                                      ...prev[u.id],
                                      cantidad: Math.max(1, Math.min(u.cantidad, parseInt(e.target.value, 10) || 1)),
                                    },
                                  }))
                                }
                                className="h-7 w-20 text-xs"
                              />
                              <span className="text-xs text-muted-foreground">/ {u.cantidad}</span>
                            </div>
                          )}
                        </div>
                        <Switch
                          checked={st.entregado}
                          onCheckedChange={checked =>
                            setApprovalEntregas(prev => ({
                              ...prev,
                              [u.id]: {
                                entregado: checked,
                                cantidad: prev[u.id]?.cantidad ?? u.cantidad,
                              },
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                  <Package className="h-3.5 w-3.5" />
                  <span>
                    {totalApprovalEntregados} de {approvalUpsells.length} marcados como entregados
                  </span>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeApproval} disabled={processing}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmApproval} disabled={processing || loadingApproval}>
              {processing && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Aprobar y cancelar sesión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de rechazo */}
      <Dialog
        open={!!rejecting}
        onOpenChange={() => {
          if (!processing) {
            setRejecting(null);
            setMotivoRechazo('');
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rechazar Solicitud</DialogTitle>
            <DialogDescription>Opcionalmente indica el motivo del rechazo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo de rechazo (opcional)</Label>
            <Textarea
              value={motivoRechazo}
              onChange={e => setMotivoRechazo(e.target.value)}
              placeholder="Motivo..."
              rows={2}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejecting(null);
                setMotivoRechazo('');
              }}
              disabled={processing}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={processing}>
              {processing && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar Rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
