import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { nowCDMX } from '@/lib/utils';

export interface CajaSession {
  id: string;
  folio: number;
  usuario_id: string;
  monto_apertura: number;
  monto_cierre: number | null;
  estado: 'abierta' | 'cerrada';
  fecha_apertura: string;
  fecha_cierre: string | null;
  diferencia: number | null;
}

export interface MovimientoCaja {
  id: string;
  caja_id: string;
  usuario_id: string;
  tipo: 'entrada' | 'salida';
  monto: number;
  motivo: string;
  created_at: string;
  reversa_de: string | null;
  motivo_reverso: string | null;
}


export function useCajaSession() {
  const { user } = useAuth();
  const [cajaAbierta, setCajaAbierta] = useState<CajaSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([]);

  const fetchCaja = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    // Find any open caja (any user - there should be only one open at a time)
    const { data } = await supabase
      .from('cajas')
      .select('*')
      .eq('estado', 'abierta' as any)
      .order('fecha_apertura', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setCajaAbierta(data as unknown as CajaSession);
      // Fetch movements for this caja
      const { data: movs } = await supabase
        .from('movimientos_caja')
        .select('*')
        .eq('caja_id', data.id)
        .order('created_at', { ascending: true });
      setMovimientos((movs ?? []) as unknown as MovimientoCaja[]);
    } else {
      setCajaAbierta(null);
      setMovimientos([]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchCaja(); }, [fetchCaja]);

  // Realtime: la caja física es una sola y la comparte todo el equipo del
  // POS. Cualquier apertura/cierre o movimiento debe reflejarse al instante
  // en todas las sesiones (admin, caja, recepción, supervisor).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`caja-shared-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cajas' }, () => {
        fetchCaja();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_caja' }, () => {
        fetchCaja();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchCaja]);

  const abrirCaja = async (montoApertura: number) => {
    if (!user) return { error: 'No autenticado' };
    const { data, error } = await supabase.from('cajas').insert({
      usuario_id: user.id,
      monto_apertura: montoApertura,
      estado: 'abierta' as any,
    }).select().single();

    if (error) {
      // Índice único parcial: solo una caja abierta a la vez
      if (error.code === '23505' || /unique/i.test(error.message)) {
        await fetchCaja();
        return { error: 'Ya hay una caja abierta en el sistema. Sincronizando...' };
      }
      return { error: error.message };
    }

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      accion: 'apertura_caja',
      descripcion: `Apertura de caja con fondo fijo de $${montoApertura.toFixed(2)}`,
      metadata: { caja_id: data.id, monto_apertura: montoApertura },
    });

    await fetchCaja();
    return { error: null };
  };

  const registrarMovimiento = async (tipo: 'entrada' | 'salida', monto: number, motivo: string) => {
    if (!user || !cajaAbierta) return { error: 'No hay caja abierta', pending: false };
    const { data, error } = await supabase.rpc('registrar_movimiento_caja' as any, {
      p_tipo: tipo,
      p_monto: monto,
      p_motivo: motivo,
    });
    if (error) return { error: error.message, pending: false };
    const result = data as { ok: boolean; pending: boolean; umbral?: number };
    await fetchCaja();
    return { error: null, pending: !!result.pending, umbral: result.umbral };
  };


  const cerrarCaja = async (montoCierre: number, notasCierre?: string) => {
    if (!user || !cajaAbierta) return { error: 'No hay caja abierta' };

    const { data, error } = await supabase.rpc('cerrar_caja' as any, {
      p_caja_id: cajaAbierta.id,
      p_monto_cierre: montoCierre,
      p_notas_cierre: notasCierre ?? null,
    });

    if (error) return { error: error.message };

    const result = data as { ok: boolean; esperado: number; diferencia: number };
    await fetchCaja();
    return { error: null, esperado: result.esperado, diferencia: result.diferencia };
  };


  return { cajaAbierta, loading, movimientos, abrirCaja, registrarMovimiento, cerrarCaja, refetch: fetchCaja };
}

// Suma efectivo de ventas del turno: prioriza caja_id (vínculo directo) y
// usa el rango de fechas como fallback solo para ventas legadas (sin caja_id).
async function getVentasEfectivo(cajaId: string, fechaApertura: string, fechaCierre?: string): Promise<number> {
  const fechaTope = fechaCierre ?? nowCDMX();

  const { data: linked } = await supabase
    .from('ventas')
    .select('monto_efectivo')
    .eq('estado', 'completada' as any)
    .eq('caja_id', cajaId);

  const { data: legacy } = await supabase
    .from('ventas')
    .select('monto_efectivo')
    .eq('estado', 'completada' as any)
    .is('caja_id', null)
    .gte('fecha', fechaApertura)
    .lte('fecha', fechaTope);

  const sumLinked = (linked ?? []).reduce((s, v) => s + (v.monto_efectivo ?? 0), 0);
  const sumLegacy = (legacy ?? []).reduce((s, v) => s + (v.monto_efectivo ?? 0), 0);
  return sumLinked + sumLegacy;
}
