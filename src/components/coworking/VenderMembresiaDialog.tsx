import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Package } from 'lucide-react';
import { ClienteSelector } from './ClienteSelector';
import type { Area, Cliente } from './types';
import type { CartItem } from '@/components/pos/types';
import { todayCDMX } from '@/lib/utils';

interface Tarifa {
  id: string;
  nombre: string;
  tipo_cobro: string;
  precio_base: number;
  areas_aplicables: string[];
  activo: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areas: Area[];
  onSuccess?: () => void | Promise<void>;
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function VenderMembresiaDialog({ open, onOpenChange, areas, onSuccess }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [tarifaId, setTarifaId] = useState<string>('');
  const [areaId, setAreaId] = useState<string>('');
  const [fechaInicio, setFechaInicio] = useState<string>(todayCDMX());
  const [fechaFin, setFechaFin] = useState<string>('');
  const [horasTotales, setHorasTotales] = useState<string>('0');
  const [notas, setNotas] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data, error } = await supabase
        .from('tarifas_coworking')
        .select('id, nombre, tipo_cobro, precio_base, areas_aplicables, activo')
        .eq('activo', true)
        .in('tipo_cobro', ['mes', 'paquete_horas'] as any)
        .order('nombre');
      if (error) {
        toast.error('No se pudieron cargar las tarifas', { description: error.message });
        return;
      }
      setTarifas((data ?? []) as Tarifa[]);
    })();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCliente(null);
      setTarifaId('');
      setAreaId('');
      setFechaInicio(todayCDMX());
      setFechaFin('');
      setHorasTotales('0');
      setNotas('');
    }
  }, [open]);

  const tarifa = useMemo(() => tarifas.find(t => t.id === tarifaId) ?? null, [tarifas, tarifaId]);

  // Auto-calc fecha_fin & horas_totales when tarifa or fecha_inicio change
  useEffect(() => {
    if (!tarifa || !fechaInicio) return;
    if (tarifa.tipo_cobro === 'mes') {
      setFechaFin(addMonths(fechaInicio, 1));
      setHorasTotales('0');
    } else if (tarifa.tipo_cobro === 'paquete_horas') {
      setFechaFin(addDays(fechaInicio, 30));
    }
  }, [tarifa, fechaInicio]);

  const areasAplicables = useMemo(() => {
    if (!tarifa) return areas;
    if (!tarifa.areas_aplicables?.length) return areas;
    const set = new Set(tarifa.areas_aplicables);
    return areas.filter(a => set.has(a.id));
  }, [tarifa, areas]);

  const canSubmit =
    !!user &&
    !!cliente &&
    !!tarifa &&
    !!fechaInicio &&
    !!fechaFin &&
    fechaFin >= fechaInicio &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !user || !cliente || !tarifa) return;
    setSubmitting(true);

    const horas = tarifa.tipo_cobro === 'paquete_horas' ? Number(horasTotales) || 0 : 0;
    const areaFinal = areaId || null;

    // 1) INSERT membresia
    const { data: memRow, error: memErr } = await supabase
      .from('coworking_membresias' as any)
      .insert({
        cliente_id: cliente.id,
        tarifa_id: tarifa.id,
        area_id: areaFinal,
        usuario_id: user.id,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        estado: 'pendiente_pago',
        horas_totales: horas,
        horas_disponibles: horas,
        notas: notas.trim() || null,
      } as any)
      .select('id')
      .single();

    if (memErr || !memRow) {
      setSubmitting(false);
      toast.error('No se pudo crear la membresía', { description: memErr?.message });
      return;
    }
    const membresiaId = (memRow as any).id as string;

    // 2) Orden pendiente
    const { data: cajaAbierta } = await supabase
      .from('cajas')
      .select('id')
      .eq('usuario_id', user.id)
      .eq('estado', 'abierta')
      .maybeSingle();

    const item: CartItem = {
      lineId: `membresia-${membresiaId}`,
      producto_id: null,
      nombre: `Membresía ${tarifa.nombre}`,
      precio_unitario: Number(tarifa.precio_base),
      cantidad: 1,
      subtotal: Number(tarifa.precio_base),
      tipo_concepto: 'coworking',
      descripcion: `Membresía coworking · ${cliente.nombre_completo} · ${fechaInicio} → ${fechaFin}`,
      membresia_id: membresiaId,
      tarifa_id: tarifa.id,
    };

    const { data: ordenRow, error: ordErr } = await supabase
      .from('ordenes_pos_pendientes')
      .insert({
        usuario_id: user.id,
        caja_id: cajaAbierta?.id ?? null,
        cliente_nombre: cliente.nombre_completo,
        items: [item] as any,
        total: Number(tarifa.precio_base),
        tipo_consumo: 'sitio',
      })
      .select('id, folio')
      .single();

    if (ordErr || !ordenRow) {
      // Rollback compensatorio
      await supabase.from('coworking_membresias' as any).delete().eq('id', membresiaId);
      setSubmitting(false);
      toast.error('No se pudo enviar a Caja', { description: ordErr?.message });
      return;
    }

    // 3) Audit
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      accion: 'venta_membresia_coworking',
      descripcion: `Venta membresía: ${cliente.nombre_completo} · ${tarifa.nombre} · $${Number(tarifa.precio_base).toFixed(2)}`,
      metadata: {
        membresia_id: membresiaId,
        orden_pendiente_id: (ordenRow as any).id,
        tarifa_id: tarifa.id,
        cliente_id: cliente.id,
        total: Number(tarifa.precio_base),
      },
    });

    const folioStr = String((ordenRow as any).folio).padStart(4, '0');
    toast.success(`Membresía enviada a Caja · Orden #${folioStr}`);
    setSubmitting(false);
    onOpenChange(false);
    await onSuccess?.();
    navigate(`/caja?auto_import_orden=${(ordenRow as any).id}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Vender Membresía
          </DialogTitle>
          <DialogDescription>
            Genera la membresía en estado <b>pendiente de pago</b> y envía la cuenta directo a Caja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto pr-1 -mr-1">

          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClienteSelector
              value={cliente ? { id: cliente.id, nombre_completo: cliente.nombre_completo } : null}
              onChange={setCliente}
            />
          </div>

          <div className="space-y-2">
            <Label>Tarifa</Label>
            <Select value={tarifaId} onValueChange={setTarifaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una tarifa (mes / paquete de horas)" />
              </SelectTrigger>
              <SelectContent>
                {tarifas.length === 0 && (
                  <div className="p-2 text-sm text-muted-foreground">No hay tarifas activas de tipo mes/paquete.</div>
                )}
                {tarifas.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre} — ${Number(t.precio_base).toFixed(2)} · {t.tipo_cobro === 'mes' ? 'Mensual' : 'Paquete horas'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tarifa && areasAplicables.length > 0 && (
            <div className="space-y-2">
              <Label>Área asignada <span className="text-xs text-muted-foreground">(opcional)</span></Label>
              <Select value={areaId} onValueChange={(v) => setAreaId(v === '__none__' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin área específica" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin área específica</SelectItem>
                  {areasAplicables.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.nombre_area}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fecha-inicio">Fecha inicio</Label>
              <Input
                id="fecha-inicio"
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fecha-fin">Fecha fin</Label>
              <Input
                id="fecha-fin"
                type="date"
                value={fechaFin}
                min={fechaInicio}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </div>
          </div>

          {tarifa?.tipo_cobro === 'paquete_horas' && (
            <div className="space-y-2">
              <Label htmlFor="horas">Horas incluidas</Label>
              <Input
                id="horas"
                type="number"
                min={0}
                step="0.5"
                value={horasTotales}
                onChange={(e) => setHorasTotales(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notas">Notas <span className="text-xs text-muted-foreground">(opcional)</span></Label>
            <Textarea id="notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>

          {tarifa && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total a cobrar en Caja</span>
              <span className="font-semibold text-lg text-primary">${Number(tarifa.precio_base).toFixed(2)}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Enviando…</>
            ) : (
              'Enviar a Caja'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
