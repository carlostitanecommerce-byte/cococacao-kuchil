import { useState } from 'react';
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
import { CoworkingSessionSelector } from '@/components/caja/CoworkingSessionSelector';
import { CajaCheckoutPanel } from '@/components/caja/CajaCheckoutPanel';
import { useCartStore } from '@/stores/cartStore';
import type { CartItem } from '@/components/pos/types';

const CajaPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingSessionId = searchParams.get('session');
  const { roles } = useAuth();
  const { cajaAbierta, loading, movimientos, abrirCaja, registrarMovimiento, cerrarCaja } = useCajaSession();
  const importCoworkingSession = useCartStore((s) => s.importCoworkingSession);
  const coworkingSessionId = useCartStore((s) => s.coworkingSessionId);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [aperturaCerrada, setAperturaCerrada] = useState(false);

  const isAdmin = roles.includes('administrador');
  const isSupervisor = roles.includes('supervisor');
  const puedeOmitirApertura = isAdmin || isSupervisor;

  useSolicitudCancelacionToasts();

  const handleImportSession = (items: CartItem[], sessionId: string, clienteNombre: string) => {
    importCoworkingSession(items, sessionId, clienteNombre);
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
                <MovimientosCajaPanel movimientos={movimientos} onRegistrar={registrarMovimiento} />
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
        <CoworkingSessionSelector
          onImportSession={handleImportSession}
          importedSessionId={coworkingSessionId ?? undefined}
          pendingSessionId={pendingSessionId}
          onPendingConsumed={() => setSearchParams({})}
        />
      )}

      {(isAdmin || isSupervisor) && <SolicitudesCancelacionPanel />}

      {(cajaAbierta || puedeOmitirApertura) && <VentasTurnoPanel isAdmin={isAdmin} />}
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
