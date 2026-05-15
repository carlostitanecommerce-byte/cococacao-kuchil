import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Reservacion, Area } from './types';
import { dateToCDMX } from '@/lib/utils';

interface Props {
  reservacion: Reservacion;
  area: Area | undefined;
  getAvailablePax: (areaId: string) => number;
  onSuccess?: () => void | Promise<void>;
}

export function QuickCheckInButton({ reservacion, area, getAvailablePax, onSuccess }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const handleQuickCheckIn = async () => {
    if (!user || !area) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);

    try {
      const available = getAvailablePax(reservacion.area_id);

      if (area.es_privado && available < area.capacidad_pax) {
        toast({ variant: 'destructive', title: 'Área privada ocupada', description: 'Este espacio ya tiene una sesión activa.' });
        return;
      }

      if (!area.es_privado && reservacion.pax_count > available) {
        toast({ variant: 'destructive', title: 'Capacidad excedida', description: `Solo hay ${available} lugar(es) disponible(s).` });
        return;
      }

      // Cargar tarifas aplicables al área
      const { data: tarifasData } = await supabase
        .from('tarifas_coworking')
        .select('*')
        .eq('activo', true);

      const applicableTarifas = (tarifasData ?? []).filter((t: any) =>
        Array.isArray(t.areas_aplicables) && t.areas_aplicables.includes(reservacion.area_id),
      );

      // Si hay 0 o varias tarifas, hacer check-in básico (operador puede gestionar luego)
      // Si hay exactamente 1, congelar snapshot completo + amenities + upsells
      let tarifaId: string | null = null;
      let tarifaSnapshot: any = null;
      let amenities: { producto_id: string; cantidad_incluida: number; nombre?: string }[] = [];
      let upsells: { producto_id: string; nombre: string; precio_especial: number }[] = [];

      if (applicableTarifas.length === 1) {
        const tarifa = applicableTarifas[0];
        tarifaId = tarifa.id;

        const [upsellsRes, amenitiesRes] = await Promise.all([
          supabase
            .from('tarifa_upsells')
            .select('producto_id, productos:producto_id(nombre, precio_upsell_coworking)')
            .eq('tarifa_id', tarifa.id),
          supabase
            .from('tarifa_amenities_incluidos')
            .select('producto_id, cantidad_incluida, productos:producto_id(nombre)')
            .eq('tarifa_id', tarifa.id),
        ]);

        upsells = (upsellsRes.data ?? []).map((u: any) => ({
          producto_id: u.producto_id,
          nombre: u.productos?.nombre ?? 'Producto',
          precio_especial: u.productos?.precio_upsell_coworking ?? 0,
        }));

        amenities = (amenitiesRes.data ?? []).map((a: any) => ({
          producto_id: a.producto_id,
          cantidad_incluida: a.cantidad_incluida,
          nombre: a.productos?.nombre ?? 'Amenity',
        }));

        tarifaSnapshot = {
          ...tarifa,
          amenities,
          upsells_disponibles: upsells,
          snapshot_at: new Date().toISOString(),
        };
      }

      const fechaInicio = new Date();
      const fechaFinEstimada = new Date(fechaInicio.getTime() + reservacion.duracion_horas * 3600000);

      const { data: sessionData, error: sessionError } = await supabase
        .from('coworking_sessions')
        .insert({
          cliente_nombre: reservacion.cliente_nombre,
          area_id: reservacion.area_id,
          pax_count: reservacion.pax_count,
          usuario_id: user.id,
          fecha_inicio: dateToCDMX(fechaInicio),
          fecha_fin_estimada: dateToCDMX(fechaFinEstimada),
          estado: 'activo',
          monto_acumulado: 0,
          tarifa_id: tarifaId,
          tarifa_snapshot: tarifaSnapshot,
        } as any)
        .select('id')
        .single();

      if (sessionError) {
        const raw = sessionError.message;
        const friendly = /capacidad excedida/i.test(raw)
          ? 'Capacidad excedida. Otro cajero acaba de ocupar este espacio. Refresca y vuelve a intentar.'
          : /área privada/i.test(raw)
            ? 'Esta área privada ya tiene una sesión activa. Refresca para ver el estado actual.'
            : raw;
        toast({ variant: 'destructive', title: 'No se pudo iniciar la sesión', description: friendly });
        return;
      }

      // Insertar amenities en detalle_ventas (cuenta abierta) — cantidad_incluida * pax
      if (sessionData && amenities.length > 0) {
        const amenityRows = amenities.map(a => ({
          coworking_session_id: sessionData.id,
          venta_id: null,
          producto_id: a.producto_id,
          cantidad: a.cantidad_incluida * reservacion.pax_count,
          precio_unitario: 0,
          subtotal: 0,
          tipo_concepto: 'amenity',
        }));
        const { error: amenityErr } = await (supabase as any)
          .from('detalle_ventas')
          .insert(amenityRows);
        if (amenityErr) {
          toast({
            variant: 'destructive',
            title: 'Sesión creada con advertencia',
            description: 'No se pudieron añadir amenities automáticamente. Añádelos manualmente desde Gestionar Cuenta.',
          });
        }
      }

      // Update reservation status
      await supabase.from('coworking_reservaciones')
        .update({ estado: 'confirmada' })
        .eq('id', reservacion.id);

      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'checkin_desde_reservacion',
        descripcion: `Check-in rápido desde reservación: ${reservacion.cliente_nombre} (${reservacion.pax_count} pax)`,
        metadata: {
          reservacion_id: reservacion.id,
          area_id: reservacion.area_id,
          tarifa_id: tarifaId,
          amenities_aplicados: amenities.length,
          upsells_disponibles: upsells.length,
        },
      });

      toast({
        title: 'Check-in realizado',
        description: tarifaId
          ? `Tarifa aplicada con ${amenities.length} amenity(s) incluido(s).`
          : applicableTarifas.length > 1
            ? 'Sin tarifa: hay múltiples aplicables. Asigna desde Gestionar Cuenta.'
            : 'Sin tarifa configurada para esta área.',
      });
      await onSuccess?.();
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleQuickCheckIn} disabled={loading} title="Check-in rápido">
      <Play className="h-3 w-3" />
    </Button>
  );
}
