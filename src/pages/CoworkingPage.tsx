import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Building2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCoworkingData } from '@/components/coworking/useCoworkingData';
import { CheckInDialog } from '@/components/coworking/CheckInDialog';
import { CheckoutDialog } from '@/components/coworking/CheckoutDialog';
import { VenderMembresiaDialog } from '@/components/coworking/VenderMembresiaDialog';
import { Button } from '@/components/ui/button';
import { Package } from 'lucide-react';
import { CancelSessionDialog } from '@/components/coworking/CancelSessionDialog';
import { ManageSessionAccountDialog } from '@/components/coworking/ManageSessionAccountDialog';
import { SolicitudesCancelacionSesionesPanel } from '@/components/coworking/SolicitudesCancelacionSesionesPanel';
import { OccupancyGrid } from '@/components/coworking/OccupancyGrid';
import { ActiveSessionsTable } from '@/components/coworking/ActiveSessionsTable';
import { ReservacionesTab } from '@/components/coworking/ReservacionesTab';
import { ConfiguracionTab } from '@/components/coworking/ConfiguracionTab';
import { DirectorioClientesTab } from '@/components/coworking/DirectorioClientesTab';
import type { CoworkingSession, CheckoutSummary } from '@/components/coworking/types';
import { useCancelacionItemsSesionToasts } from '@/hooks/useCancelacionItemsSesionToasts';


const CoworkingPage = () => {
  const { roles } = useAuth();
  useCancelacionItemsSesionToasts();
  const data = useCoworkingData();
  const [checkoutSummary, setCheckoutSummary] = useState<CheckoutSummary | null>(null);
  const [sessionToCancel, setSessionToCancel] = useState<CoworkingSession | null>(null);
  const [sessionToManageAccount, setSessionToManageAccount] = useState<CoworkingSession | null>(null);
  const [venderMembresiaOpen, setVenderMembresiaOpen] = useState(false);
  const isAdmin = roles.includes('administrador');

  const METODO_LABELS: Record<string, string> = {
    sin_cobro: 'Sin cobro de fracción extra',
    hora_cerrada: 'Hora cerrada',
    '30_min': 'Bloques de 30 min',
    '15_min': 'Bloques de 15 min',
    minuto_exacto: 'Minuto exacto',
  };

  const handleCheckOut = async (session: CoworkingSession) => {
    const area = data.areas.find(a => a.id === session.area_id);
    if (!area) return;

    // Atomic freeze: ensures concurrent tabs/devices share the same fecha_salida_real
    if (!session.fecha_salida_real) {
      const { data: freezeData, error: freezeErr } = await supabase
        .rpc('freeze_checkout_coworking' as any, { p_session_id: session.id });
      if (freezeErr) {
        console.error('freeze_checkout_coworking failed', freezeErr);
        return;
      }
      const row = Array.isArray(freezeData) ? freezeData[0] : freezeData;
      const frozen = (row as any)?.fecha_salida_real;
      if (!frozen) return;
      session = { ...session, fecha_salida_real: frozen as string };
    }

    const inicio = new Date(session.fecha_inicio);
    const finEstimada = new Date(session.fecha_fin_estimada);
    const salidaReal = new Date(session.fecha_salida_real!);

    const tiempoContratadoMin = (finEstimada.getTime() - inicio.getTime()) / 60000;
    const tiempoRealMin = (salidaReal.getTime() - inicio.getTime()) / 60000;
    const tiempoExcedidoMin = Math.max(0, tiempoRealMin - tiempoContratadoMin);

    const paxMultiplier = area.es_privado ? 1 : session.pax_count;

    // Snapshot inmutable: reglas congeladas al check-in
    const snapshot = session.tarifa_snapshot ?? null;
    const tolerancia = snapshot?.minutos_tolerancia ?? 0;
    const metodo = snapshot?.metodo_fraccion ?? '15_min';
    const precioBase = snapshot?.precio_base ?? area.precio_por_hora;
    const metodoLabel = METODO_LABELS[metodo] ?? metodo;

    const minCobrar = tiempoExcedidoMin - tolerancia;

    let bloquesExtra = 0;
    let cargoExtraUnidad = 0; // antes de paxMultiplier

    if (minCobrar > 0) {
      switch (metodo) {
        case 'sin_cobro':
          // Tarifa todo incluido: nunca se cobra fracción extra
          bloquesExtra = 0;
          cargoExtraUnidad = 0;
          break;
        case '15_min':
          bloquesExtra = Math.ceil(minCobrar / 15);
          cargoExtraUnidad = bloquesExtra * (precioBase / 4);
          break;
        case '30_min':
          bloquesExtra = Math.ceil(minCobrar / 30);
          cargoExtraUnidad = bloquesExtra * (precioBase / 2);
          break;
        case 'hora_cerrada':
          bloquesExtra = Math.ceil(minCobrar / 60);
          cargoExtraUnidad = bloquesExtra * precioBase;
          break;
        case 'minuto_exacto':
          bloquesExtra = Math.ceil(minCobrar);
          cargoExtraUnidad = minCobrar * (precioBase / 60);
          break;
        default:
          bloquesExtra = Math.ceil(minCobrar / 15);
          cargoExtraUnidad = bloquesExtra * (precioBase / 4);
      }
    }

    // Sesiones de titulares de membresía mensual: tiempo/base no se cobra
    const isMemberSession = !!session.membresia_id;
    const cargoExtra = isMemberSession ? 0 : cargoExtraUnidad * paxMultiplier;
    const subtotalContratado = isMemberSession ? 0 : (tiempoContratadoMin / 60) * precioBase * paxMultiplier;

    // Amenities/upsells ahora viven en detalle_ventas y se cuentan en consumosPosTotal
    const upsells: any[] = [];
    const upsellsTotal = 0;

    // Sumar consumos POS abiertos (detalle_ventas con venta_id NULL para esta sesión)
    const { data: openLines } = await supabase
      .from('detalle_ventas')
      .select('subtotal')
      .eq('coworking_session_id', session.id)
      .is('venta_id', null);
    const consumosPosLineas = openLines?.length ?? 0;
    const consumosPosTotal = (openLines ?? []).reduce((s: number, r: any) => s + (Number(r.subtotal) || 0), 0);

    const total = subtotalContratado + cargoExtra + upsellsTotal + consumosPosTotal;

    setCheckoutSummary({
      session, area,
      tiempoContratadoMin, tiempoRealMin, tiempoExcedidoMin,
      bloquesExtra, subtotalContratado, cargoExtra, total,
      upsells,
      metodoFraccion: metodo,
      metodoFraccionLabel: metodoLabel,
      toleranciaMin: tolerancia,
      minCobrar: Math.max(0, minCobrar),
      precioBaseSnapshot: precioBase,
      paxMultiplier,
      consumosPosTotal,
      consumosPosLineas,
    });
  };

  if (data.loading) {
    return <div className="text-muted-foreground">Cargando...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" />
            Kúuchil Meyaj — Coworking
          </h1>
          <p className="text-muted-foreground mt-1">Ocupación en tiempo real y registro de entradas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setVenderMembresiaOpen(true)}>
            <Package className="h-4 w-4 mr-2" />
            Vender Membresía
          </Button>
          <CheckInDialog areas={data.areas} getOccupancy={data.getOccupancy} getAvailablePax={data.getAvailablePax} membresias={data.membresias} onSuccess={data.fetchData} />
        </div>
      </div>

      <Tabs defaultValue="ocupacion">
        <TabsList>
          <TabsTrigger value="ocupacion">Ocupación</TabsTrigger>
          <TabsTrigger value="reservaciones">Reservaciones</TabsTrigger>
          <TabsTrigger value="directorio">Directorio</TabsTrigger>
          {isAdmin && <TabsTrigger value="configuracion">Configuración</TabsTrigger>}
        </TabsList>

        <TabsContent value="ocupacion" className="space-y-6">
          <OccupancyGrid
            areas={data.areas}
            getOccupancy={data.getOccupancy}
            getAreaSessions={data.getAreaSessions}
            onCheckOut={handleCheckOut}
            onCancel={setSessionToCancel}
          />
          <ActiveSessionsTable
            sessions={data.sessions}
            areas={data.areas}
            onCheckOut={handleCheckOut}
            onCancel={setSessionToCancel}
            onManageAccount={setSessionToManageAccount}
            onPaxUpdated={data.fetchData}
          />
          {isAdmin && <SolicitudesCancelacionSesionesPanel onSessionCancelled={data.fetchData} />}
        </TabsContent>

        <TabsContent value="reservaciones">
          <ReservacionesTab areas={data.areas} reservaciones={data.reservaciones} getOccupancy={data.getOccupancy} getAvailablePax={data.getAvailablePax} onSuccess={data.fetchData} />
        </TabsContent>

        <TabsContent value="directorio">
          <DirectorioClientesTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="configuracion">
            <ConfiguracionTab areas={data.areas} />
          </TabsContent>
        )}
      </Tabs>

      <CheckoutDialog summary={checkoutSummary} onClose={() => setCheckoutSummary(null)} onSuccess={data.fetchData} />
      <CancelSessionDialog session={sessionToCancel} isAdmin={isAdmin} onClose={() => setSessionToCancel(null)} onSuccess={data.fetchData} />
      <ManageSessionAccountDialog session={sessionToManageAccount} areas={data.areas} onClose={() => setSessionToManageAccount(null)} onSuccess={data.fetchData} />
      <VenderMembresiaDialog open={venderMembresiaOpen} onOpenChange={setVenderMembresiaOpen} areas={data.areas} onSuccess={data.fetchData} />
    </div>
  );
};

export default CoworkingPage;
