import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, XCircle, Loader2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface SolicitudMovimiento {
  id: string;
  caja_id: string;
  solicitante_id: string;
  tipo: 'entrada' | 'salida';
  monto: number;
  motivo: string;
  estado: string;
  created_at: string;
  solicitante_nombre?: string;
}

export function SolicitudesMovimientoPanel() {
  const [solicitudes, setSolicitudes] = useState<SolicitudMovimiento[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SolicitudMovimiento | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');

  const fetchSolicitudes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('solicitudes_movimiento_caja' as any)
      .select('*')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false });

    const items = (data ?? []) as any[];
    if (items.length === 0) { setSolicitudes([]); setLoading(false); return; }

    const ids = [...new Set(items.map(s => s.solicitante_id))];
    const { data: profiles } = await supabase.from('profiles').select('id, nombre').in('id', ids);
    const map = new Map((profiles ?? []).map(p => [p.id, p.nombre]));

    setSolicitudes(items.map(s => ({ ...s, solicitante_nombre: map.get(s.solicitante_id) ?? 'Desconocido' })));
    setLoading(false);
  };

  useEffect(() => {
    fetchSolicitudes();
    const ch = supabase
      .channel('solicitudes_movimiento_caja_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_movimiento_caja' }, () => fetchSolicitudes())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleApprove = async (s: SolicitudMovimiento) => {
    setProcessingId(s.id);
    const { error } = await supabase.rpc('aprobar_movimiento_caja' as any, { p_solicitud_id: s.id });
    setProcessingId(null);
    if (error) toast.error(error.message);
    else { toast.success('Movimiento aprobado'); fetchSolicitudes(); }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    setProcessingId(rejecting.id);
    const { error } = await supabase.rpc('rechazar_movimiento_caja' as any, {
      p_solicitud_id: rejecting.id,
      p_motivo: motivoRechazo.trim() || null,
    });
    setProcessingId(null);
    if (error) toast.error(error.message);
    else {
      toast.success('Solicitud rechazada');
      setRejecting(null); setMotivoRechazo(''); fetchSolicitudes();
    }
  };

  if (solicitudes.length === 0 && !loading) return null;

  return (
    <>
      <Card className="border-amber-500/40">
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4 text-amber-600" />
            Solicitudes de Movimiento de Caja
            <Badge variant="secondary" className="ml-auto">{solicitudes.length}</Badge>
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
                    <p className="font-medium flex items-center gap-1.5">
                      {s.tipo === 'entrada'
                        ? <ArrowUpCircle className="h-4 w-4 text-primary" />
                        : <ArrowDownCircle className="h-4 w-4 text-destructive" />}
                      {s.tipo === 'entrada' ? 'Entrada' : 'Salida'} ${Number(s.monto).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(s.created_at), "d MMM, HH:mm", { locale: es })} · Solicitó: <span className="font-medium text-foreground">{s.solicitante_nombre}</span>
                    </p>
                    <p className="text-xs">Motivo: {s.motivo}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="text-primary border-primary/30"
                      onClick={() => handleApprove(s)} disabled={processingId === s.id}>
                      {processingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Aprobar
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30"
                      onClick={() => setRejecting(s)} disabled={processingId === s.id}>
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

      <Dialog open={!!rejecting} onOpenChange={() => { if (!processingId) { setRejecting(null); setMotivoRechazo(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rechazar Solicitud</DialogTitle>
            <DialogDescription>Opcionalmente indica el motivo del rechazo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo de rechazo (opcional)</Label>
            <Textarea value={motivoRechazo} onChange={e => setMotivoRechazo(e.target.value)} rows={2} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejecting(null); setMotivoRechazo(''); }} disabled={!!processingId}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!!processingId}>
              {processingId && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar Rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
