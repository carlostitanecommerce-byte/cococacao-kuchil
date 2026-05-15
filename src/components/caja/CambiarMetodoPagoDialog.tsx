import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface VentaForEdit {
  id: string;
  total_neto: number;
  monto_propina: number;
  metodo_pago: string;
  monto_efectivo: number;
  monto_tarjeta: number;
  monto_transferencia: number;
  fecha: string;
}

interface Props {
  venta: VentaForEdit | null;
  onClose: () => void;
  onSuccess: () => void;
}

const METODOS: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

export function CambiarMetodoPagoDialog({ venta, onClose, onSuccess }: Props) {
  const { user, profile } = useAuth();
  const [nuevoMetodo, setNuevoMetodo] = useState('');
  const [montoEfectivo, setMontoEfectivo] = useState(0);
  const [montoTarjeta, setMontoTarjeta] = useState(0);
  const [montoTransferencia, setMontoTransferencia] = useState(0);
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  const totalVenta = venta ? venta.total_neto + venta.monto_propina : 0;

  useEffect(() => {
    if (venta) {
      setNuevoMetodo(venta.metodo_pago);
      setMontoEfectivo(venta.monto_efectivo);
      setMontoTarjeta(venta.monto_tarjeta);
      setMontoTransferencia(venta.monto_transferencia);
      setMotivo('');
    }
  }, [venta]);

  useEffect(() => {
    if (!venta || nuevoMetodo === 'mixto') return;
    if (nuevoMetodo === 'efectivo') {
      setMontoEfectivo(totalVenta);
      setMontoTarjeta(0);
      setMontoTransferencia(0);
    } else if (nuevoMetodo === 'tarjeta') {
      setMontoEfectivo(0);
      setMontoTarjeta(totalVenta);
      setMontoTransferencia(0);
    } else if (nuevoMetodo === 'transferencia') {
      setMontoEfectivo(0);
      setMontoTarjeta(0);
      setMontoTransferencia(totalVenta);
    }
  }, [nuevoMetodo, totalVenta, venta]);

  if (!venta) return null;

  const sumaMixto = montoEfectivo + montoTarjeta + montoTransferencia;
  const mixtoValido = nuevoMetodo !== 'mixto' || Math.abs(sumaMixto - totalVenta) < 0.01;
  const sinCambio = nuevoMetodo === venta.metodo_pago
    && montoEfectivo === venta.monto_efectivo
    && montoTarjeta === venta.monto_tarjeta
    && montoTransferencia === venta.monto_transferencia;
  const canSubmit = motivo.trim().length > 0 && mixtoValido && !sinCambio && !loading;

  const handleConfirm = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('ventas')
        .update({
          metodo_pago: nuevoMetodo as any,
          monto_efectivo: montoEfectivo,
          monto_tarjeta: montoTarjeta,
          monto_transferencia: montoTransferencia,
        })
        .eq('id', venta.id);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'cambio_metodo_pago',
        descripcion: `Cambio de método de pago por ${profile?.nombre ?? 'Admin'}`,
        metadata: {
          venta_id: venta.id,
          metodo_anterior: venta.metodo_pago,
          metodo_nuevo: nuevoMetodo,
          montos_anteriores: { efectivo: venta.monto_efectivo, tarjeta: venta.monto_tarjeta, transferencia: venta.monto_transferencia },
          montos_nuevos: { efectivo: montoEfectivo, tarjeta: montoTarjeta, transferencia: montoTransferencia },
          motivo: motivo.trim(),
        },
      });

      toast.success('Método de pago actualizado');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!venta} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar Método de Pago</DialogTitle>
          <DialogDescription>Modifica el método de pago de una venta ya procesada.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sale info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total de la venta:</span>
            <span className="font-semibold">${totalVenta.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Método actual:</span>
            <Badge variant="outline">{METODOS[venta.metodo_pago] ?? venta.metodo_pago}</Badge>
          </div>

          {/* New method */}
          <div className="space-y-1.5">
            <Label>Nuevo método de pago</Label>
            <Select value={nuevoMetodo} onValueChange={setNuevoMetodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(METODOS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mixed breakdown */}
          {nuevoMetodo === 'mixto' && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label className="text-xs text-muted-foreground">Desglose (debe sumar ${totalVenta.toFixed(2)})</Label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Efectivo</Label>
                  <Input type="number" min={0} step={0.01} value={montoEfectivo || ''} onChange={e => setMontoEfectivo(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">Tarjeta</Label>
                  <Input type="number" min={0} step={0.01} value={montoTarjeta || ''} onChange={e => setMontoTarjeta(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <Label className="text-xs">Transfer.</Label>
                  <Input type="number" min={0} step={0.01} value={montoTransferencia || ''} onChange={e => setMontoTransferencia(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              {!mixtoValido && (
                <p className="text-xs text-destructive">La suma (${sumaMixto.toFixed(2)}) no coincide con el total (${totalVenta.toFixed(2)})</p>
              )}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <Label>Motivo del cambio <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="Ej: El cliente pagó con tarjeta, no con efectivo"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!canSubmit}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirmar Cambio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
