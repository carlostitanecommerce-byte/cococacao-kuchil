import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Bell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ejecutarCancelacionVenta } from '@/lib/cancelacionVentaUtils';

interface Solicitud {
  id: string;
  venta_id: string;
  solicitante_id: string;
  motivo: string;
  estado: string;
  created_at: string;
  solicitante_nombre?: string;
  venta_total?: number;
  venta_fecha?: string;
}

export function SolicitudesCancelacionPanel() {
  const { user, profile } = useAuth();
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejecting, setRejecting] = useState<Solicitud | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchSolicitudes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('solicitudes_cancelacion' as any)
      .select('*')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
      setSolicitudes([]);
      setLoading(false);
      return;
    }

    const items = data as any[];

    // Resolve names and venta info
    const solicitanteIds = [...new Set(items.map(s => s.solicitante_id))];
    const ventaIds = [...new Set(items.map(s => s.venta_id))];

    const [profilesRes, ventasRes] = await Promise.all([
      supabase.from('profiles').select('id, nombre').in('id', solicitanteIds),
      supabase.from('ventas').select('id, total_bruto, total_neto, monto_propina, fecha').in('id', ventaIds),
    ]);

    const profileMap = new Map((profilesRes.data ?? []).map(p => [p.id, p.nombre]));
    const ventaMap = new Map((ventasRes.data ?? []).map(v => [v.id, v]));

    setSolicitudes(items.map(s => {
      const v = ventaMap.get(s.venta_id);
      // venta_total = monto cobrado al cliente (total_bruto + propina), no el neto del negocio.
      const cobrado = v ? Number(v.total_bruto ?? 0) + Number(v.monto_propina ?? 0) : 0;
      return {
        ...s,
        solicitante_nombre: profileMap.get(s.solicitante_id) ?? 'Desconocido',
        venta_total: cobrado,
        venta_fecha: v?.fecha,
      };
    }));
    setLoading(false);
  };

  useEffect(() => {
    fetchSolicitudes();

    // Realtime subscription
    const channel = supabase
      .channel('solicitudes_cancelacion_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_cancelacion' }, () => {
        fetchSolicitudes();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleApprove = async (solicitud: Solicitud) => {
    if (!user) return;
    setProcessing(true);
    try {
      // 1. Obtener datos completos de la venta (coworking + caja para detectar post-cierre)
      const { data: ventaData, error: ventaFetchErr } = await supabase
        .from('ventas')
        .select('id, total_bruto, total_neto, monto_propina, coworking_session_id, caja_id')
        .eq('id', solicitud.venta_id)
        .single();
      if (ventaFetchErr || !ventaData) throw ventaFetchErr || new Error('Venta no encontrada');

      let postCierre = false;
      let cajaFolio: number | null = null;
      if (ventaData.caja_id) {
        const { data: cajaData } = await supabase
          .from('cajas')
          .select('estado, folio')
          .eq('id', ventaData.caja_id)
          .maybeSingle();
        postCierre = cajaData?.estado === 'cerrada';
        cajaFolio = cajaData?.folio ?? null;
      }

      // 2. Ejecutar cancelación orquestada — `total` es el monto cobrado al cliente.
      const cobrado = Number(ventaData.total_bruto ?? 0) + Number(ventaData.monto_propina ?? 0);
      await ejecutarCancelacionVenta({
        ventaId: solicitud.venta_id,
        total: cobrado,
        motivo: solicitud.motivo,
        coworkingSessionId: ventaData.coworking_session_id ?? null,
        userId: user.id,
        actorNombre: profile?.nombre,
        postCierre,
        cajaFolio,
        solicitudId: solicitud.id,
        accionOverride: 'aprobar_cancelacion',
      });

      // 3. Marcar solicitud como aprobada
      await supabase.from('solicitudes_cancelacion' as any).update({
        estado: 'aprobada',
        revisado_por: user.id,
      }).eq('id', solicitud.id);

      toast.success('Cancelación aprobada');
      fetchSolicitudes();
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
      await supabase.from('solicitudes_cancelacion' as any).update({
        estado: 'rechazada',
        revisado_por: user.id,
        motivo_rechazo: motivoRechazo.trim() || null,
      }).eq('id', rejecting.id);

      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'rechazar_cancelacion',
        descripcion: `Cancelación rechazada por ${profile?.nombre ?? 'Admin'} para venta $${rejecting.venta_total?.toFixed(2)}`,
        metadata: { solicitud_id: rejecting.id, venta_id: rejecting.venta_id, motivo_rechazo: motivoRechazo.trim() },
      });

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
            Solicitudes de Cancelación Pendientes
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
                    <p className="font-medium">Venta: ${s.venta_total?.toFixed(2)}</p>
                    {s.venta_fecha && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.venta_fecha).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">Solicitó: <span className="font-medium text-foreground">{s.solicitante_nombre}</span></p>
                    <p className="text-xs">Motivo: {s.motivo}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="text-primary border-primary/30" onClick={() => handleApprove(s)} disabled={processing}>
                      <CheckCircle2 className="h-4 w-4" />
                      Aprobar
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => setRejecting(s)} disabled={processing}>
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

      <Dialog open={!!rejecting} onOpenChange={() => { if (!processing) { setRejecting(null); setMotivoRechazo(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rechazar Solicitud</DialogTitle>
            <DialogDescription>Opcionalmente indica el motivo del rechazo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo de rechazo (opcional)</Label>
            <Textarea value={motivoRechazo} onChange={e => setMotivoRechazo(e.target.value)} placeholder="Motivo..." rows={2} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejecting(null); setMotivoRechazo(''); }} disabled={processing}>Cancelar</Button>
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
