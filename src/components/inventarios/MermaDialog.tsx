import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Insumo {
  id: string;
  nombre: string;
  unidad_medida: string;
  stock_actual: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  insumo: Insumo;
  onSuccess: () => void;
}

const MermaDialog = ({ open, onOpenChange, insumo, onSuccess }: Props) => {
  const { user } = useAuth();
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    const cantidadNum = parseFloat(cantidad);
    if (!cantidadNum || cantidadNum <= 0) { toast.error('Cantidad inválida'); return; }
    if (!motivo.trim()) { toast.error('El motivo es obligatorio'); return; }
    if (cantidadNum > insumo.stock_actual) {
      toast.error(`No hay suficiente stock (disponible: ${insumo.stock_actual} ${insumo.unidad_medida})`);
      return;
    }

    setSaving(true);

    const { error } = await supabase.rpc('registrar_merma', {
      p_insumo_id: insumo.id,
      p_cantidad: cantidadNum,
      p_motivo: motivo.trim(),
    });

    if (error) {
      toast.error(error.message || 'Error al registrar merma');
      setSaving(false);
      return;
    }

    toast.success(`Merma registrada: ${cantidadNum} ${insumo.unidad_medida} de ${insumo.nombre}`);
    setSaving(false);
    setCantidad('');
    setMotivo('');
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Merma — {insumo.nombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            Stock actual: <span className="font-semibold text-foreground">{insumo.stock_actual} {insumo.unidad_medida}</span>
          </div>
          <div className="space-y-1">
            <Label>Cantidad a dar de baja ({insumo.unidad_medida}) *</Label>
            <Input
              type="number" min="0.01" step="0.01"
              placeholder="0"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Motivo *</Label>
            <Textarea
              placeholder="ej. Caducado, derrame, contaminación..."
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Registrando...' : 'Confirmar Merma'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MermaDialog;
