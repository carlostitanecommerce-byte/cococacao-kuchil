import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUpCircle, ArrowDownCircle, Loader2, Receipt, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { MovimientoCaja } from '@/hooks/useCajaSession';

interface Props {
  movimientos: MovimientoCaja[];
  onRegistrar: (tipo: 'entrada' | 'salida', monto: number, motivo: string) => Promise<{ error: string | null; pending?: boolean; umbral?: number }>;
  onReversar?: (movimientoId: string, motivo: string) => Promise<{ error: string | null }>;
}

export function MovimientosCajaPanel({ movimientos, onRegistrar, onReversar }: Props) {
  const { roles } = useAuth();
  const puedeReversar = roles.includes('administrador') || roles.includes('supervisor');

  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<'entrada' | 'salida'>('salida');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const [reversing, setReversing] = useState<MovimientoCaja | null>(null);
  const [motivoReverso, setMotivoReverso] = useState('');
  const [reversingLoading, setReversingLoading] = useState(false);

  const reversedIds = new Set(movimientos.filter(m => m.reversa_de).map(m => m.reversa_de!));

  // Totales netos (excluyendo movimientos reversados y sus reversos)
  const movimientosVigentes = movimientos.filter(m => !reversedIds.has(m.id) && !m.reversa_de);
  const totalEntradas = movimientosVigentes.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0);
  const totalSalidas = movimientosVigentes.filter(m => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0);

  const handleSubmit = async () => {
    const val = parseFloat(monto);
    if (isNaN(val) || val <= 0) { toast.error('Ingresa un monto válido'); return; }
    if (!motivo.trim()) { toast.error('Ingresa un motivo'); return; }

    setSaving(true);
    const { error, pending, umbral } = await onRegistrar(tipo, val, motivo.trim());
    setSaving(false);
    if (error) {
      toast.error(error);
    } else if (pending) {
      toast.success('Solicitud enviada para aprobación', {
        description: umbral ? `Movimientos ≥ $${umbral.toFixed(2)} requieren aprobación` : undefined,
      });
      setMonto(''); setMotivo(''); setOpen(false);
    } else {
      toast.success(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada`);
      setMonto(''); setMotivo(''); setOpen(false);
    }
  };

  const handleReversar = async () => {
    if (!reversing || !onReversar) return;
    if (!motivoReverso.trim()) { toast.error('Indica el motivo del reverso'); return; }
    setReversingLoading(true);
    const { error } = await onReversar(reversing.id, motivoReverso.trim());
    setReversingLoading(false);
    if (error) { toast.error(error); return; }
    toast.success('Movimiento reversado');
    setReversing(null);
    setMotivoReverso('');
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

            {movimientos.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Movimientos del turno</p>
                {movimientos.map(m => {
                  const isReversed = reversedIds.has(m.id);
                  const isReverso = !!m.reversa_de;
                  return (
                    <div key={m.id} className={`flex items-center justify-between text-xs p-1.5 rounded border border-border gap-2 ${isReversed ? 'opacity-50 line-through' : ''}`}>
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {m.tipo === 'entrada'
                          ? <ArrowUpCircle className="h-3 w-3 text-primary shrink-0" />
                          : <ArrowDownCircle className="h-3 w-3 text-destructive shrink-0" />}
                        <span className="truncate">{m.motivo}</span>
                        {isReverso && <Badge variant="outline" className="text-[10px] py-0 h-4">Reverso</Badge>}
                        {isReversed && <Badge variant="secondary" className="text-[10px] py-0 h-4">Reversado</Badge>}
                      </div>
                      <span className={`shrink-0 ${m.tipo === 'entrada' ? 'text-primary font-medium' : 'text-destructive font-medium'}`}>
                        {m.tipo === 'entrada' ? '+' : '-'}${m.monto.toFixed(2)}
                      </span>
                      {puedeReversar && onReversar && !isReversed && !isReverso && (
                        <Button
                          type="button" variant="ghost" size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => { setReversing(m); setMotivoReverso(''); }}
                          title="Reversar"
                        >
                          <Undo2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
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

      <Dialog open={!!reversing} onOpenChange={v => { if (!v && !reversingLoading) { setReversing(null); setMotivoReverso(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reversar Movimiento</DialogTitle>
            <DialogDescription>
              {reversing && (
                <>Se creará un {reversing.tipo === 'entrada' ? 'salida' : 'entrada'} de ${reversing.monto.toFixed(2)} vinculado.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo del reverso *</Label>
            <Textarea
              value={motivoReverso}
              onChange={e => setMotivoReverso(e.target.value)}
              placeholder="Ej: monto incorrecto, registrado por error..."
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setReversing(null); setMotivoReverso(''); }} disabled={reversingLoading}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReversar} disabled={reversingLoading}>
              {reversingLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirmar Reverso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
