import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, XCircle, ChefHat, Clock, Package, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const ROWS_LIMIT = 5000;
// Pre-filtro: descartar comandas con duración > 2h (ticket olvidado / cierre tardío)
const KDS_MAX_PREP_MS = 1000 * 60 * 120;

interface Props {
  desde: Date;
  hasta: Date;
}

interface CancelMetrics {
  total: number;
  conItemsEntregados: number;
  sinItemsEntregados: number;
  totalItemsEntregados: number;
  totalMermas: number;
  topMotivos: { motivo: string; count: number }[];
}

interface KdsMetrics {
  totalOrdenes: number;
  totalItems: number;
  ordenesPendientes: number;
  ordenesEnPrep: number;
  ordenesListas: number;
  prepPromedioMin: number | null;
  ordenesAmenity: number;
  ordenesExtra: number;
}

export default function CoworkingOpsMetrics({ desde, hasta }: Props) {
  const [loading, setLoading] = useState(false);
  const [cancel, setCancel] = useState<CancelMetrics | null>(null);
  const [kds, setKds] = useState<KdsMetrics | null>(null);
  const [truncated, setTruncated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const desdeISO = format(desde, 'yyyy-MM-dd') + 'T00:00:00-06:00';
  const hastaISO = format(hasta, 'yyyy-MM-dd') + 'T23:59:59-06:00';

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    void fetchAll(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desdeISO, hastaISO]);

  const fetchAll = async (signal: AbortSignal) => {
    setLoading(true);
    setTruncated(false);
    try {
      await Promise.all([fetchCancelMetrics(signal), fetchKdsMetrics(signal)]);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') return;
      console.error('[CoworkingOpsMetrics] fetchAll error', err);
      toast.error('No se pudieron cargar las métricas operativas', {
        description: err?.message ?? 'Error de conexión con el servidor.',
      });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  const fetchCancelMetrics = async (signal: AbortSignal) => {
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('descripcion, metadata, created_at')
      .eq('accion', 'cancelar_sesion_coworking')
      .gte('created_at', desdeISO)
      .lte('created_at', hastaISO)
      .limit(ROWS_LIMIT)
      .abortSignal(signal);
    if (signal.aborted) return;
    if (error) throw error;
    if ((logs?.length ?? 0) >= ROWS_LIMIT) setTruncated(true);

    const rows = (logs ?? []) as any[];
    const motivosMap = new Map<string, number>();
    let conItems = 0;
    let totalItems = 0;
    let totalMermas = 0;

    for (const r of rows) {
      const md = r.metadata ?? {};
      const motivo = (md.motivo ?? 'Sin motivo').toString().trim() || 'Sin motivo';
      motivosMap.set(motivo, (motivosMap.get(motivo) ?? 0) + 1);

      const entregados: any[] = Array.isArray(md.entregados) ? md.entregados : [];
      const itemsCount = entregados.reduce(
        (acc, e) => acc + (Number(e?.cantidad) || 0),
        0,
      );
      if (itemsCount > 0) conItems++;
      totalItems += itemsCount;

      totalMermas += Number(md.mermas_creadas ?? 0) || 0;
    }

    const topMotivos = Array.from(motivosMap.entries())
      .map(([motivo, count]) => ({ motivo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    setCancel({
      total: rows.length,
      conItemsEntregados: conItems,
      sinItemsEntregados: rows.length - conItems,
      totalItemsEntregados: totalItems,
      totalMermas: totalMermas,
      topMotivos,
    });
  };

  const fetchKdsMetrics = async (signal: AbortSignal) => {
    const { data: orders, error: ordErr } = await supabase
      .from('kds_orders')
      .select('id, estado, created_at, updated_at, coworking_session_id, venta_id')
      .not('coworking_session_id', 'is', null)
      .gte('created_at', desdeISO)
      .lte('created_at', hastaISO)
      .limit(ROWS_LIMIT)
      .abortSignal(signal);
    if (signal.aborted) return;
    if (ordErr) throw ordErr;

    const ordersList = (orders ?? []) as any[];
    if (ordersList.length >= ROWS_LIMIT) setTruncated(true);
    if (ordersList.length === 0) {
      setKds({
        totalOrdenes: 0, totalItems: 0,
        ordenesPendientes: 0, ordenesEnPrep: 0, ordenesListas: 0,
        prepPromedioMin: null, ordenesAmenity: 0, ordenesExtra: 0,
      });
      return;
    }

    const orderIds = ordersList.map(o => o.id);
    const { data: items, error: itErr } = await supabase
      .from('kds_order_items')
      .select('kds_order_id, cantidad, nombre_producto')
      .in('kds_order_id', orderIds)
      .limit(ROWS_LIMIT)
      .abortSignal(signal);
    if (signal.aborted) return;
    if (itErr) throw itErr;

    const itemsList = (items ?? []) as any[];
    const totalItems = itemsList.reduce((acc, i) => acc + (Number(i.cantidad) || 0), 0);

    const itemsByOrder = new Map<string, any[]>();
    itemsList.forEach(i => {
      if (!itemsByOrder.has(i.kds_order_id)) itemsByOrder.set(i.kds_order_id, []);
      itemsByOrder.get(i.kds_order_id)!.push(i);
    });

    const ventaIds = ordersList.map(o => o.venta_id).filter(Boolean) as string[];
    const ventaTipos = new Map<string, Set<string>>();
    if (ventaIds.length > 0) {
      for (let i = 0; i < ventaIds.length; i += 100) {
        if (signal.aborted) return;
        const batch = ventaIds.slice(i, i + 100);
        const { data: dv, error: dvErr } = await supabase
          .from('detalle_ventas')
          .select('venta_id, tipo_concepto')
          .in('venta_id', batch)
          .abortSignal(signal);
        if (dvErr) throw dvErr;
        ((dv ?? []) as any[]).forEach(d => {
          if (!ventaTipos.has(d.venta_id)) ventaTipos.set(d.venta_id, new Set());
          ventaTipos.get(d.venta_id)!.add(d.tipo_concepto);
        });
      }
    }

    let ordenesAmenity = 0;
    let ordenesExtra = 0;
    for (const o of ordersList) {
      const its = itemsByOrder.get(o.id) ?? [];
      if (its.length === 0) continue;
      const tipos = o.venta_id ? ventaTipos.get(o.venta_id) : null;
      let isAmenity: boolean;
      if (tipos && tipos.size > 0) {
        const relevantes = new Set([...tipos].filter(t => t === 'amenity' || t === 'producto'));
        isAmenity = relevantes.size === 1 && relevantes.has('amenity');
      } else {
        isAmenity = its.every(i => (i.nombre_producto ?? '').includes('☕'));
      }
      if (isAmenity) ordenesAmenity++; else ordenesExtra++;
    }

    let pendientes = 0, enPrep = 0, listas = 0;
    const prepDurations: number[] = [];
    for (const o of ordersList) {
      if (o.estado === 'pendiente') pendientes++;
      else if (o.estado === 'en_preparacion') enPrep++;
      else if (o.estado === 'listo' || o.estado === 'entregado') {
        listas++;
        if (o.created_at && o.updated_at) {
          const ms = new Date(o.updated_at).getTime() - new Date(o.created_at).getTime();
          // Pre-filtro: solo durations realistas (>0 y <2h) para no sesgar promedios
          if (ms > 0 && ms < KDS_MAX_PREP_MS) prepDurations.push(ms);
        }
      }
    }

    const prepPromedioMin = prepDurations.length > 0
      ? prepDurations.reduce((a, b) => a + b, 0) / prepDurations.length / 60000
      : null;

    if (signal.aborted) return;
    setKds({
      totalOrdenes: ordersList.length,
      totalItems,
      ordenesPendientes: pendientes,
      ordenesEnPrep: enPrep,
      ordenesListas: listas,
      prepPromedioMin,
      ordenesAmenity,
      ordenesExtra,
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando métricas operativas...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Volumen elevado: métricas operativas limitadas a {ROWS_LIMIT.toLocaleString('es-MX')} registros. Reduce el rango para mayor exactitud.
          </span>
        </div>
      )}
      {/* Cancelaciones */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <XCircle className="h-5 w-5 text-destructive" />
            Cancelaciones de Sesiones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!cancel || cancel.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin cancelaciones de sesiones de coworking en este periodo.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricBox
                  icon={<XCircle className="h-4 w-4" />}
                  label="Total canceladas"
                  value={String(cancel.total)}
                />
                <MetricBox
                  icon={<Package className="h-4 w-4" />}
                  label="Con items entregados"
                  value={`${cancel.conItemsEntregados} / ${cancel.total}`}
                  hint={cancel.total > 0
                    ? `${Math.round((cancel.conItemsEntregados / cancel.total) * 100)}% requirieron merma`
                    : undefined}
                />
                <MetricBox
                  icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                  label="Items mermados"
                  value={String(cancel.totalItemsEntregados)}
                  hint={`${cancel.totalMermas} insumos descontados`}
                />
                <MetricBox
                  icon={<Package className="h-4 w-4 text-emerald-600" />}
                  label="Sin entrega"
                  value={String(cancel.sinItemsEntregados)}
                  hint="Canceladas antes de servir"
                />
              </div>

              {cancel.topMotivos.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-foreground">Motivos más frecuentes</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Motivo</TableHead>
                        <TableHead className="text-right">Veces</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cancel.topMotivos.map((m) => (
                        <TableRow key={m.motivo}>
                          <TableCell className="text-sm">{m.motivo}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">{m.count}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* KDS Coworking */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ChefHat className="h-5 w-5 text-primary" />
            Comandas de Cocina · Coworking
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!kds || kds.totalOrdenes === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin comandas KDS originadas desde sesiones de coworking en este periodo.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricBox
                  icon={<ChefHat className="h-4 w-4" />}
                  label="Comandas enviadas"
                  value={String(kds.totalOrdenes)}
                  hint={`${kds.totalItems} item(s) totales`}
                />
                <MetricBox
                  icon={<Clock className="h-4 w-4 text-emerald-600" />}
                  label="Tiempo prep. promedio"
                  value={kds.prepPromedioMin != null
                    ? `${kds.prepPromedioMin.toFixed(1)} min`
                    : '—'}
                  hint={kds.ordenesListas > 0 ? `Sobre ${kds.ordenesListas} comandas` : undefined}
                />
                <MetricBox
                  icon={<Package className="h-4 w-4 text-primary" />}
                  label="Solo amenities"
                  value={String(kds.ordenesAmenity)}
                  hint="Comandas de cortesía incluida"
                />
                <MetricBox
                  icon={<Package className="h-4 w-4 text-amber-600" />}
                  label="Con extras pagados"
                  value={String(kds.ordenesExtra)}
                  hint="Upsells o consumos extra"
                />
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="bg-muted/40">
                  Pendientes: {kds.ordenesPendientes}
                </Badge>
                <Badge variant="outline" className="bg-primary/10 border-primary/30">
                  En preparación: {kds.ordenesEnPrep}
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-700">
                  Listas / entregadas: {kds.ordenesListas}
                </Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricBox({
  icon, label, value, hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
