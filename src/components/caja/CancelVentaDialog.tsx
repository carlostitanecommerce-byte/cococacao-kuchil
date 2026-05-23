import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Send, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { ejecutarCancelacionVenta } from '@/lib/cancelacionVentaUtils';

interface VentaBasic {
  id: string;
  total_bruto: number;
  total_neto: number;
  monto_propina: number;
  metodo_pago: string;
  fecha: string;
  coworking_session_id: string | null;
}

interface Props {
  venta: VentaBasic | null;
  isAdmin: boolean;
  cajaEstado?: 'abierta' | 'cerrada';
  cajaFolio?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

const MIN_MOTIVO_POST_CIERRE = 10;

export function CancelVentaDialog({ venta, isAdmin, cajaEstado, cajaFolio, onClose, onSuccess }: Props) {
  const { user, profile } = useAuth();
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  if (!venta) return null;

  const esPostCierre = isAdmin && cajaEstado === 'cerrada';
  const motivoValido = esPostCierre
    ? motivo.trim().length >= MIN_MOTIVO_POST_CIERRE
    : motivo.trim().length > 0;

  const handleClose = () => {
    setMotivo('');
    onClose();
  };

  // Monto cobrado al cliente (lo que se le va a "devolver" / cancelar a sus ojos).
  const montoCobradoCliente = Number(venta.total_bruto) + Number(venta.monto_propina);

  const handleAdminCancel = async () => {
    if (!user || !motivoValido) return;
    setLoading(true);
    try {
      const res = await ejecutarCancelacionVenta({
        ventaId: venta.id,
        total: montoCobradoCliente,
        motivo: motivo.trim(),
        coworkingSessionId: venta.coworking_session_id,
        userId: user.id,
        actorNombre: profile?.nombre,
        postCierre: esPostCierre,
        cajaFolio: cajaFolio ?? null,
      });

      const detalles: string[] = [];
      if (res.lineasOpenAccountReabiertas > 0) detalles.push(`${res.lineasOpenAccountReabiertas} consumos reabiertos`);
      if (res.stockRevertido) detalles.push('stock restituido');
      if (res.kdsCanceladas > 0) detalles.push(`${res.kdsCanceladas} órdenes de cocina canceladas`);
      if (res.coworkingRevertida) detalles.push('sesión coworking reactivada');

      toast.success(
        esPostCierre ? 'Corrección post-cierre registrada' : 'Venta cancelada exitosamente',
        detalles.length > 0 ? { description: detalles.join(' · ') } : undefined,
      );
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
        descripcion: `Solicitud de cancelación enviada para venta $${montoCobradoCliente.toFixed(2)}. Motivo: ${motivo.trim()}`,
        metadata: {
          venta_id: venta.id,
          total: montoCobradoCliente,
          total_bruto: venta.total_bruto,
          total_neto: venta.total_neto,
          monto_propina: venta.monto_propina,
        },
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
            {isAdmin ? (esPostCierre ? 'Corrección post-cierre' : 'Cancelar Venta') : 'Solicitar Cancelación'}
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? (esPostCierre
                ? 'Esta venta pertenece a un turno ya cerrado.'
                : 'Esta acción cancelará la venta de forma inmediata.')
              : 'Se enviará una solicitud al administrador para su aprobación.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {esPostCierre && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs">
              <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-900 dark:text-amber-200">Turno cerrado{cajaFolio ? ` #${String(cajaFolio).padStart(4, '0')}` : ''}</p>
                <p className="text-amber-800 dark:text-amber-300">
                  El cambio afecta reportes históricos y se registrará como corrección post-cierre en la bitácora. El motivo debe tener al menos {MIN_MOTIVO_POST_CIERRE} caracteres.
                </p>
              </div>
            </div>
          )}

          <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total cobrado al cliente</span>
              <span className="font-bold">${montoCobradoCliente.toFixed(2)}</span>
            </div>
            {venta.monto_propina > 0 && (
              <p className="text-[11px] text-muted-foreground text-right">
                Incluye propina de ${Number(venta.monto_propina).toFixed(2)}
              </p>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha</span>
              <span>{new Date(venta.fecha).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', timeZone: 'America/Mexico_City' })}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo de cancelación *</Label>
            <Textarea
              id="motivo"
              placeholder={esPostCierre ? `Describe la corrección (mín. ${MIN_MOTIVO_POST_CIERRE} caracteres)...` : 'Describe el motivo de la cancelación...'}
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
            />
            {esPostCierre && (
              <p className="text-[11px] text-muted-foreground text-right">{motivo.trim().length}/{MIN_MOTIVO_POST_CIERRE} mín.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cerrar</Button>
          {isAdmin ? (
            <Button variant="destructive" onClick={handleAdminCancel} disabled={loading || !motivoValido}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {esPostCierre ? 'Registrar Corrección' : 'Confirmar Cancelación'}
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
