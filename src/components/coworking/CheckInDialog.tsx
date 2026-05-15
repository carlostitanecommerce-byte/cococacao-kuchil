import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { UserPlus, Gift } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Area } from './types';
import { dateToCDMX } from '@/lib/utils';
import { enviarASesionKDS, type KitchenItemInput } from './sendToKitchen';
import { checkWalkInVsReservations } from './conflictCheck';

interface Tarifa {
  id: string;
  nombre: string;
  precio_base: number;
  tipo_cobro: string;
  areas_aplicables: string[];
  metodo_fraccion: string;
  minutos_tolerancia: number;
  activo?: boolean;
  [key: string]: any;
}

interface UpsellOption {
  producto_id: string;
  nombre: string;
  precio_especial: number;
}

interface AmenityOption {
  producto_id: string;
  nombre: string;
  cantidad_incluida: number;
}

interface Props {
  areas: Area[];
  getOccupancy: (areaId: string) => number;
  getAvailablePax: (areaId: string) => number;
  onSuccess?: () => void | Promise<void>;
}

export function CheckInDialog({ areas, getOccupancy, getAvailablePax, onSuccess }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [clienteNombre, setClienteNombre] = useState('');
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [paxCount, setPaxCount] = useState('1');
  const [horas, setHoras] = useState('1');
  const [creating, setCreating] = useState(false);
  const inFlightRef = useRef(false);

  // Tarifa & upsell state
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [selectedTarifaId, setSelectedTarifaId] = useState('');
  const [upsellOptions, setUpsellOptions] = useState<UpsellOption[]>([]);
  const [amenityOptions, setAmenityOptions] = useState<AmenityOption[]>([]);

  const selectedArea = areas.find(a => a.id === selectedAreaId);
  const isPublicArea = selectedArea ? !selectedArea.es_privado : false;

  // Force pax=1 for public areas
  useEffect(() => {
    if (isPublicArea) {
      setPaxCount('1');
    }
  }, [isPublicArea]);

  // Load tarifas on open
  useEffect(() => {
    if (!open) return;
    const fetchOpenData = async () => {
      const tarifasRes = await supabase.from('tarifas_coworking').select('*').eq('activo', true);
      setTarifas((tarifasRes.data as Tarifa[]) ?? []);
    };
    fetchOpenData();
  }, [open]);

  // Filter tarifas by selected area
  const applicableTarifas = selectedAreaId
    ? tarifas.filter(t => (t.areas_aplicables as string[])?.includes(selectedAreaId))
    : [];

  // Auto-select tarifa if only one applies
  useEffect(() => {
    if (applicableTarifas.length === 1) {
      setSelectedTarifaId(applicableTarifas[0].id);
    } else if (!applicableTarifas.find(t => t.id === selectedTarifaId)) {
      setSelectedTarifaId('');
    }
  }, [selectedAreaId, applicableTarifas.length]);

  // Load upsell options and amenities when tarifa changes
  useEffect(() => {
    setUpsellOptions([]);
    setAmenityOptions([]);
    if (!selectedTarifaId) return;

    const fetchData = async () => {
      const [upsellsRes, amenitiesRes] = await Promise.all([
        supabase
          .from('tarifa_upsells')
          .select('producto_id, productos:producto_id(nombre, precio_upsell_coworking)')
          .eq('tarifa_id', selectedTarifaId),
        supabase
          .from('tarifa_amenities_incluidos')
          .select('producto_id, cantidad_incluida, productos:producto_id(nombre)')
          .eq('tarifa_id', selectedTarifaId),
      ]);

      // Use real-time precio_upsell_coworking from productos table
      setUpsellOptions(
        (upsellsRes.data ?? []).map((u: any) => ({
          producto_id: u.producto_id,
          nombre: u.productos?.nombre ?? 'Producto',
          precio_especial: u.productos?.precio_upsell_coworking ?? 0,
        }))
      );

      setAmenityOptions(
        (amenitiesRes.data ?? []).map((a: any) => ({
          producto_id: a.producto_id,
          nombre: a.productos?.nombre ?? 'Amenity',
          cantidad_incluida: a.cantidad_incluida,
        }))
      );
    };
    fetchData();
  }, [selectedTarifaId]);


  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setCreating(true);

    try {
      const pax = parseInt(paxCount, 10);
      const horasNum = parseFloat(horas);
      const available = getAvailablePax(selectedAreaId);

      if (selectedArea?.es_privado && available < selectedArea.capacidad_pax) {
        toast({ variant: 'destructive', title: 'Área privada ocupada', description: 'Este espacio ya tiene una sesión activa.' });
        return;
      }

      if (!selectedArea?.es_privado && pax > available) {
        toast({ variant: 'destructive', title: 'Capacidad excedida', description: `Solo hay ${available} lugar(es) disponible(s).` });
        return;
      }

      // B3: validar contra reservaciones de hoy en el horario solicitado
      if (selectedArea) {
        const rsvConflict = await checkWalkInVsReservations({
          areaId: selectedAreaId,
          horas: horasNum,
          paxCount: pax,
          esPrivado: selectedArea.es_privado,
          capacidadPax: selectedArea.capacidad_pax,
        });
        if (rsvConflict.hasConflict) {
          toast({ variant: 'destructive', title: 'Conflicto con reservación', description: rsvConflict.message });
          return;
        }
      }

      const fechaInicio = new Date();
      const fechaFinEstimada = new Date(fechaInicio.getTime() + horasNum * 60 * 60 * 1000);

      

      // Build immutable tarifa snapshot at check-in time
      const selectedTarifa = selectedTarifaId
        ? tarifas.find(t => t.id === selectedTarifaId) ?? null
        : null;
      const tarifaSnapshot = selectedTarifa
        ? {
            ...selectedTarifa,
            amenities: amenityOptions,
            upsells_disponibles: upsellOptions,
            snapshot_at: new Date().toISOString(),
          }
        : null;

      const { data: sessionData, error } = await supabase.from('coworking_sessions').insert({
        cliente_nombre: clienteNombre.trim(),
        area_id: selectedAreaId,
        pax_count: pax,
        usuario_id: user.id,
        fecha_inicio: dateToCDMX(fechaInicio),
        fecha_fin_estimada: dateToCDMX(fechaFinEstimada),
        estado: 'activo',
        monto_acumulado: 0,
        tarifa_id: selectedTarifaId || null,
        tarifa_snapshot: tarifaSnapshot,
      } as any).select('id').single();

      if (error || !sessionData) {
        const raw = error?.message ?? 'No se pudo crear la sesión';
        const friendly = /capacidad excedida/i.test(raw)
          ? 'Capacidad excedida. Otro cajero acaba de ocupar este espacio. Refresca y vuelve a intentar.'
          : /área privada/i.test(raw)
            ? 'Esta área privada ya tiene una sesión activa. Refresca para ver el estado actual.'
            : raw;
        toast({ variant: 'destructive', title: 'No se pudo registrar la entrada', description: friendly });
        return;
      }

      // Insertar amenities directamente en detalle_ventas (cuenta abierta)
      const detalleRows: any[] = [];
      for (const a of amenityOptions) {
        const qty = a.cantidad_incluida * pax;
        detalleRows.push({
          coworking_session_id: sessionData.id,
          venta_id: null,
          producto_id: a.producto_id,
          cantidad: qty,
          precio_unitario: 0,
          subtotal: 0,
          tipo_concepto: 'amenity',
        });
      }

      if (detalleRows.length > 0) {
        const { error: upsellErr } = await supabase
          .from('detalle_ventas')
          .insert(detalleRows);

        if (upsellErr) {
          await supabase.from('coworking_sessions').delete().eq('id', sessionData.id);
          toast({
            variant: 'destructive',
            title: 'Error al añadir productos',
            description: `${upsellErr.message}. La sesión fue revertida; intenta de nuevo.`,
          });
          return;
        }
      }

      // Enviar a Cocina los amenities añadidos en check-in
      const kitchenItems: KitchenItemInput[] = amenityOptions.map(a => ({
        producto_id: a.producto_id,
        nombre: a.nombre,
        cantidad: a.cantidad_incluida * pax,
        isAmenity: true,
      }));

      let kdsFolio: number | null = null;
      if (kitchenItems.length > 0) {
        const kdsRes = await enviarASesionKDS({
          context: {
            sessionId: sessionData.id,
            clienteNombre: clienteNombre.trim(),
            motivo: 'checkin',
          },
          items: kitchenItems,
        });
        kdsFolio = kdsRes.folio;
        if (kdsRes.itemsEnviados === 0 && kitchenItems.some(i => true)) {
          // No se envió nada (probable: ningún producto requiere preparación). Silencioso.
        }
      }

      await supabase.from('audit_logs').insert({
        user_id: user.id, accion: 'checkin_coworking',
        descripcion: `Check-in: ${clienteNombre.trim()} (${pax} pax)${kdsFolio ? ` · KDS #${String(kdsFolio).padStart(4, '0')}` : ''}`,
        metadata: {
          area_id: selectedAreaId,
          pax_count: pax,
          horas: horasNum,
          tarifa_id: selectedTarifaId || null,
          kds_folio: kdsFolio,
          tarifa_snapshot_resumen: selectedTarifa
            ? {
                nombre: selectedTarifa.nombre,
                precio_base: selectedTarifa.precio_base,
                tipo_cobro: selectedTarifa.tipo_cobro,
                metodo_fraccion: selectedTarifa.metodo_fraccion,
                minutos_tolerancia: selectedTarifa.minutos_tolerancia,
              }
            : null,
        },
      });
      toast({
        title: 'Entrada registrada exitosamente',
        description: kdsFolio ? `Comanda enviada a cocina (#${String(kdsFolio).padStart(4, '0')})` : undefined,
      });
      setClienteNombre(''); setSelectedAreaId(''); setPaxCount('1'); setHoras('1');
      setSelectedTarifaId('');
      setAmenityOptions([]);

      setOpen(false);
      await onSuccess?.();
    } finally {
      setCreating(false);
      inFlightRef.current = false;
    }
  };

  const paxMax = selectedArea
    ? (selectedArea.es_privado ? selectedArea.capacidad_pax : 1)
    : 10;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus className="mr-2 h-4 w-4" />Registrar Entrada</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Registrar Entrada (Check-in)</DialogTitle></DialogHeader>
        <form onSubmit={handleCheckIn} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="cliente">Nombre del Cliente</Label>
            <Input id="cliente" value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre completo" required maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label>Área</Label>
            <Select value={selectedAreaId} onValueChange={setSelectedAreaId} required>
              <SelectTrigger><SelectValue placeholder="Seleccionar área" /></SelectTrigger>
              <SelectContent>
                {areas.map(area => {
                  const avail = getAvailablePax(area.id);
                  const isPrivadoOcupado = area.es_privado && avail < area.capacidad_pax;
                  const isDisabled = area.es_privado ? isPrivadoOcupado : avail <= 0;
                  const label = area.es_privado
                    ? `${area.nombre_area} — ${isPrivadoOcupado ? 'Ocupado' : 'Disponible'} (privado)`
                    : `${area.nombre_area} — ${avail}/${area.capacidad_pax} disponibles`;
                  return (
                    <SelectItem key={area.id} value={area.id} disabled={isDisabled}>
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Tarifa selector */}
          {selectedAreaId && applicableTarifas.length > 0 && (
            <div className="space-y-2">
              <Label>Tarifa</Label>
              <Select value={selectedTarifaId} onValueChange={setSelectedTarifaId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar tarifa" /></SelectTrigger>
                <SelectContent>
                  {applicableTarifas.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre} — ${t.precio_base}/{t.tipo_cobro}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}



          {/* Amenities informativos (Solo lectura) */}
          {selectedTarifaId && amenityOptions.length > 0 && (
            <div className="space-y-2 bg-primary/5 border border-primary/20 rounded-md p-3">
              <Label className="text-primary flex items-center gap-1.5">
                <Gift className="h-4 w-4" /> Entregar al cliente ahora:
              </Label>
              <div className="space-y-1.5 mt-2">
                {amenityOptions.map(a => {
                  const pax = parseInt(paxCount, 10) || 1;
                  const totalSugerido = a.cantidad_incluida * pax;
                  return (
                    <div key={a.producto_id} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">• {a.nombre}</span>
                      <span className="font-bold text-primary">× {totalSugerido}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-tight">
                Las cantidades se añadirán automáticamente a la cuenta. Si el cliente no desea alguno, podrás descontarlo desde la gestión de la sesión activa.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pax">Personas (Pax)</Label>
              <Input
                id="pax"
                type="number"
                min={1}
                max={paxMax}
                value={paxCount}
                onChange={e => setPaxCount(e.target.value)}
                required
                disabled={isPublicArea}
              />
              {selectedAreaId && (
                <p className="text-xs text-muted-foreground">
                  {isPublicArea ? 'Tarifa personal (1 pax)' : `Máx: ${paxMax}`}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="horas">Tiempo (horas)</Label>
              <Input id="horas" type="number" min={0.5} step={0.5} value={horas} onChange={e => setHoras(e.target.value)} required />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={creating || !selectedAreaId}>
            {creating ? 'Registrando...' : 'Confirmar Entrada'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
