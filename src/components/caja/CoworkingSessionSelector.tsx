import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Users, Clock, Plus, Ban } from 'lucide-react';
import type { CartItem } from '@/components/pos/types';
import { CancelSessionDialog } from '@/components/coworking/CancelSessionDialog';
import type { CoworkingSession, TarifaSnapshot } from '@/components/coworking/types';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface ActiveSession {
  id: string;
  cliente_nombre: string;
  area_id: string;
  area_nombre: string;
  pax_count: number;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_salida_real: string | null;
  es_privado: boolean;
  tarifa_id: string | null;
  tarifa_snapshot: TarifaSnapshot | null;
}

interface Props {
  onImportSession: (items: CartItem[], sessionId: string, clienteNombre: string) => void;
  importedSessionId?: string;
  pendingSessionId?: string | null;
  onPendingConsumed?: () => void;
}

const FRACCION_LABELS: Record<string, string> = {
  '15_min': 'Bloques de 15 min',
  '30_min': 'Bloques de 30 min',
  'hora_cerrada': 'Hora cerrada',
  'minuto_exacto': 'Minuto exacto',
};

export function CoworkingSessionSelector({ onImportSession, importedSessionId, pendingSessionId, onPendingConsumed }: Props) {
  const { roles } = useAuth();
  const { toast } = useToast();
  const isAdmin = roles.includes('administrador');
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sessionToCancel, setSessionToCancel] = useState<CoworkingSession | null>(null);

  const fetchSessions = async () => {
    const { data: sessData } = await supabase
      .from('coworking_sessions')
      .select('id, cliente_nombre, area_id, pax_count, fecha_inicio, fecha_fin_estimada, tarifa_id, usuario_id, estado, monto_acumulado, fecha_salida_real, tarifa_snapshot')
      .eq('estado', 'pendiente_pago');

    if (!sessData || sessData.length === 0) { setSessions([]); setLoading(false); return; }

    const areaIds = [...new Set((sessData as any[]).map(s => s.area_id))];
    const { data: areasData } = await supabase
      .from('areas_coworking')
      .select('id, nombre_area, es_privado')
      .in('id', areaIds);

    const areaMap = new Map(areasData?.map(a => [a.id, a]) ?? []);

    setSessions((sessData as any[]).map((s: any) => {
      const area = areaMap.get(s.area_id);
      return {
        ...s,
        area_nombre: area?.nombre_area ?? 'Desconocida',
        es_privado: area?.es_privado ?? false,
        fecha_salida_real: s.fecha_salida_real ?? null,
        tarifa_id: s.tarifa_id ?? null,
        tarifa_snapshot: (s.tarifa_snapshot as TarifaSnapshot | null) ?? null,
      };
    }));
    setLoading(false);
  };

  useEffect(() => {
    fetchSessions();

    const channel = supabase
      .channel('pos-coworking-sessions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coworking_sessions' }, () => fetchSessions())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'detalle_ventas' }, () => fetchSessions())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Auto-import pending session from coworking checkout redirect
  useEffect(() => {
    if (pendingSessionId && !loading && sessions.length > 0) {
      const session = sessions.find(s => s.id === pendingSessionId);
      if (session) {
        handleSelect(session);
        onPendingConsumed?.();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSessionId, loading, sessions]);

  const handleSelect = async (session: ActiveSession) => {
    const snapshot = session.tarifa_snapshot;

    if (!snapshot) {
      toast({
        variant: 'destructive',
        title: 'Sesión sin tarifa congelada',
        description: 'Esta sesión no tiene snapshot de tarifa. Pide a un administrador que la cancele y la rehaga.',
      });
      return;
    }

    // Frozen checkout time
    let endRef = session.fecha_salida_real;
    if (!endRef) {
      const { data: fresh } = await supabase
        .from('coworking_sessions')
        .select('fecha_salida_real')
        .eq('id', session.id)
        .single();
      endRef = fresh?.fecha_salida_real ?? new Date().toISOString();
    }

    // Snapshot fields (immutable source of truth)
    const tarifaNombre = (snapshot.nombre as string) || 'Tarifa Coworking';
    const precioBase = Number(snapshot.precio_base) || 0;
    const tipoCobro = (snapshot.tipo_cobro as string) || 'hora';
    const metodo = (snapshot.metodo_fraccion as string) || '15_min';
    const tolerancia = Number(snapshot.minutos_tolerancia) || 0;
    const paxMultiplier = session.es_privado ? 1 : session.pax_count;

    // Time math
    const tiempoContratadoMin = calcMinutes(session.fecha_inicio, session.fecha_fin_estimada);
    const tiempoRealMin = calcMinutes(session.fecha_inicio, endRef);
    const extraMins = Math.max(0, tiempoRealMin - tiempoContratadoMin);
    const minCobrar = Math.max(0, extraMins - tolerancia);
    const hours = tiempoContratadoMin / 60;

    // Base charge from snapshot
    let baseCharge = precioBase;
    if (tipoCobro === 'hora') {
      baseCharge = precioBase * hours * paxMultiplier;
    } else if (tipoCobro === 'dia' || tipoCobro === 'mes') {
      baseCharge = precioBase * paxMultiplier;
    }

    const items: CartItem[] = [{
      producto_id: `coworking-${session.id}`,
      nombre: `${tarifaNombre}: ${session.area_nombre} (${formatDuration(tiempoContratadoMin)})`,
      precio_unitario: round2(baseCharge),
      cantidad: 1,
      subtotal: round2(baseCharge),
      tipo_concepto: 'coworking',
      coworking_session_id: session.id,
      descripcion: `${session.cliente_nombre} - Tarifa: ${tarifaNombre}`,
    }];

    // Extra time charge (immutable, snapshot-driven)
    if (minCobrar > 0 && tipoCobro === 'hora' && metodo !== 'sin_cobro') {
      let bloquesExtra = 0;
      let cargoExtra = 0;
      let descExtra = '';

      switch (metodo) {
        case '30_min':
          bloquesExtra = Math.ceil(minCobrar / 30);
          cargoExtra = bloquesExtra * (precioBase / 2) * paxMultiplier;
          descExtra = `${bloquesExtra} bloque${bloquesExtra !== 1 ? 's' : ''} x 30min`;
          break;
        case 'hora_cerrada':
          bloquesExtra = Math.ceil(minCobrar / 60);
          cargoExtra = bloquesExtra * precioBase * paxMultiplier;
          descExtra = `${bloquesExtra} hora${bloquesExtra !== 1 ? 's' : ''} cerrada${bloquesExtra !== 1 ? 's' : ''}`;
          break;
        case 'minuto_exacto':
          bloquesExtra = minCobrar;
          cargoExtra = minCobrar * (precioBase / 60) * paxMultiplier;
          descExtra = `${minCobrar} min prorrateado`;
          break;
        case '15_min':
        default:
          bloquesExtra = Math.ceil(minCobrar / 15);
          cargoExtra = bloquesExtra * (precioBase / 4) * paxMultiplier;
          descExtra = `${bloquesExtra} bloque${bloquesExtra !== 1 ? 's' : ''} x 15min`;
          break;
      }

      items.push({
        producto_id: `coworking-extra-${session.id}`,
        nombre: `Tiempo excedido (${descExtra})`,
        precio_unitario: round2(cargoExtra),
        cantidad: 1,
        subtotal: round2(cargoExtra),
        tipo_concepto: 'coworking',
        coworking_session_id: session.id,
        descripcion: `Excedente — ${FRACCION_LABELS[metodo] ?? metodo}${tolerancia > 0 ? ` · Tolerancia ${tolerancia}min` : ''}`,
      });
    }

    // Amenities/upsells/consumos ya viven en detalle_ventas (venta_id NULL)
    // y se cargan en el bloque siguiente (openLines).

    // Consumos POS abiertos (detalle_ventas con venta_id NULL para esta sesión)
    const { data: openLines } = await supabase
      .from('detalle_ventas')
      .select('id, producto_id, cantidad, precio_unitario, subtotal, tipo_concepto, descripcion, paquete_id, paquete_nombre, productos:producto_id(nombre)')
      .eq('coworking_session_id', session.id)
      .is('venta_id', null)
      .order('created_at', { ascending: true });

    for (const ln of (openLines ?? [])) {
      const prodName = (ln as any).productos?.nombre ?? ln.descripcion ?? 'Producto';
      items.push({
        producto_id: ln.producto_id ?? `open-${ln.id}`,
        nombre: `🧾 ${prodName}`,
        precio_unitario: Number(ln.precio_unitario) || 0,
        cantidad: ln.cantidad,
        subtotal: Number(ln.subtotal) || 0,
        tipo_concepto: (ln.tipo_concepto as any) ?? 'producto',
        coworking_session_id: session.id,
        descripcion: ln.descripcion ?? 'Consumo POS',
        paquete_id: ln.paquete_id ?? undefined,
        open_account_detalle_id: ln.id,
      });
    }

    onImportSession(items, session.id, session.cliente_nombre);
  };

  const filtered = sessions.filter(s =>
    s.cliente_nombre.toLowerCase().includes(search.toLowerCase()) ||
    s.area_nombre.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Sesiones Pendientes de Pago
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar sesión..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Cargando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sin sesiones pendientes de pago</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {filtered.map(s => {
              const isImported = importedSessionId === s.id;
              const elapsed = calcMinutes(s.fecha_inicio, s.fecha_salida_real ?? new Date().toISOString());
              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between p-2 rounded-md border text-sm ${isImported ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{s.cliente_nombre}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{s.area_nombre}</span>
                      <Badge variant="outline" className="text-[10px] px-1 h-4">
                        {s.pax_count} pax
                      </Badge>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDuration(elapsed)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => setSessionToCancel({
                        id: s.id,
                        cliente_nombre: s.cliente_nombre,
                        area_id: s.area_id,
                        pax_count: s.pax_count,
                        usuario_id: (s as any).usuario_id ?? '',
                        fecha_inicio: s.fecha_inicio,
                        fecha_fin_estimada: s.fecha_fin_estimada,
                        fecha_salida_real: (s as any).fecha_salida_real ?? null,
                        estado: (s as any).estado ?? 'pendiente_pago',
                        monto_acumulado: (s as any).monto_acumulado ?? 0,
                        tarifa_id: s.tarifa_id,
                        upsell_producto_id: null,
                        upsell_precio: null,
                        tarifa_snapshot: s.tarifa_snapshot,
                      })}
                      title="Cancelar sesión"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant={isImported ? 'secondary' : 'default'}
                      className="h-7 text-xs"
                      disabled={isImported}
                      onClick={() => handleSelect(s)}
                    >
                      {isImported ? 'Importado' : <><Plus className="h-3 w-3 mr-1" /> Cobrar</>}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <CancelSessionDialog
        session={sessionToCancel}
        isAdmin={isAdmin}
        onClose={() => setSessionToCancel(null)}
        onSuccess={fetchSessions}
      />
    </Card>
  );
}

function calcMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
