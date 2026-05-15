import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TrendingUp, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';

const SESSIONS_LIMIT = 2000;
const DETALLES_LIMIT = 5000;

interface TarifaStats {
  tarifaId: string;
  tarifaNombre: string;
  sesiones: number;
  ingresoCoworking: number;
  ingresoUpsells: number;
  ingresoTotal: number;
}

interface TopProduct {
  nombre: string;
  cantidad: number;
  ingreso: number;
}

const BAR_COLORS = [
  'hsl(25 65% 45%)',
  'hsl(36 72% 52%)',
  'hsl(155 50% 40%)',
  'hsl(200 50% 45%)',
  'hsl(280 40% 50%)',
  'hsl(10 60% 50%)',
];

interface Props {
  desde: Date;
  hasta: Date;
}

export default function CoworkingAnalysis({ desde, hasta }: Props) {
  const [loading, setLoading] = useState(false);
  const [tarifaStats, setTarifaStats] = useState<TarifaStats[]>([]);
  const [selectedTarifa, setSelectedTarifa] = useState<string | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loadingTop, setLoadingTop] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const abortStatsRef = useRef<AbortController | null>(null);
  const abortTopRef = useRef<AbortController | null>(null);

  const desdeISO = format(desde, 'yyyy-MM-dd') + 'T00:00:00-06:00';
  const hastaISO = format(hasta, 'yyyy-MM-dd') + 'T23:59:59-06:00';

  useEffect(() => {
    abortStatsRef.current?.abort();
    const ctrl = new AbortController();
    abortStatsRef.current = ctrl;
    fetchStats(ctrl.signal);
    setSelectedTarifa(null);
    setTopProducts([]);
    return () => ctrl.abort();
  }, [desdeISO, hastaISO]);

  const fetchStats = async (signal: AbortSignal) => {
    setLoading(true);
    setTruncated(false);
    try {
      const { data: tarifas, error: tErr } = await supabase
        .from('tarifas_coworking')
        .select('id, nombre')
        .eq('activo', true)
        .abortSignal(signal);
      if (signal.aborted) return;
      if (tErr) throw tErr;

      if (!tarifas?.length) {
        setTarifaStats([]);
        return;
      }

      const { data: sessions, error: sErr } = await supabase
        .from('coworking_sessions')
        .select('id, tarifa_id, monto_acumulado')
        .in('estado', ['activo', 'finalizado', 'pendiente_pago'])
        .gte('fecha_inicio', desdeISO)
        .lte('fecha_inicio', hastaISO)
        .not('tarifa_id', 'is', null)
        .limit(SESSIONS_LIMIT)
        .abortSignal(signal);
      if (signal.aborted) return;
      if (sErr) throw sErr;

      let localTruncated = (sessions?.length ?? 0) >= SESSIONS_LIMIT;

      if (!sessions?.length) {
        setTarifaStats(tarifas.map(t => ({
          tarifaId: t.id, tarifaNombre: t.nombre,
          sesiones: 0, ingresoCoworking: 0, ingresoUpsells: 0, ingresoTotal: 0,
        })));
        return;
      }

      const sessionIds = sessions.map(s => s.id);
      const allDetalles: { coworking_session_id: string; tipo_concepto: string; subtotal: number }[] = [];

      for (let i = 0; i < sessionIds.length; i += 100) {
        if (signal.aborted) return;
        const batch = sessionIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from('detalle_ventas')
          .select('coworking_session_id, tipo_concepto, subtotal, ventas!inner(estado)')
          .in('coworking_session_id', batch)
          .eq('ventas.estado', 'completada')
          .limit(DETALLES_LIMIT)
          .abortSignal(signal);
        if (error) throw error;
        const rows = (data ?? []) as any[];
        if (rows.length >= DETALLES_LIMIT) localTruncated = true;
        allDetalles.push(...rows.filter(d => d.coworking_session_id));
      }

      const tarifaMap = new Map<string, { sesiones: number; ingresoCoworking: number; ingresoUpsells: number }>();
      tarifas.forEach(t => tarifaMap.set(t.id, { sesiones: 0, ingresoCoworking: 0, ingresoUpsells: 0 }));

      const sessionTarifaMap = new Map<string, string>();
      sessions.forEach(s => {
        if (s.tarifa_id) {
          sessionTarifaMap.set(s.id, s.tarifa_id);
          const entry = tarifaMap.get(s.tarifa_id);
          if (entry) entry.sesiones++;
        }
      });

      allDetalles.forEach(d => {
        const tarifaId = sessionTarifaMap.get(d.coworking_session_id!);
        if (!tarifaId) return;
        const entry = tarifaMap.get(tarifaId);
        if (!entry) return;
        if (d.tipo_concepto === 'coworking') entry.ingresoCoworking += d.subtotal;
        else entry.ingresoUpsells += d.subtotal;
      });

      const stats: TarifaStats[] = tarifas.map(t => {
        const e = tarifaMap.get(t.id)!;
        return {
          tarifaId: t.id,
          tarifaNombre: t.nombre,
          sesiones: e.sesiones,
          ingresoCoworking: +e.ingresoCoworking.toFixed(2),
          ingresoUpsells: +e.ingresoUpsells.toFixed(2),
          ingresoTotal: +(e.ingresoCoworking + e.ingresoUpsells).toFixed(2),
        };
      }).sort((a, b) => b.sesiones - a.sesiones);

      if (signal.aborted) return;
      setTarifaStats(stats);
      setTruncated(localTruncated);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') return;
      console.error('[CoworkingAnalysis] fetchStats error', err);
      toast.error('No se pudo cargar el análisis de coworking', {
        description: err?.message ?? 'Error de conexión con el servidor.',
      });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedTarifa) { setTopProducts([]); return; }
    abortTopRef.current?.abort();
    const ctrl = new AbortController();
    abortTopRef.current = ctrl;
    fetchTopProducts(selectedTarifa, ctrl.signal);
    return () => ctrl.abort();
  }, [selectedTarifa]);

  const fetchTopProducts = async (tarifaId: string, signal: AbortSignal) => {
    setLoadingTop(true);
    try {
      const { data: sessions, error: sErr } = await supabase
        .from('coworking_sessions')
        .select('id')
        .eq('tarifa_id', tarifaId)
        .in('estado', ['activo', 'finalizado', 'pendiente_pago'])
        .gte('fecha_inicio', desdeISO)
        .lte('fecha_inicio', hastaISO)
        .limit(SESSIONS_LIMIT)
        .abortSignal(signal);
      if (signal.aborted) return;
      if (sErr) throw sErr;

      if (!sessions?.length) { setTopProducts([]); return; }

      const sessionIds = sessions.map(s => s.id);
      const productSales = new Map<string, { cantidad: number; ingreso: number }>();

      for (let i = 0; i < sessionIds.length; i += 100) {
        if (signal.aborted) return;
        const batch = sessionIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from('detalle_ventas')
          .select('producto_id, cantidad, subtotal, tipo_concepto, ventas!inner(estado)')
          .in('coworking_session_id', batch)
          .not('producto_id', 'is', null)
          .in('tipo_concepto', ['producto', 'amenity'])
          .eq('ventas.estado', 'completada')
          .limit(DETALLES_LIMIT)
          .abortSignal(signal);
        if (error) throw error;
        ((data ?? []) as any[]).forEach(d => {
          if (!d.producto_id) return;
          const existing = productSales.get(d.producto_id) || { cantidad: 0, ingreso: 0 };
          existing.cantidad += d.cantidad;
          existing.ingreso += d.subtotal;
          productSales.set(d.producto_id, existing);
        });
      }

      if (productSales.size === 0) { setTopProducts([]); return; }

      const prodIds = [...productSales.keys()];
      const { data: prods, error: pErr } = await supabase
        .from('productos')
        .select('id, nombre')
        .in('id', prodIds)
        .abortSignal(signal);
      if (signal.aborted) return;
      if (pErr) throw pErr;

      const nameMap = new Map((prods ?? []).map(p => [p.id, p.nombre]));

      const top: TopProduct[] = [...productSales.entries()]
        .map(([id, stats]) => ({
          nombre: nameMap.get(id) || 'Desconocido',
          cantidad: stats.cantidad,
          ingreso: +stats.ingreso.toFixed(2),
        }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 3);

      setTopProducts(top);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') return;
      console.error('[CoworkingAnalysis] fetchTopProducts error', err);
      toast.error('No se pudieron cargar los productos top', {
        description: err?.message ?? 'Error de conexión con el servidor.',
      });
    } finally {
      if (!signal.aborted) setLoadingTop(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const selectedTarifaNombre = tarifaStats.find(t => t.tarifaId === selectedTarifa)?.tarifaNombre;

  const handleBarClick = (data: any) => {
    if (data?.activePayload?.[0]) {
      const tarifaId = data.activePayload[0].payload.tarifaId;
      setSelectedTarifa(prev => prev === tarifaId ? null : tarifaId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm py-16">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando análisis de coworking…
      </div>
    );
  }

  const hasSessions = tarifaStats.some(t => t.sesiones > 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Análisis de Coworking y Upsells
        </h2>
        <p className="text-sm text-muted-foreground">Volumen de sesiones e ingresos por consumo extra</p>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Volumen elevado: análisis limitado a {SESSIONS_LIMIT.toLocaleString('es-MX')} sesiones. Reduce el rango para mayor exactitud.
          </span>
        </div>
      )}

      {!hasSessions ? (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="py-12">
            <p className="text-muted-foreground text-sm text-center">No hay sesiones finalizadas en este periodo.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Chart 1: Popularidad de Tarifas */}
          <Card className="border-border/60 shadow-sm">
            <CardContent className="pt-6 pb-4">
              <h3 className="text-sm font-semibold text-foreground mb-4">Popularidad de Tarifas</h3>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tarifaStats.filter(t => t.sesiones > 0)} onClick={handleBarClick} style={{ cursor: 'pointer' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(30 15% 88%)" />
                    <XAxis
                      dataKey="tarifaNombre"
                      tick={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(30 15% 88%)' }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(30 15% 88%)' }}
                      allowDecimals={false}
                    />
                    <RechartsTooltip
                      formatter={(value: number) => [`${value} sesiones`, 'Sesiones']}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="sesiones" radius={[4, 4, 0, 0]}>
                      {tarifaStats.filter(t => t.sesiones > 0).map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={BAR_COLORS[idx % BAR_COLORS.length]}
                          opacity={selectedTarifa && tarifaStats.filter(t => t.sesiones > 0)[idx]?.tarifaId !== selectedTarifa ? 0.4 : 1}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 text-center">Haz clic en una barra para ver los upsells más populares de esa tarifa</p>
            </CardContent>
          </Card>

          {/* Chart 2: Ingreso Base vs Upsells (Stacked) */}
          <Card className="border-border/60 shadow-sm">
            <CardContent className="pt-6 pb-4">
              <h3 className="text-sm font-semibold text-foreground mb-4">Composición de Ingresos: Renta vs. Consumo Extra</h3>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tarifaStats.filter(t => t.ingresoTotal > 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(30 15% 88%)" />
                    <XAxis
                      dataKey="tarifaNombre"
                      tick={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(30 15% 88%)' }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(30 15% 88%)' }}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <RechartsTooltip
                      formatter={(value: number, name: string) => [fmt(value), name]}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    <Bar dataKey="ingresoCoworking" name="Renta de Espacio" stackId="stack" fill="hsl(25 65% 45%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="ingresoUpsells" name="Consumo Extra" stackId="stack" fill="hsl(36 72% 52%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Table 3: Top Upsells por Tarifa */}
          {selectedTarifa && (
            <Card className="border-border/60 shadow-sm">
              <CardContent className="pt-6 pb-4">
                <h3 className="text-sm font-semibold text-foreground mb-1">
                  Top Productos — <span className="text-primary">{selectedTarifaNombre}</span>
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {topProducts.length > 0
                    ? `Los ${topProducts.length} producto${topProducts.length > 1 ? 's' : ''} más vendido${topProducts.length > 1 ? 's' : ''} a clientes con esta tarifa`
                    : 'Productos más vendidos a clientes con esta tarifa'}
                </p>

                {loadingTop ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm py-8">
                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                  </div>
                ) : topProducts.length === 0 ? (
                  <p className="text-muted-foreground text-sm text-center py-8">Sin consumos extra registrados para esta tarifa.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Unidades</TableHead>
                        <TableHead className="text-right">Ingreso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.map((p, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">{p.nombre}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.cantidad}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(p.ingreso)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
