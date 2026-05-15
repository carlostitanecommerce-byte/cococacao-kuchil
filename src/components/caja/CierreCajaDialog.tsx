import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Loader2, Calculator, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { CajaSession, MovimientoCaja } from '@/hooks/useCajaSession';
import { nowCDMX } from '@/lib/utils';

interface VentaPorUsuario {
  usuario_id: string;
  nombre: string;
  total: number;
  count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  caja: CajaSession;
  movimientos: MovimientoCaja[];
  onCerrarCaja: (montoCierre: number, notasCierre?: string) => Promise<{ error: string | null; esperado?: number; diferencia?: number }>;
}

export function CierreCajaDialog({ open, onClose, caja, movimientos, onCerrarCaja }: Props) {
  const [montoContado, setMontoContado] = useState('');
  const [notasCierre, setNotasCierre] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resultEsperado, setResultEsperado] = useState<number | null>(null);
  const [resultDiferencia, setResultDiferencia] = useState<number | null>(null);
  const [confirmCierreOpen, setConfirmCierreOpen] = useState(false);

  const [ventasEfectivo, setVentasEfectivo] = useState(0);
  const [ventasTarjeta, setVentasTarjeta] = useState(0);
  const [ventasTransferencia, setVentasTransferencia] = useState(0);
  const [totalVentas, setTotalVentas] = useState(0);
  const [totalIVA, setTotalIVA] = useState(0);
  const [totalComisiones, setTotalComisiones] = useState(0);
  const [ventasPorUsuario, setVentasPorUsuario] = useState<VentaPorUsuario[]>([]);
  const [sesionesActivas, setSesionesActivas] = useState<{ id: string; cliente_nombre: string }[]>([]);

  useEffect(() => {
    if (!open) {
      setSubmitted(false);
      setResultEsperado(null);
      setResultDiferencia(null);
      setMontoContado('');
      setNotasCierre('');
      return;
    }
    const fetchVentas = async () => {
      // Ventas vinculadas al turno actual + ventas legadas (sin caja_id) en el rango.
      const [{ data: linked }, { data: legacy }] = await Promise.all([
        supabase
          .from('ventas')
          .select('monto_efectivo, monto_tarjeta, monto_transferencia, total_neto, iva, comisiones_bancarias, usuario_id')
          .eq('estado', 'completada' as any)
          .eq('caja_id', caja.id),
        supabase
          .from('ventas')
          .select('monto_efectivo, monto_tarjeta, monto_transferencia, total_neto, iva, comisiones_bancarias, usuario_id')
          .eq('estado', 'completada' as any)
          .is('caja_id', null)
          .gte('fecha', caja.fecha_apertura)
          .lte('fecha', nowCDMX()),
      ]);
      const data = [...(linked ?? []), ...(legacy ?? [])];
      if (data) {
        setVentasEfectivo(data.reduce((s, v) => s + (v.monto_efectivo ?? 0), 0));
        setVentasTarjeta(data.reduce((s, v) => s + (v.monto_tarjeta ?? 0), 0));
        setVentasTransferencia(data.reduce((s, v) => s + (v.monto_transferencia ?? 0), 0));
        setTotalVentas(data.reduce((s, v) => s + (v.total_neto ?? 0), 0));
        setTotalIVA(data.reduce((s, v) => s + (v.iva ?? 0), 0));
        setTotalComisiones(data.reduce((s, v) => s + (v.comisiones_bancarias ?? 0), 0));

        // Group by user
        const byUser: Record<string, { total: number; count: number }> = {};
        data.forEach(v => {
          if (!byUser[v.usuario_id]) byUser[v.usuario_id] = { total: 0, count: 0 };
          byUser[v.usuario_id].total += v.total_neto ?? 0;
          byUser[v.usuario_id].count += 1;
        });

        // Fetch names
        const userIds = Object.keys(byUser);
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, nombre')
            .in('id', userIds);

          const profileMap: Record<string, string> = {};
          (profiles ?? []).forEach(p => { profileMap[p.id] = p.nombre; });

          setVentasPorUsuario(
            userIds.map(uid => ({
              usuario_id: uid,
              nombre: profileMap[uid] ?? 'Desconocido',
              total: byUser[uid].total,
              count: byUser[uid].count,
            }))
          );
        } else {
          setVentasPorUsuario([]);
        }
      }
      // Sesiones coworking activas o pendientes de pago (advertencia)
      const { data: sesiones } = await supabase
        .from('coworking_sessions')
        .select('id, cliente_nombre, estado')
        .in('estado', ['activo', 'pendiente_pago'] as any);
      setSesionesActivas(((sesiones ?? []) as any).map((s: any) => ({ id: s.id, cliente_nombre: s.cliente_nombre })));
    };
    fetchVentas();
  }, [open, caja.fecha_apertura]);

  const totalEntradas = movimientos.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0);
  const totalSalidas = movimientos.filter(m => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0);
  const contado = parseFloat(montoContado) || 0;

  const ejecutarCierre = async () => {
    setConfirmCierreOpen(false);
    setSaving(true);
    const result = await onCerrarCaja(contado, notasCierre.trim() || undefined);
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      setResultEsperado(result.esperado ?? 0);
      setResultDiferencia(result.diferencia ?? 0);
      setSubmitted(true);
      toast.success('Caja cerrada exitosamente');
    }
  };

  const handleSubmit = () => {
    if (!montoContado || isNaN(parseFloat(montoContado))) {
      toast.error('Ingresa el monto contado');
      return;
    }
    if (sesionesActivas.length > 0) {
      setConfirmCierreOpen(true);
      return;
    }
    void ejecutarCierre();
  };

  // Post-submit result view
  if (submitted && resultEsperado !== null) {
    return (
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" />
              Resultado del Corte Z
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="font-semibold text-xs uppercase text-muted-foreground">Ventas del turno</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Total ventas:</span>
                <span className="text-right font-medium">${totalVentas.toFixed(2)}</span>
                <span className="text-muted-foreground">Efectivo:</span>
                <span className="text-right">${ventasEfectivo.toFixed(2)}</span>
                <span className="text-muted-foreground">Tarjeta:</span>
                <span className="text-right">${ventasTarjeta.toFixed(2)}</span>
                <span className="text-muted-foreground">Transferencia:</span>
                <span className="text-right">${ventasTransferencia.toFixed(2)}</span>
              </div>
            </div>

            <Separator />

            <div className="space-y-1">
              <p className="font-semibold text-xs uppercase text-muted-foreground">Impuestos y comisiones</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-muted-foreground">IVA recaudado:</span>
                <span className="text-right">${totalIVA.toFixed(2)}</span>
                <span className="text-muted-foreground">Comisiones bancarias:</span>
                <span className="text-right">${totalComisiones.toFixed(2)}</span>
              </div>
            </div>

            {ventasPorUsuario.length > 0 && (
              <>
                <Separator />
                <div className="space-y-1">
                  <p className="font-semibold text-xs uppercase text-muted-foreground">Ventas por usuario</p>
                  {ventasPorUsuario.map(vu => (
                    <div key={vu.usuario_id} className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">{vu.nombre} ({vu.count} ventas):</span>
                      <span className="text-right">${vu.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-2">
              <div className="flex justify-between font-bold">
                <span>Efectivo esperado:</span>
                <span className="text-primary">${resultEsperado.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Efectivo contado:</span>
                <span>${contado.toFixed(2)}</span>
              </div>
            </div>

            <div className={`p-3 rounded-md border ${Math.abs(resultDiferencia!) < 0.01 ? 'bg-primary/5 border-primary' : 'bg-destructive/5 border-destructive'}`}>
              <div className="flex justify-between font-bold">
                <span>Diferencia:</span>
                <span className={Math.abs(resultDiferencia!) < 0.01 ? 'text-primary' : 'text-destructive'}>
                  {resultDiferencia! >= 0 ? '+' : ''}{resultDiferencia!.toFixed(2)}
                </span>
              </div>
              {Math.abs(resultDiferencia!) >= 0.01 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {resultDiferencia! > 0 ? 'Hay más efectivo del esperado (sobrante)' : 'Hay menos efectivo del esperado (faltante)'}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={onClose} className="w-full">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Arqueo ciego: only show input, no expected value
  return (
    <Dialog open={open} onOpenChange={v => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Cierre de Caja (Corte Z)
          </DialogTitle>
          <DialogDescription>Realiza el arqueo ciego: cuenta el efectivo físico en caja</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm max-h-[60vh] overflow-y-auto">
          {sesionesActivas.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
              <p className="font-semibold text-destructive">⚠️ {sesionesActivas.length} sesión(es) de coworking sin cobrar</p>
              <ul className="text-muted-foreground list-disc list-inside">
                {sesionesActivas.slice(0, 5).map(s => (
                  <li key={s.id}>{s.cliente_nombre}</li>
                ))}
                {sesionesActivas.length > 5 && <li>…y {sesionesActivas.length - 5} más</li>}
              </ul>
              <p className="text-muted-foreground">Si cierras ahora, quedarán pendientes para el siguiente turno.</p>
            </div>
          )}
          <div className="space-y-1">
            <p className="font-semibold text-xs uppercase text-muted-foreground">Movimientos de caja</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-muted-foreground">Fondo fijo:</span>
              <span className="text-right">${caja.monto_apertura.toFixed(2)}</span>
              <span className="text-muted-foreground">Entradas manuales:</span>
              <span className="text-right">${totalEntradas.toFixed(2)}</span>
              <span className="text-muted-foreground">Salidas manuales:</span>
              <span className="text-right text-destructive">-${totalSalidas.toFixed(2)}</span>
            </div>
          </div>

          <Separator />

          {/* Arqueo ciego — NO expected value shown */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <EyeOff className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="monto-contado" className="font-semibold">Efectivo contado (arqueo ciego)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Cuenta el efectivo físico en caja sin ver el monto esperado. El sistema calculará la diferencia automáticamente.
            </p>
            <Input
              id="monto-contado"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.00"
              value={montoContado}
              onChange={e => setMontoContado(e.target.value)}
              autoFocus
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="notas-cierre" className="font-semibold">Notas de Ajuste (opcional)</Label>
            <p className="text-xs text-muted-foreground">
              Registra observaciones sobre diferencias, billetes dañados, etc.
            </p>
            <textarea
              id="notas-cierre"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px] resize-y"
              placeholder="Ej: Billete de $500 dañado, sobrante de monedas..."
              value={notasCierre}
              onChange={e => setNotasCierre(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || !montoContado}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirmar Cierre
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmCierreOpen} onOpenChange={setConfirmCierreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sesiones de coworking sin cobrar</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Hay {sesionesActivas.length} sesión(es) sin cobrar:</p>
                <ul className="list-disc list-inside text-muted-foreground max-h-40 overflow-y-auto">
                  {sesionesActivas.slice(0, 10).map(s => (
                    <li key={s.id}>{s.cliente_nombre}</li>
                  ))}
                  {sesionesActivas.length > 10 && <li>…y {sesionesActivas.length - 10} más</li>}
                </ul>
                <p>Si cierras ahora, estas sesiones quedarán pendientes para el siguiente turno.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={ejecutarCierre} disabled={saving}>
              Cerrar caja de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
