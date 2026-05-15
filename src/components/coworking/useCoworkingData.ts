import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Area, CoworkingSession, Reservacion } from './types';
import { todayCDMX } from '@/lib/utils';

export function useCoworkingData() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [sessions, setSessions] = useState<CoworkingSession[]>([]);
  const [reservaciones, setReservaciones] = useState<Reservacion[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [areasRes, sessionsRes, reservRes] = await Promise.all([
      supabase.from('areas_coworking').select('*').order('nombre_area'),
      supabase.from('coworking_sessions').select('*').in('estado', ['activo', 'pendiente_pago'] as any),
      supabase.from('coworking_reservaciones').select('*').in('estado', ['pendiente', 'confirmada']).order('fecha_reserva'),
    ]);
    setAreas((areasRes.data as Area[]) ?? []);
    setSessions((sessionsRes.data as unknown as CoworkingSession[]) ?? []);
    setReservaciones((reservRes.data as Reservacion[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel('coworking-all-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coworking_sessions' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coworking_reservaciones' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'areas_coworking' }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const getOccupancy = (areaId: string) =>
    sessions.filter(s => s.area_id === areaId && s.estado === 'activo').reduce((sum, s) => sum + s.pax_count, 0);

  const getAreaSessions = (areaId: string) =>
    sessions.filter(s => s.area_id === areaId && s.estado === 'activo');

  const getAvailablePax = (areaId: string) => {
    const area = areas.find(a => a.id === areaId);
    if (!area) return 0;
    if (area.es_privado) {
      // Private: if any active session exists, area is fully blocked
      const hasActiveSession = sessions.some(s => s.area_id === areaId && s.estado === 'activo');
      return hasActiveSession ? 0 : area.capacidad_pax;
    }
    return area.capacidad_pax - getOccupancy(areaId);
  };

  const getTodayReservations = (areaId: string) => {
    const today = todayCDMX();
    return reservaciones.filter(r => r.area_id === areaId && r.fecha_reserva === today && ['pendiente', 'confirmada'].includes(r.estado));
  };

  return { areas, sessions, reservaciones, loading, fetchData, getOccupancy, getAreaSessions, getAvailablePax, getTodayReservations };
}
