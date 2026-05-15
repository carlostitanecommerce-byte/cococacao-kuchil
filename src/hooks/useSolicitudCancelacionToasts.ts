import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Suscribe al usuario actual a updates de sus propias solicitudes
 * de cancelación (ventas y sesiones de coworking) y muestra un toast
 * cuando un administrador las aprueba o rechaza.
 */
export function useSolicitudCancelacionToasts() {
  const { user } = useAuth();
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    notifiedRef.current.clear();

    const handleRow = (table: 'ventas' | 'sesiones', row: any) => {
      if (!row || row.solicitante_id !== user.id) return;
      if (row.estado !== 'aprobada' && row.estado !== 'rechazada') return;
      const key = `${table}:${row.id}:${row.estado}`;
      if (notifiedRef.current.has(key)) return;
      notifiedRef.current.add(key);

      const label = table === 'ventas' ? 'venta' : 'sesión de coworking';
      if (row.estado === 'aprobada') {
        toast.success(`Tu solicitud de cancelación de ${label} fue aprobada`);
      } else {
        toast.error(
          `Tu solicitud de cancelación de ${label} fue rechazada`,
          row.motivo_rechazo ? { description: row.motivo_rechazo } : undefined,
        );
      }
    };

    const channel = supabase
      .channel(`solicitudes-cancelacion-self-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'solicitudes_cancelacion', filter: `solicitante_id=eq.${user.id}` },
        (payload) => handleRow('ventas', payload.new),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'solicitudes_cancelacion_sesiones', filter: `solicitante_id=eq.${user.id}` },
        (payload) => handleRow('sesiones', payload.new),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);
}
