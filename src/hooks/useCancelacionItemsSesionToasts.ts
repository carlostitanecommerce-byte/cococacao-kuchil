import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

const DECISION_LABELS: Record<string, string> = {
  retornado_stock: 'devuelto a stock',
  merma: 'registrado como merma',
  rechazado: 'rechazado',
};

/**
 * Notificaciones realtime para el flujo de cancelación de ítems de sesión coworking:
 *  - Al solicitante: toast cuando cocina/admin resuelve su solicitud (aprobada o rechazada).
 *  - A roles de cocina (barista/admin/supervisor): toast cuando entra una nueva solicitud.
 */
export function useCancelacionItemsSesionToasts() {
  const { user, roles } = useAuth();
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    notifiedRef.current.clear();

    const isKitchen =
      roles.includes('barista') ||
      roles.includes('administrador') ||
      roles.includes('supervisor');

    const channel = supabase
      .channel(`cancelaciones-items-sesion-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cancelaciones_items_sesion' },
        (payload) => {
          if (!isKitchen) return;
          const row: any = payload.new;
          if (!row || row.estado !== 'pendiente_decision') return;
          // Evita duplicar para el propio solicitante (admin que pidió y aprueba)
          const key = `new:${row.id}`;
          if (notifiedRef.current.has(key)) return;
          notifiedRef.current.add(key);
          toast.warning('Nueva solicitud de cancelación en cocina', {
            description: `${row.nombre_producto} ×${row.cantidad} — ${row.motivo ?? 'sin motivo'}`,
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cancelaciones_items_sesion' },
        (payload) => {
          const row: any = payload.new;
          if (!row || row.solicitante_id !== user.id) return;
          if (!['retornado_stock', 'merma', 'rechazado'].includes(row.estado)) return;
          const key = `done:${row.id}:${row.estado}`;
          if (notifiedRef.current.has(key)) return;
          notifiedRef.current.add(key);

          const label = DECISION_LABELS[row.estado] ?? row.estado;
          const description = `${row.nombre_producto} ×${row.cantidad}${row.notas_cocina ? ` — ${row.notas_cocina}` : ''}`;
          if (row.estado === 'rechazado') {
            toast.error(`Cocina rechazó tu solicitud de cancelación`, { description });
          } else {
            toast.success(`Cocina resolvió tu solicitud: ${label}`, { description });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, roles]);
}
