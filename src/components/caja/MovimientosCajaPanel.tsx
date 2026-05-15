import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowUpCircle, ArrowDownCircle, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import type { MovimientoCaja } from '@/hooks/useCajaSession';

interface Props {
  movimientos: MovimientoCaja[];
  onRegistrar: (tipo: 'entrada' | 'salida', monto: number, motivo: string) => Promise<{ error: string | null }>;
}

export function MovimientosCajaPanel({ movimientos, onRegistrar }: Props) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<'entrada' | 'salida'>('salida');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const totalEntradas = movimientos.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0);
  const totalSalidas = movimientos.filter(m => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0);

  const handleSubmit = async () => {
    const val = parseFloat(monto);
    if (isNaN(val) || val <= 0) { toast.error('Ingresa un monto válido'); return; }
    if (!motivo.trim()) { toast.error('Ingresa un motivo'); return; }

    setSaving(true);
    const { error } = await onRegistrar(tipo, val, motivo.trim());
    setSaving(false);
    if (error) {
      toast.error(error);
    } else {
      toast.success(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada`);
      setMonto('');
      setMotivo('');
      setOpen(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1">
          <Receipt className="h-4 w-4" />
          Movimientos
        </Button>
        <span className="text-xs text-muted-foreground">
          E: +${totalEntradas.toFixed(2)} | S: -${totalSalidas.toFixed(2)}
        </span>
      </div>

      <Dialog open={open} onOpenChange={v => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Movimiento de Caja</DialogTitle>
            <DialogDescription>Entradas o salidas manuales de efectivo</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de movimiento</Label>
              <Select value={tipo} onValueChange={v => setTipo(v as 'entrada' | 'salida')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">
                    <span className="flex items-center gap-2"><ArrowUpCircle className="h-4 w-4 text-primary" /> Entrada</span>
                  </SelectItem>
                  <SelectItem value="salida">
                    <span className="flex items-center gap-2"><ArrowDownCircle className="h-4 w-4 text-destructive" /> Salida</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Monto ($)</Label>
              <Input type="number" min={0} step={0.01} placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input placeholder="Ej: Pago de hielo, Cambio de monedas..." value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={200} />
            </div>

            {/* Recent movements list */}
            {movimientos.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Movimientos del turno</p>
                {movimientos.map(m => (
                  <div key={m.id} className="flex items-center justify-between text-xs p-1.5 rounded border border-border">
                    <div className="flex items-center gap-1.5">
                      {m.tipo === 'entrada'
                        ? <ArrowUpCircle className="h-3 w-3 text-primary shrink-0" />
                        : <ArrowDownCircle className="h-3 w-3 text-destructive shrink-0" />}
                      <span className="truncate max-w-[180px]">{m.motivo}</span>
                    </div>
                    <span className={m.tipo === 'entrada' ? 'text-primary font-medium' : 'text-destructive font-medium'}>
                      {m.tipo === 'entrada' ? '+' : '-'}${m.monto.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
