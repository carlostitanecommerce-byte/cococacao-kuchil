import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { useCajaSession } from '@/hooks/useCajaSession';
import { useSolicitudCancelacionToasts } from '@/hooks/useSolicitudCancelacionToasts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lock, Unlock } from 'lucide-react';
import { AperturaCajaDialog } from '@/components/caja/AperturaCajaDialog';
import { CierreCajaDialog } from '@/components/caja/CierreCajaDialog';
import { MovimientosCajaPanel } from '@/components/caja/MovimientosCajaPanel';
import { VentasTurnoPanel } from '@/components/caja/VentasTurnoPanel';
import { SolicitudesCancelacionPanel } from '@/components/caja/SolicitudesCancelacionPanel';
import { SolicitudesMovimientoPanel } from '@/components/caja/SolicitudesMovimientoPanel';
import { useSolicitudMovimientoToasts } from '@/hooks/useSolicitudMovimientoToasts';
import { CoworkingSessionSelector } from '@/components/caja/CoworkingSessionSelector';
import { OrdenesPosSelector, type OrdenPendiente } from '@/components/caja/OrdenesPosSelector';
import { CajaCheckoutPanel } from '@/components/caja/CajaCheckoutPanel';

import { useCajaCartStore } from '@/stores/cartStore';
import type { CartItem } from '@/components/pos/types';
import { supabase } from '@/integrations/supabase/client';

const CajaPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingSessionId = searchParams.get('session');
  const autoImportOrdenId = searchParams.get('auto_import_orden');
  const autoImportProcessedRef = useRef<string | null>(null);
  const { roles } = useAuth();
  const { cajaAbierta, loading, movimientos, abrirCaja, registrarMovimiento, reversarMovimiento, cerrarCaja } = useCajaSession();
  const importCoworkingSession = useCajaCartStore((s) => s.importCoworkingSession);
  const coworkingSessionId = useCajaCartStore((s) => s.coworkingSessionId);
  const importOrdenPendiente = useCajaCartStore((s) => s.importOrdenPendiente);
  const ordenPendienteId = useCajaCartStore((s) => s.ordenPendienteId);
  const clear = useCajaCartStore((s) => s.clear);
  const hasItems = useCajaCartStore((s) => s.items.length > 0);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [aperturaCerrada, setAperturaCerrada] = useState(false);

  useEffect(() => {
    if (pendingSessionId && hasItems) {
      toast.warning('La sesión quedará pendiente. Termina el ticket actual para atenderla.');
      setSearchParams((prev) => {
        const np = new URLSearchParams(prev);
        np.delete('session');
        return np;
      });
    }
  }, [pendingSessionId, hasItems, setSearchParams]);

  // Escuchar cambios en tiempo real en la sesión de coworking importada
  useEffect(() => {
    if (!coworkingSessionId) return;

    let active = true;
    supabase
      .from('coworking_sessions')
      .select('estado')
      .eq('id', coworkingSessionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('Error al verificar estado de la sesión de coworking:', error);
          return;
        }
        if (!data || data.estado !== 'pendiente_pago') {
          clear();
          toast.info('La sesión de coworking importada ya no está pendiente de pago.');
        }
      });

    const channel = supabase
      .channel(`caja-imported-session-${coworkingSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'coworking_sessions',
          filter: `id=eq.${coworkingSessionId}`,
        },
        (payload) => {
          const newStatus = payload.new?.estado;
          if (newStatus && newStatus !== 'pendiente_pago') {
            clear();
            toast.info('La sesión de coworking importada fue reabierta o cancelada desde otra pantalla.');
          }
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [coworkingSessionId, clear]);

  // Escuchar cambios en tiempo real en la orden de POS importada
  useEffect(() => {
    if (!ordenPendienteId) return;

    let active = true;
    supabase
      .from('ordenes_pos_pendientes')
      .select('estado')
      .eq('id', ordenPendienteId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('Error al verificar estado de la orden POS:', error);
          return;
        }
        if (!data || data.estado !== 'pendiente') {
          clear();
          toast.info('La orden POS importada ya no está pendiente.');
        }
      });

    const channel = supabase
      .channel(`caja-imported-orden-${ordenPendienteId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ordenes_pos_pendientes',
          filter: `id=eq.${ordenPendienteId}`,
        },
        (payload) => {
          const newStatus = payload.new?.estado;
          if (newStatus && newStatus !== 'pendiente') {
            clear();
            toast.info('La orden POS importada fue cancelada o cobrada desde otra pantalla.');
          }
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [ordenPendienteId, clear]);

  useEffect(() => {
    if (!autoImportOrdenId) return;
    if (!cajaAbierta) return;
    if (autoImportProcessedRef.current === autoImportOrdenId) return;

    const clearParam = () => {
      setSearchParams((prev) => {
        const np = new URLSearchParams(prev);
        np.delete('auto_import_orden');
        return np;
      });
    };

    if (hasItems) {
      autoImportProcessedRef.current = autoImportOrdenId;
      clearParam();
      return;
    }

    autoImportProcessedRef.current = autoImportOrdenId;
    (async () => {
      const { data, error } = await supabase
        .from('ordenes_pos_pendientes')
        .select('id, folio, cliente_nombre, items, total')
        .eq('id', autoImportOrdenId)
        .eq('estado', 'pendiente')
        .maybeSingle();
      if (error || !data) {
        if (error) console.error(error);
        toast.error('No se pudo auto-importar la orden');
      } else {
        handleImportOrden({
          id: data.id,
          folio: data.folio,
          cliente_nombre: data.cliente_nombre,
          items: Array.isArray(data.items) ? (data.items as unknown as CartItem[]) : [],
          total: Number(data.total) || 0,
          created_at: '',
          usuario_id: '',
        });
      }
      clearParam();
    })();
  }, [autoImportOrdenId, cajaAbierta, hasItems, setSearchParams]);

  const effectivePendingSessionId = hasItems ? null : pendingSessionId;

  const isAdmin = roles.includes('administrador');
  const isSupervisor = roles.includes('supervisor');
  const puedeOmitirApertura = isAdmin || isSupervisor;

  useSolicitudCancelacionToasts();
  useSolicitudMovimientoToasts();


  const handleImportSession = (items: CartItem[], sessionId: string, clienteNombre: string) => {
    importCoworkingSession(items, sessionId, clienteNombre);
  };

  const handleImportOrden = (orden: OrdenPendiente) => {
    importOrdenPendiente(orden.items, orden.id, orden.cliente_nombre);
    const folioStr = String(orden.folio).padStart(4, '0');
    toast.success(`Orden #${folioStr} importada al ticket`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const leftColumn = (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {cajaAbierta ? <Unlock className="h-5 w-5 text-primary" /> : <Lock className="h-5 w-5 text-muted-foreground" />}
              Control de Caja
            </span>
            {cajaAbierta ? (
              <Badge variant="outline" className="text-primary border-primary">Abierta</Badge>
            ) : (
              <Badge variant="secondary">Cerrada</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cajaAbierta ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Apertura:</span>{' '}
                  {format(new Date(cajaAbierta.fecha_apertura), "d 'de' MMMM, HH:mm", { locale: es })}
                </p>
                <p><span className="text-muted-foreground">Fondo fijo:</span>{' '}
                  <span className="font-semibold">${cajaAbierta.monto_apertura.toFixed(2)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <MovimientosCajaPanel movimientos={movimientos} onRegistrar={registrarMovimiento} onReversar={reversarMovimiento} />
                <Button variant="destructive" onClick={() => setCierreOpen(true)}>
                  Cerrar Caja
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">No hay caja abierta. Abre la caja para iniciar operaciones.</p>
              {puedeOmitirApertura && aperturaCerrada && (
                <Button onClick={() => setAperturaCerrada(false)}>
                  Abrir Caja
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {cajaAbierta && (
        <>
          <OrdenesPosSelector onImport={handleImportOrden} />
          <CoworkingSessionSelector
            onImportSession={handleImportSession}
            importedSessionId={coworkingSessionId ?? undefined}
            pendingSessionId={effectivePendingSessionId}
            onPendingConsumed={() => setSearchParams({})}
          />
        </>
      )}

      {(isAdmin || isSupervisor) && <SolicitudesMovimientoPanel />}
      {(isAdmin || isSupervisor) && <SolicitudesCancelacionPanel />}


      {(cajaAbierta || puedeOmitirApertura) && <VentasTurnoPanel isAdmin={isAdmin} cajaAbierta={cajaAbierta ? { id: cajaAbierta.id, folio: cajaAbierta.folio } : null} />}
    </div>
  );

  return (
    <>
      {cajaAbierta ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">{leftColumn}</div>
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-4">
              <CajaCheckoutPanel />
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto">{leftColumn}</div>
      )}

      <AperturaCajaDialog
        open={!cajaAbierta && !(puedeOmitirApertura && aperturaCerrada)}
        onAbrirCaja={abrirCaja}
        allowSkip={puedeOmitirApertura}
        onClose={() => {
          if (puedeOmitirApertura) {
            setAperturaCerrada(true);
          } else {
            navigate('/');
          }
        }}
      />

      {cajaAbierta && (
        <CierreCajaDialog
          open={cierreOpen}
          onClose={() => setCierreOpen(false)}
          caja={cajaAbierta}
          movimientos={movimientos}
          onCerrarCaja={cerrarCaja}
        />
      )}
    </>
  );
};

export default CajaPage;
