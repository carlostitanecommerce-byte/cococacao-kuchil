import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, ChevronDown, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, subWeeks, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell, Label } from 'recharts';
import { toast } from 'sonner';
import CoworkingAnalysis from './CoworkingAnalysis';
import CoworkingOpsMetrics from './CoworkingOpsMetrics';

interface MenuProduct {
  id: string;
  nombre: string;
  categoria: string;
  precioVenta: number;
  costoTotal: number;
  margen: number;
  cantidadVendida: number;
  contribucionTotal: number;
  isUpsell: boolean;
  cuadrante: 'estrella' | 'caballo' | 'rompecabezas' | 'perro';
}

const CUADRANTE_LABELS: Record<string, { label: string; bg: string; desc: string }> = {
  estrella: { label: '⭐ Estrella', bg: 'bg-accent/10 text-accent', desc: 'Alta popularidad y alta rentabilidad.' },
  caballo: { label: '🐴 Caballo de Batalla', bg: 'bg-emerald-500/10 text-emerald-700', desc: 'Alta popularidad pero baja rentabilidad.' },
  rompecabezas: { label: '🧩 Rompecabezas', bg: 'bg-primary/10 text-primary', desc: 'Baja popularidad pero alta rentabilidad. Oportunidad de impulsar ventas.' },
  perro: { label: '🐕 Perro', bg: 'bg-muted text-muted-foreground', desc: 'Baja popularidad y baja rentabilidad. Candidatos a salir del menú.' },
};

const CUADRANTE_COLORS: Record<string, string> = {
  estrella: 'hsl(36 72% 52%)',
  caballo: 'hsl(155 50% 40%)',
  rompecabezas: 'hsl(25 65% 45%)',
  perro: 'hsl(25 15% 55%)',
};

const TOP_LIMIT = 15;
const VENTAS_LIMIT = 5000;
const DETALLES_LIMIT = 5000;
const UPSELLS_LIMIT = 5000;

export default function MenuTab() {
  const [periodo, setPeriodo] = useState<'semana' | 'mes'>('semana');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [showNoSales, setShowNoSales] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSetPeriodo = (p: 'semana' | 'mes') => {
    setPeriodo(p);
    setOffset(0);
  };

  const rango = useMemo(() => {
    const now = new Date();
    const base = periodo === 'semana' ? subWeeks(now, offset) : subMonths(now, offset);
    if (periodo === 'semana') {
      return { desde: startOfWeek(base, { weekStartsOn: 1 }), hasta: endOfWeek(base, { weekStartsOn: 1 }) };
    }
    return { desde: startOfMonth(base), hasta: endOfMonth(base) };
  }, [periodo, offset]);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetchData(ctrl.signal);
    setShowAll(false);
    return () => ctrl.abort();
  }, [rango]);

  const fetchData = async (signal: AbortSignal) => {
    setLoading(true);
    setTruncated(false);
    const desdeISO = format(rango.desde, 'yyyy-MM-dd') + 'T00:00:00-06:00';
    const hastaISO = format(rango.hasta, 'yyyy-MM-dd') + 'T23:59:59-06:00';

    try {
      const [productosRes, ventasRes, upsellsRes] = await Promise.all([
        supabase
          .from('productos')
          .select('id, nombre, categoria, precio_venta, costo_total, activo, tipo')
          .eq('activo', true)
          .in('tipo', ['simple', 'paquete'])
          .abortSignal(signal),
        supabase
          .from('ventas')
          .select('id')
          .eq('estado', 'completada')
          .gte('fecha', desdeISO)
          .lte('fecha', hastaISO)
          .limit(VENTAS_LIMIT)
          .abortSignal(signal),
        // Upsells reales del período: marcamos isUpsell por uso operativo,
        // no por configuración de producto. Vienen de detalle_ventas vinculados a sesión coworking.
        supabase
          .from('detalle_ventas')
          .select('producto_id')
          .gte('created_at', desdeISO)
          .lte('created_at', hastaISO)
          .not('coworking_session_id', 'is', null)
          .eq('tipo_concepto', 'producto')
          .limit(UPSELLS_LIMIT)
          .abortSignal(signal),
      ]);

      if (signal.aborted) return;
      if (productosRes.error) throw productosRes.error;
      if (ventasRes.error) throw ventasRes.error;
      if (upsellsRes.error) throw upsellsRes.error;

      const productos = productosRes.data ?? [];
      const ventaIds = (ventasRes.data ?? []).map(v => v.id);
      const upsellSet = new Set((upsellsRes.data ?? []).map((r: any) => r.producto_id).filter(Boolean));
      let localTruncated = ventaIds.length >= VENTAS_LIMIT;

      const salesMap: Record<string, number> = {};
      for (let i = 0; i < ventaIds.length; i += 100) {
        if (signal.aborted) return;
        const batch = ventaIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from('detalle_ventas')
          .select('producto_id, paquete_id, cantidad, tipo_concepto')
          .in('venta_id', batch)
          // Solo ventas reales del menú: excluimos 'amenity' (cortesía incluida
          // en la tarifa, ingreso $0) y 'coworking' (renta de espacio).
          .eq('tipo_concepto', 'producto')
          .limit(DETALLES_LIMIT)
          .abortSignal(signal);
        if (error) throw error;
        const rows = data ?? [];
        if (rows.length >= DETALLES_LIMIT) localTruncated = true;
        rows.forEach((d: any) => {
          // Atribuir al paquete maestro si aplica.
          const id = d.paquete_id ?? d.producto_id;
          if (id) salesMap[id] = (salesMap[id] || 0) + d.cantidad;
        });
      }

      if (signal.aborted) return;

      const items: MenuProduct[] = productos.map(p => {
        const precioSinIVA = p.precio_venta / 1.16;
        const margen = +(precioSinIVA - p.costo_total).toFixed(2);
        const cantidadVendida = salesMap[p.id] || 0;
        return {
          id: p.id,
          nombre: p.nombre,
          categoria: p.categoria,
          precioVenta: p.precio_venta,
          costoTotal: p.costo_total,
          margen,
          cantidadVendida,
          contribucionTotal: +(margen * cantidadVendida).toFixed(2),
          // Flag operativo: el producto se vendió como upsell de coworking
          // dentro del período seleccionado.
          isUpsell: upsellSet.has(p.id),
          cuadrante: 'perro' as const,
        };
      });

      const withSales = items.filter(i => i.cantidadVendida > 0);
      const avgMargen = withSales.length > 0 ? withSales.reduce((s, i) => s + i.margen, 0) / withSales.length : 0;
      const avgPop = withSales.length > 0 ? withSales.reduce((s, i) => s + i.cantidadVendida, 0) / withSales.length : 0;

      items.forEach(item => {
        const highMargin = item.margen >= avgMargen;
        const highPop = item.cantidadVendida >= avgPop;
        if (highMargin && highPop) item.cuadrante = 'estrella';
        else if (!highMargin && highPop) item.cuadrante = 'caballo';
        else if (highMargin && !highPop) item.cuadrante = 'rompecabezas';
        else item.cuadrante = 'perro';
      });

      if (signal.aborted) return;
      setProducts(items);
      setTruncated(localTruncated);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') return;
      console.error('[MenuTab] fetchData error', err);
      toast.error('No se pudo cargar el análisis de menú', {
        description: err?.message ?? 'Error de conexión con el servidor.',
      });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  const withSales = useMemo(() => products.filter(p => p.cantidadVendida > 0), [products]);

  const { avgMargen, avgPopularidad } = useMemo(() => {
    if (withSales.length === 0) return { avgMargen: 0, avgPopularidad: 0 };
    return {
      avgMargen: withSales.reduce((s, i) => s + i.margen, 0) / withSales.length,
      avgPopularidad: withSales.reduce((s, i) => s + i.cantidadVendida, 0) / withSales.length,
    };
  }, [withSales]);

  const tableProducts = useMemo(() => {
    const source = showNoSales ? products : withSales;
    return [...source].sort((a, b) => b.contribucionTotal - a.contribucionTotal);
  }, [products, withSales, showNoSales]);

  const visibleTable = showAll ? tableProducts : tableProducts.slice(0, TOP_LIMIT);

  const periodoLabel = periodo === 'semana'
    ? `${format(rango.desde, 'd MMM', { locale: es })} – ${format(rango.hasta, 'd MMM yyyy', { locale: es })}`
    : format(rango.desde, 'MMMM yyyy', { locale: es });

  const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const p = payload[0].payload as MenuProduct;
    const info = CUADRANTE_LABELS[p.cuadrante];
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2.5 text-xs shadow-md max-w-[240px]">
        <p className="font-semibold text-foreground break-words">{p.nombre}</p>
        <p className="text-muted-foreground">{p.categoria}</p>
        {p.isUpsell && <Badge variant="outline" className="text-[9px] mt-1 px-1.5 py-0">Upsell</Badge>}
        <div className="mt-1.5 space-y-0.5">
          <p>Vendidos: <span className="font-medium">{p.cantidadVendida} uds</span></p>
          <p>Margen: <span className="font-medium">{fmt(p.margen)}</span></p>
          <p>Contribución: <span className="font-medium">{fmt(p.contribucionTotal)}</span></p>
        </div>
        <Badge variant="outline" className={`text-[9px] mt-1.5 ${info.bg}`}>{info.label}</Badge>
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{info.desc}</p>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-heading font-bold text-foreground">Ingeniería de Menú</h2>
          <p className="text-sm text-muted-foreground capitalize">{periodoLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <Button variant={periodo === 'semana' ? 'default' : 'ghost'} size="sm" className="rounded-none text-xs h-8" onClick={() => handleSetPeriodo('semana')}>
              Semana
            </Button>
            <Button variant={periodo === 'mes' ? 'default' : 'ghost'} size="sm" className="rounded-none text-xs h-8" onClick={() => handleSetPeriodo('mes')}>
              Mes
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o + 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground capitalize min-w-[140px] text-center">{periodoLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={offset === 0} onClick={() => setOffset(o => o - 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {offset !== 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setOffset(0)}>
                Hoy
              </Button>
            )}
          </div>
        </div>
      </div>

      {truncated && !loading && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Volumen de datos elevado: se analizaron los primeros {VENTAS_LIMIT.toLocaleString('es-MX')} registros del periodo.
            Reduce el rango para mayor exactitud.
          </span>
        </div>
      )}

      <Card className="border-border/60 shadow-sm">
        <CardContent className="pt-6 pb-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-[420px] w-full" />
              <div className="flex gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-28" />
                ))}
              </div>
            </div>
          ) : withSales.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-12">No hay productos con ventas en este periodo.</p>
          ) : (
            <div className="w-full" style={{ height: 420 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(30 15% 88%)" />
                  <XAxis type="number" dataKey="cantidadVendida" name="Popularidad" tick={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }} tickLine={false} axisLine={{ stroke: 'hsl(30 15% 88%)' }}>
                    <Label value="Popularidad (uds vendidas)" position="bottom" offset={10} style={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }} />
                  </XAxis>
                  <YAxis type="number" dataKey="margen" name="Margen" tick={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }} tickLine={false} axisLine={{ stroke: 'hsl(30 15% 88%)' }}>
                    <Label value="Margen ($)" angle={-90} position="left" offset={0} style={{ fontSize: 11, fill: 'hsl(25 10% 46%)' }} />
                  </YAxis>
                  <RechartsTooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 50 }} />
                  <ReferenceLine x={avgPopularidad} stroke="hsl(25 30% 60%)" strokeDasharray="6 4" strokeWidth={1.5} />
                  <ReferenceLine y={avgMargen} stroke="hsl(25 30% 60%)" strokeDasharray="6 4" strokeWidth={1.5} />
                  <Scatter data={withSales} fill="hsl(25 65% 28%)">
                    {withSales.map((p, idx) => (
                      <Cell key={idx} fill={CUADRANTE_COLORS[p.cuadrante]} r={6} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>

              <TooltipProvider delayDuration={200}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
                  {(['estrella', 'caballo', 'rompecabezas', 'perro'] as const).map(q => {
                    const info = CUADRANTE_LABELS[q];
                    const count = withSales.filter(p => p.cuadrante === q).length;
                    return (
                      <Tooltip key={q}>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-default">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CUADRANTE_COLORS[q] }} />
                            <span>{info.label}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{count}</Badge>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                          {info.desc}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </TooltipProvider>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Top Impacto Económico</h3>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              Ver productos sin ventas
              <Switch checked={showNoSales} onCheckedChange={setShowNoSales} disabled={loading} />
            </label>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead>Categoría</TableHead>
                      <TableHead className="text-right">Vendidos</TableHead>
                      <TableHead className="text-right">Margen Unit.</TableHead>
                      <TableHead className="text-right">Contribución</TableHead>
                      <TableHead>Clasificación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleTable.map(p => {
                      const info = CUADRANTE_LABELS[p.cuadrante];
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {p.nombre}
                              {p.isUpsell && <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">Upsell</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.categoria}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.cantidadVendida}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(p.margen)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmt(p.contribucionTotal)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${info.bg}`}>{info.label}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {tableProducts.length > TOP_LIMIT && !showAll && (
                <div className="flex justify-center mt-4">
                  <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setShowAll(true)}>
                    <ChevronDown className="h-3.5 w-3.5" />
                    Ver {tableProducts.length - TOP_LIMIT} productos más
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <CoworkingAnalysis desde={rango.desde} hasta={rango.hasta} />
      <CoworkingOpsMetrics desde={rango.desde} hasta={rango.hasta} />
    </div>
  );
}
