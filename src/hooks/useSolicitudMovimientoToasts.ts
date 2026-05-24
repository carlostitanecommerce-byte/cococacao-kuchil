import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Notifica al solicitante cuando su solicitud de movimiento de caja
 * es aprobada o rechazada por un administrador/supervisor.
 */
export function useSolicitudMovimientoToasts() {
  const { user } = useAuth();
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    notifiedRef.current.clear();

    const channel = supabase
      .channel(`solicitudes-movimiento-self-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'solicitudes_movimiento_caja', filter: `solicitante_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as any;
          if (!row || (row.estado !== 'aprobada' && row.estado !== 'rechazada')) return;
          const key = `${row.id}:${row.estado}`;
          if (notifiedRef.current.has(key)) return;
          notifiedRef.current.add(key);

          const desc = `${row.tipo === 'entrada' ? 'Entrada' : 'Salida'} de $${Number(row.monto).toFixed(2)}`;
          if (row.estado === 'aprobada') {
            toast.success('Movimiento aprobado', { description: desc });
          } else {
            toast.error('Movimiento rechazado', {
              description: row.motivo_rechazo ? `${desc} — ${row.motivo_rechazo}` : desc,
            });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);
}
