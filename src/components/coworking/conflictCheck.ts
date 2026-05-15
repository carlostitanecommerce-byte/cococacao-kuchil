import { supabase } from '@/integrations/supabase/client';

/** Build a Date anchored to CDMX (-06:00) from a YYYY-MM-DD + HH:mm string. */
function cdmxDate(fecha: string, hora: string): Date {
  // Normalize hora to HH:mm:ss
  const h = hora.length === 5 ? `${hora}:00` : hora;
  return new Date(`${fecha}T${h}-06:00`);
}

/**
 * Checks if a new/edited reservation conflicts with existing reservations or active sessions.
 * For private areas: any overlap = blocked.
 * For public areas: only blocked if sum of pax would exceed capacity.
 */
export async function checkReservationConflict(params: {
  areaId: string;
  fechaReserva: string;
  horaInicio: string;
  duracionHoras: number;
  paxCount: number;
  esPrivado: boolean;
  capacidadPax: number;
  excludeReservacionId?: string;
}): Promise<{ hasConflict: boolean; message: string }> {
  const { areaId, fechaReserva, horaInicio, duracionHoras, paxCount, esPrivado, capacidadPax, excludeReservacionId } = params;

  const startDate = cdmxDate(fechaReserva, horaInicio);
  const endDate = new Date(startDate.getTime() + duracionHoras * 3600000);

  // Check overlapping reservations
  let query = supabase
    .from('coworking_reservaciones')
    .select('id, cliente_nombre, hora_inicio, duracion_horas, pax_count')
    .eq('area_id', areaId)
    .eq('fecha_reserva', fechaReserva)
    .in('estado', ['pendiente', 'confirmada']);

  if (excludeReservacionId) {
    query = query.neq('id', excludeReservacionId);
  }

  const { data: existingRes } = await query;

  if (existingRes) {
    if (esPrivado) {
      // Private: any overlap = blocked
      for (const r of existingRes) {
        const rStart = cdmxDate(fechaReserva, r.hora_inicio);
        const rEnd = new Date(rStart.getTime() + r.duracion_horas * 3600000);
        if (startDate < rEnd && endDate > rStart) {
          return {
            hasConflict: true,
            message: `El área privada ya está reservada en ese horario (${r.cliente_nombre}: ${r.hora_inicio.slice(0, 5)} - ${rEnd.toTimeString().slice(0, 5)})`,
          };
        }
      }
    } else {
      // Public: check if pax would exceed capacity during overlap
      for (const r of existingRes) {
        const rStart = cdmxDate(fechaReserva, r.hora_inicio);
        const rEnd = new Date(rStart.getTime() + r.duracion_horas * 3600000);
        if (startDate < rEnd && endDate > rStart) {
          // Count all overlapping pax
          const overlappingPax = existingRes
            .filter(or => {
              const oStart = cdmxDate(fechaReserva, or.hora_inicio);
              const oEnd = new Date(oStart.getTime() + or.duracion_horas * 3600000);
              return startDate < oEnd && endDate > oStart;
            })
            .reduce((sum, or) => sum + or.pax_count, 0);

          if (overlappingPax + paxCount > capacidadPax) {
            return {
              hasConflict: true,
              message: `Capacidad insuficiente: hay ${overlappingPax} pax reservados y solo ${capacidadPax - overlappingPax} disponibles.`,
            };
          }
          break;
        }
      }
    }
  }

  // Check overlapping active sessions on the same date (CDMX day bounds)
  const dayStart = `${fechaReserva}T00:00:00-06:00`;
  const dayEnd = `${fechaReserva}T23:59:59-06:00`;

  const { data: activeSessions } = await supabase
    .from('coworking_sessions')
    .select('id, cliente_nombre, fecha_inicio, fecha_fin_estimada, pax_count')
    .eq('area_id', areaId)
    .eq('estado', 'activo')
    .gte('fecha_fin_estimada', dayStart)
    .lte('fecha_inicio', dayEnd);

  if (activeSessions) {
    if (esPrivado) {
      for (const s of activeSessions) {
        const sStart = new Date(s.fecha_inicio);
        const sEnd = new Date(s.fecha_fin_estimada);
        if (startDate < sEnd && endDate > sStart) {
          return {
            hasConflict: true,
            message: `El área privada tiene una sesión activa en ese horario (${s.cliente_nombre})`,
          };
        }
      }
    } else {
      const overlappingSessions = activeSessions.filter(s => {
        const sStart = new Date(s.fecha_inicio);
        const sEnd = new Date(s.fecha_fin_estimada);
        return startDate < sEnd && endDate > sStart;
      });
      const occupiedPax = overlappingSessions.reduce((sum, s) => sum + s.pax_count, 0);
      if (occupiedPax + paxCount > capacidadPax) {
        return {
          hasConflict: true,
          message: `Capacidad insuficiente: hay ${occupiedPax} personas activas y solo ${capacidadPax - occupiedPax} disponibles.`,
        };
      }
    }
  }

  return { hasConflict: false, message: '' };
}

/**
 * Check if a walk-in check-in [now, now + horas] would collide with confirmed/pending
 * reservations of TODAY for the area. Used to warn the cashier before creating
 * a session that would block an upcoming reservation.
 */
export async function checkWalkInVsReservations(params: {
  areaId: string;
  horas: number;
  paxCount: number;
  esPrivado: boolean;
  capacidadPax: number;
  fechaInicio?: Date;
}): Promise<{ hasConflict: boolean; message: string }> {
  const { areaId, horas, paxCount, esPrivado, capacidadPax, fechaInicio } = params;
  const start = fechaInicio ?? new Date();
  const end = new Date(start.getTime() + horas * 3600000);

  // Use CDMX local "today" string
  const cdmxToday = new Date(start.getTime() - 6 * 3600000 + start.getTimezoneOffset() * 60000);
  const fecha =
    cdmxToday.getFullYear() +
    '-' + String(cdmxToday.getMonth() + 1).padStart(2, '0') +
    '-' + String(cdmxToday.getDate()).padStart(2, '0');

  const { data: rsv } = await supabase
    .from('coworking_reservaciones')
    .select('id, cliente_nombre, hora_inicio, duracion_horas, pax_count')
    .eq('area_id', areaId)
    .eq('fecha_reserva', fecha)
    .in('estado', ['pendiente', 'confirmada']);

  if (!rsv || rsv.length === 0) return { hasConflict: false, message: '' };

  if (esPrivado) {
    for (const r of rsv) {
      const rStart = cdmxDate(fecha, r.hora_inicio);
      const rEnd = new Date(rStart.getTime() + r.duracion_horas * 3600000);
      if (start < rEnd && end > rStart) {
        return {
          hasConflict: true,
          message: `Hoy hay una reservación de ${r.cliente_nombre} a las ${r.hora_inicio.slice(0, 5)} en esta área privada que se traslapa con la estancia.`,
        };
      }
    }
    return { hasConflict: false, message: '' };
  }

  // Public area: sum overlapping reserved pax
  const overlappingPax = rsv
    .filter(r => {
      const rStart = cdmxDate(fecha, r.hora_inicio);
      const rEnd = new Date(rStart.getTime() + r.duracion_horas * 3600000);
      return start < rEnd && end > rStart;
    })
    .reduce((sum, r) => sum + r.pax_count, 0);

  if (overlappingPax + paxCount > capacidadPax) {
    return {
      hasConflict: true,
      message: `Hay ${overlappingPax} pax reservado(s) hoy en este horario; agregar ${paxCount} excedería la capacidad de ${capacidadPax}.`,
    };
  }
  return { hasConflict: false, message: '' };
}
