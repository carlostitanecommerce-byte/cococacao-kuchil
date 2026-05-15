import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface VentaBasic {
  id: string;
  total_neto: number;
  metodo_pago: string;
  fecha: string;
  coworking_session_id: string | null;
}

interface Props {
  venta: VentaBasic | null;
  isAdmin: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CancelVentaDialog({ venta, isAdmin, onClose, onSuccess }: Props) {
  const { user, profile } = useAuth();
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  if (!venta) return null;

  const handleClose = () => {
    setMotivo('');
    onClose();
  };

  const handleAdminCancel = async () => {
    if (!user || !motivo.trim()) return;
    setLoading(true);
    try {
      // 1. Update venta
      const { error } = await supabase.from('ventas').update({
        estado: 'cancelada' as any,
        motivo_cancelacion: motivo.trim(),
      }).eq('id', venta.id);
      if (error) throw error;

      // 2. Revert coworking session if linked
      if (venta.coworking_session_id) {
        await supabase.from('coworking_sessions').update({
          estado: 'pendiente_pago' as any,
          fecha_salida_real: null,
        }).eq('id', venta.coworking_session_id);
      }

      // 3. Audit log
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'cancelar_venta',
        descripcion: `Venta $${venta.total_neto.toFixed(2)} cancelada por ${profile?.nombre ?? 'Admin'}. Motivo: ${motivo.trim()}`,
        metadata: { venta_id: venta.id, total: venta.total_neto, motivo: motivo.trim() },
      });

      toast.success('Venta cancelada exitosamente');
      setMotivo('');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Error al cancelar la venta');
    } finally {
      setLoading(false);
    }
  };

  const handleSendRequest = async () => {
    if (!user || !motivo.trim()) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('solicitudes_cancelacion' as any).insert({
        venta_id: venta.id,
        solicitante_id: user.id,
        motivo: motivo.trim(),
      });
      if (error) throw error;

      // Audit log
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'solicitud_cancelacion',
        descripcion: `Solicitud de cancelación enviada para venta $${venta.total_neto.toFixed(2)}. Motivo: ${motivo.trim()}`,
        metadata: { venta_id: venta.id, total: venta.total_neto },
      });

      toast.success('Solicitud de cancelación enviada al administrador');
      setMotivo('');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Error al enviar la solicitud');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!venta} onOpenChange={() => !loading && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {isAdmin ? 'Cancelar Venta' : 'Solicitar Cancelación'}
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? 'Esta acción cancelará la venta de forma inmediata.'
              : 'Se enviará una solicitud al administrador para su aprobación.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold">${venta.total_neto.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha</span>
              <span>{new Date(venta.fecha).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo de cancelación *</Label>
            <Textarea
              id="motivo"
              placeholder="Describe el motivo de la cancelación..."
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cerrar</Button>
          {isAdmin ? (
            <Button variant="destructive" onClick={handleAdminCancel} disabled={loading || !motivo.trim()}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar Cancelación
            </Button>
          ) : (
            <Button onClick={handleSendRequest} disabled={loading || !motivo.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar Solicitud
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
