import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Download, Package, Loader2, ClipboardCheck, AlertTriangle, ChevronLeft, ChevronRight, Search, AlertCircle } from 'lucide-react';
import { format, endOfDay, isToday, addDays, subDays, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { useAuth } from '@/hooks/useAuth';

interface InsumoRow {
  id: string;
  nombre: string;
  unidad_medida: string;
  stock_actual: number;
  stock_minimo: number;
  costo_unitario: number;
  presentacion: string;
  cantidad_por_presentacion: number;
  costo_presentacion: number;
  categoria: string;
}

interface InsumoValuado {
  id: string;
  nombre: string;
  categoria: string;
  stockUnidades: number;
  stockMinimo: number;
  stockPresentacion: number;
  presentacion: string;
  unidad_medida: string;
  costoUnitario: number;
  valuacion: number;
  bajoStock: boolean;
}

interface MermaRow {
  id: string;
  cantidad: number;
  motivo: string;
  fecha: string;
  usuario_id: string;
  insumos: { nombre: string; unidad_medida: string } | null;
  usuario_nombre?: string;
}

export default function InventarioTab() {
  const { user } = useAuth();
  const [fecha, setFecha] = useState<Date>(new Date());
  const [insumos, setInsumos] = useState<InsumoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [ajustes, setAjustes] = useState<Map<string, number>>(new Map());
  const [truncated, setTruncated] = useState(false);

  // Audit state
  const [stockFisico, setStockFisico] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Mermas state
  const [mermas, setMermas] = useState<MermaRow[]>([]);
  const [mermasLoading, setMermasLoading] = useState(true);

  // UI filters
  const [search, setSearch] = useState('');
  const [categoriaFilter, setCategoriaFilter] = useState<string>('todas');
  const [soloBajoStock, setSoloBajoStock] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fecha]);

  useEffect(() => {
    fetchMermas();
  }, []);

  const fetchData = async (signal?: AbortSignal) => {
    setLoading(true);
    setTruncated(false);

    const LIM_VENTAS = 5000;
    const LIM_DETALLES = 10000;
    const LIM_UPSELLS = 5000;
    const LIM_MERMAS = 5000;
    const LIM_COMPRAS = 5000;
    const LIM_AUDIT = 5000;
    let truncatedLocal = false;

    try {
      const insumosQ = supabase.from('insumos')
        .select('id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, presentacion, cantidad_por_presentacion, costo_presentacion, categoria')
        .order('nombre')
        .limit(2000);
      const { data: insumosData, error: insumosErr } = await (signal ? insumosQ.abortSignal(signal) : insumosQ);
      if (insumosErr) throw insumosErr;
      if (signal?.aborted) return;

      setInsumos(insumosData ?? []);

      if (isToday(fecha)) {
        setAjustes(new Map());
        setLoading(false);
        return;
      }

      const desde = format(endOfDay(fecha), 'yyyy-MM-dd') + 'T23:59:59-06:00';
      const ajusteMap = new Map<string, number>();

      // 1) VENTAS completadas posteriores → consumos según receta (SUMAR)
      const ventasQ = supabase
        .from('ventas')
        .select('id')
        .eq('estado', 'completada')
        .gt('fecha', desde)
        .limit(LIM_VENTAS);
      const { data: ventasIds, error: ventasErr } = await (signal ? ventasQ.abortSignal(signal) : ventasQ);
      if (ventasErr) throw ventasErr;
      if (signal?.aborted) return;
      if (ventasIds && ventasIds.length >= LIM_VENTAS) truncatedLocal = true;

      const productoCantidad = new Map<string, number>();

      if (ventasIds && ventasIds.length > 0) {
        const ids = ventasIds.map(v => v.id);
        const allDetalles: { producto_id: string | null; paquete_id: string | null; cantidad: number }[] = [];
        for (let i = 0; i < ids.length; i += 100) {
          if (signal?.aborted) return;
          const batch = ids.slice(i, i + 100);
          const detQ = supabase
            .from('detalle_ventas')
            .select('producto_id, paquete_id, cantidad')
            .in('venta_id', batch)
            .limit(LIM_DETALLES);
          const { data, error } = await (signal ? detQ.abortSignal(signal) : detQ);
          if (error) throw error;
          if (data) {
            allDetalles.push(...data);
            if (data.length >= LIM_DETALLES) truncatedLocal = true;
          }
        }

        for (const d of allDetalles) {
          if (d.producto_id) {
            productoCantidad.set(d.producto_id, (productoCantidad.get(d.producto_id) ?? 0) + d.cantidad);
          }
        }

        const paqueteIds = [...new Set(allDetalles.filter(d => d.paquete_id).map(d => d.paquete_id!))];
        if (paqueteIds.length > 0) {
          const compQ = supabase
            .from('paquete_componentes')
            .select('paquete_id, producto_id, cantidad')
            .in('paquete_id', paqueteIds);
          const { data: componentes, error: compErr } = await (signal ? compQ.abortSignal(signal) : compQ);
          if (compErr) throw compErr;
          if (componentes) {
            for (const d of allDetalles) {
              if (!d.paquete_id) continue;
              const comps = componentes.filter(c => c.paquete_id === d.paquete_id);
              for (const c of comps) {
                productoCantidad.set(c.producto_id, (productoCantidad.get(c.producto_id) ?? 0) + c.cantidad * d.cantidad);
              }
            }
          }
        }
      }

      // 2) Consumos coworking (amenities/upsells/extras) en detalle_ventas con venta_id NULL
      const upsQ = supabase
        .from('detalle_ventas')
        .select('producto_id, cantidad, created_at')
        .gt('created_at', desde)
        .is('venta_id', null)
        .not('coworking_session_id', 'is', null)
        .limit(LIM_UPSELLS);
      const { data: upsellsData, error: upsErr } = await (signal ? upsQ.abortSignal(signal) : upsQ);
      if (upsErr) throw upsErr;
      if (signal?.aborted) return;
      if (upsellsData && upsellsData.length >= LIM_UPSELLS) truncatedLocal = true;

      if (upsellsData) {
        for (const u of (upsellsData as any[])) {
          if (!u.producto_id) continue;
          productoCantidad.set(u.producto_id, (productoCantidad.get(u.producto_id) ?? 0) + (u.cantidad ?? 0));
        }
      }

      // 3) Recetas para todos los productos consumidos
      const productoIdsAll = [...productoCantidad.keys()];
      if (productoIdsAll.length > 0) {
        const recQ = supabase
          .from('recetas')
          .select('producto_id, insumo_id, cantidad_necesaria')
          .in('producto_id', productoIdsAll);
        const { data: recetas, error: recErr } = await (signal ? recQ.abortSignal(signal) : recQ);
        if (recErr) throw recErr;
        if (recetas) {
          for (const r of recetas) {
            const cantProd = productoCantidad.get(r.producto_id) ?? 0;
            const consumed = r.cantidad_necesaria * cantProd;
            if (consumed > 0) {
              ajusteMap.set(r.insumo_id, (ajusteMap.get(r.insumo_id) ?? 0) + consumed);
            }
          }
        }
      }

      // 4) MERMAS posteriores → SUMAR
      const merQ = supabase
        .from('mermas')
        .select('insumo_id, cantidad')
        .gt('fecha', desde)
        .limit(LIM_MERMAS);
      const { data: mermasData, error: merErr } = await (signal ? merQ.abortSignal(signal) : merQ);
      if (merErr) throw merErr;
      if (signal?.aborted) return;
      if (mermasData && mermasData.length >= LIM_MERMAS) truncatedLocal = true;

      if (mermasData) {
        for (const m of mermasData) {
          ajusteMap.set(m.insumo_id, (ajusteMap.get(m.insumo_id) ?? 0) + m.cantidad);
        }
      }

      // 5) COMPRAS posteriores → RESTAR (excluir anuladas)
      const comQ = supabase
        .from('compras_insumos')
        .select('insumo_id, cantidad_unidades')
        .eq('anulada', false)
        .gt('fecha', desde)
        .limit(LIM_COMPRAS);
      const { data: comprasData, error: comErr } = await (signal ? comQ.abortSignal(signal) : comQ);
      if (comErr) throw comErr;
      if (signal?.aborted) return;
      if (comprasData && comprasData.length >= LIM_COMPRAS) truncatedLocal = true;

      if (comprasData) {
        for (const c of comprasData) {
          ajusteMap.set(c.insumo_id, (ajusteMap.get(c.insumo_id) ?? 0) - (c.cantidad_unidades ?? 0));
        }
      }

      // 6) AJUSTES de auditoría posteriores (revertir ingresos por auditoría)
      const audQ = supabase
        .from('audit_logs')
        .select('metadata')
        .eq('accion', 'ajuste_inventario')
        .gt('created_at', desde)
        .limit(LIM_AUDIT);
      const { data: auditEntries, error: audErr } = await (signal ? audQ.abortSignal(signal) : audQ);
      if (audErr) throw audErr;
      if (signal?.aborted) return;
      if (auditEntries && auditEntries.length >= LIM_AUDIT) truncatedLocal = true;

      if (auditEntries) {
        for (const entry of auditEntries) {
          const meta = entry.metadata as Record<string, unknown> | null;
          if (meta && meta.insumo_id && typeof meta.diferencia_stock === 'number') {
            const insumoId = meta.insumo_id as string;
            const diff = meta.diferencia_stock as number;
            if (diff > 0) {
              ajusteMap.set(insumoId, (ajusteMap.get(insumoId) ?? 0) - diff);
            }
          }
        }
      }

      if (signal?.aborted) return;
      setAjustes(ajusteMap);
      setTruncated(truncatedLocal);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (signal?.aborted || e?.name === 'AbortError') return;
      toast.error('No se pudo cargar el reporte de inventario', { description: e?.message });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  const fetchMermas = async () => {
    setMermasLoading(true);
    const { data: rawMermas } = await supabase
      .from('mermas')
      .select('id, cantidad, motivo, fecha, usuario_id, insumos(nombre, unidad_medida)')
      .order('fecha', { ascending: false })
      .limit(200);

    const rows = (rawMermas ?? []) as MermaRow[];
    const userIds = [...new Set(rows.map(r => r.usuario_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, nombre')
        .in('id', userIds);
      const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.nombre]));
      rows.forEach(r => { r.usuario_nombre = profileMap[r.usuario_id] ?? '—'; });
    }
    setMermas(rows);
    setMermasLoading(false);
  };

  const rows = useMemo<InsumoValuado[]>(() => {
    return insumos.map(ins => {
      const ajuste = ajustes.get(ins.id) ?? 0;
      const stockUnidades = Math.max(0, ins.stock_actual + ajuste);
      const stockPres = ins.cantidad_por_presentacion > 0
        ? stockUnidades / ins.cantidad_por_presentacion
        : stockUnidades;

      return {
        id: ins.id,
        nombre: ins.nombre,
        categoria: ins.categoria,
        stockUnidades,
        stockMinimo: ins.stock_minimo ?? 0,
        stockPresentacion: Math.round(stockPres * 100) / 100,
        presentacion: ins.presentacion,
        unidad_medida: ins.unidad_medida,
        costoUnitario: ins.costo_unitario,
        valuacion: Math.round(stockUnidades * ins.costo_unitario * 100) / 100,
        bajoStock: (ins.stock_minimo ?? 0) > 0 && stockUnidades <= (ins.stock_minimo ?? 0),
      };
    });
  }, [insumos, ajustes]);

  const totalValuacion = useMemo(() => rows.reduce((s, r) => s + r.valuacion, 0), [rows]);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.categoria) set.add(r.categoria); });
    return Array.from(set).sort();
  }, [rows]);

  const lowStockCount = useMemo(() => rows.filter(r => r.bajoStock).length, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (categoriaFilter !== 'todas' && r.categoria !== categoriaFilter) return false;
      if (soloBajoStock && !r.bajoStock) return false;
      if (q && !r.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, categoriaFilter, soloBajoStock]);

  const filteredInsumos = useMemo(() => {
    const ids = new Set(filteredRows.map(r => r.id));
    return insumos.filter(i => ids.has(i.id));
  }, [insumos, filteredRows]);

  const filteredValuacion = useMemo(() => filteredRows.reduce((s, r) => s + r.valuacion, 0), [filteredRows]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const fechaStr = format(fecha, 'dd_MMM_yyyy', { locale: es });

      // Sheet 1: Inventario
      const usarFiltro = filteredRows.length !== rows.length;
      const fuente = usarFiltro ? filteredRows : rows;
      const totalFuente = usarFiltro ? filteredValuacion : totalValuacion;

      const wsData = fuente.map(r => ({
        'Insumo': r.nombre,
        'Categoría': r.categoria,
        'Existencia (Presentación)': r.stockPresentacion,
        'Presentación': r.presentacion,
        'Stock (Unidades)': Math.round(r.stockUnidades * 100) / 100,
        'Unidad': r.unidad_medida,
        'Stock mínimo': r.stockMinimo,
        'Bajo stock': r.bajoStock ? 'Sí' : '',
        'Costo Unitario': r.costoUnitario,
        'Valuación Total': r.valuacion,
      }));

      wsData.push({
        'Insumo': 'TOTAL',
        'Categoría': '',
        'Existencia (Presentación)': 0,
        'Presentación': '',
        'Stock (Unidades)': 0,
        'Unidad': '',
        'Stock mínimo': 0,
        'Bajo stock': '',
        'Costo Unitario': 0,
        'Valuación Total': totalFuente,
      });

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws1, 'Inventario');
      XLSX.writeFile(wb, `Inventario_CocoCacao_${fechaStr}.xlsx`);
      toast.success('Archivo Excel exportado');
    } catch {
      toast.error('Error al exportar');
    }
    setExporting(false);
  };

  const handleSaveAudit = async () => {
    if (!user) return;
    const entries = insumos
      .filter(ins => {
        const val = stockFisico[ins.id];
        if (val === undefined || val === '') return false;
        const fisico = parseFloat(val);
        return !isNaN(fisico) && fisico !== ins.stock_actual;
      })
      .map(ins => ({
        insumo_id: ins.id,
        stock_fisico: parseFloat(stockFisico[ins.id]),
      }));

    if (entries.length === 0) {
      toast.info('No hay diferencias para guardar');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('aplicar_auditoria_inventario', {
        p_ajustes: entries,
      });
      if (error) throw error;
      const aplicados = (data as { aplicados?: number } | null)?.aplicados ?? entries.length;
      toast.success(`Auditoría guardada: ${aplicados} insumo(s) ajustados`);
      setStockFisico({});
      fetchData();
      fetchMermas();
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error('No se pudo aplicar la auditoría', {
        description: e?.message ?? 'Los cambios fueron revertidos. Intenta de nuevo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const fmtMoney = (v: number) => `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const hasAuditChanges = insumos.some(ins => {
    const val = stockFisico[ins.id];
    if (val === undefined || val === '') return false;
    const fisico = parseFloat(val);
    return !isNaN(fisico) && fisico !== ins.stock_actual;
  });

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground mr-1">Ver inventario a la fecha:</span>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setFecha(d => subDays(d, 1))}
            aria-label="Día anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-[200px] justify-start text-left font-normal", !fecha && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(fecha, 'PPP', { locale: es })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fecha}
                onSelect={(d) => d && setFecha(d)}
                disabled={(d) => d > new Date()}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const next = addDays(fecha, 1);
              if (next <= new Date()) setFecha(next);
            }}
            disabled={isToday(fecha)}
            aria-label="Día siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 ml-1">
            <Button
              variant={isToday(fecha) ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFecha(new Date())}
            >
              Hoy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFecha(startOfMonth(new Date()))}
            >
              Inicio mes
            </Button>
          </div>
        </div>

        <Button onClick={handleExport} disabled={exporting || loading} variant="outline" className="gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Exportar Inventario a Excel
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-4 py-5">
            <div className="p-3 rounded-lg bg-primary/10">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Valuación Total del Inventario</p>
              {loading ? (
                <Skeleton className="h-7 w-32 mt-1" />
              ) : (
                <p className="text-2xl font-bold text-foreground">{fmtMoney(totalValuacion)}</p>
              )}
              {!loading && filteredRows.length !== rows.length && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Filtrado: <span className="font-medium text-foreground">{fmtMoney(filteredValuacion)}</span> ({filteredRows.length} de {rows.length})
                </p>
              )}
              {!isToday(fecha) && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Estimación al {format(fecha, 'PPP', { locale: es })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={cn("border-border/60", lowStockCount > 0 && "border-destructive/40 bg-destructive/5")}>
          <CardContent className="flex items-center gap-4 py-5">
            <div className={cn("p-3 rounded-lg", lowStockCount > 0 ? "bg-destructive/10" : "bg-muted")}>
              <AlertCircle className={cn("h-6 w-6", lowStockCount > 0 ? "text-destructive" : "text-muted-foreground")} />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Insumos en stock bajo</p>
              {loading ? (
                <Skeleton className="h-7 w-16 mt-1" />
              ) : (
                <p className={cn("text-2xl font-bold", lowStockCount > 0 ? "text-destructive" : "text-foreground")}>
                  {lowStockCount}
                </p>
              )}
              {!loading && lowStockCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSoloBajoStock(v => !v)}
                  className="text-xs text-primary hover:underline mt-0.5"
                >
                  {soloBajoStock ? 'Mostrar todos' : 'Ver solo bajo stock'}
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {truncated && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Resultados parciales</p>
            <p className="text-xs opacity-90">
              Se alcanzó el límite de registros al reconstruir el inventario histórico. La valuación mostrada puede ser aproximada. Considera consultar una fecha más reciente.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar insumo por nombre…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {categorias.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={soloBajoStock ? 'default' : 'outline'}
          onClick={() => setSoloBajoStock(v => !v)}
          className="gap-2"
        >
          <AlertCircle className="h-4 w-4" />
          Bajo stock
        </Button>
      </div>

      {/* Audit Tool */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            Auditoría de Inventario (Teórico vs. Físico)
          </CardTitle>
          <Button
            onClick={handleSaveAudit}
            disabled={saving || loading || !hasAuditChanges}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            Guardar Auditoría
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-9 w-16" />
                  <Skeleton className="h-9 w-28" />
                  <Skeleton className="h-9 w-20" />
                </div>
              ))}
            </div>
          ) : insumos.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No hay insumos registrados.</p>
          ) : filteredInsumos.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No hay insumos que coincidan con los filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insumo</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Stock Teórico</TableHead>
                    <TableHead className="text-right">Mínimo</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead className="text-right w-[140px]">Stock Físico</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInsumos.map(ins => {
                    const val = stockFisico[ins.id] ?? '';
                    const fisico = val !== '' ? parseFloat(val) : null;
                    const diff = fisico !== null && !isNaN(fisico) ? fisico - ins.stock_actual : null;
                    const min = ins.stock_minimo ?? 0;
                    const bajo = min > 0 && ins.stock_actual <= min;

                    return (
                      <TableRow key={ins.id} className={cn(bajo && "bg-destructive/5")}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{ins.nombre}</span>
                            {bajo && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Bajo</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{ins.categoria}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", bajo && "text-destructive font-semibold")}>
                          {Math.round(ins.stock_actual * 100) / 100}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {min > 0 ? Math.round(min * 100) / 100 : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{ins.unidad_medida}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="—"
                            className="w-[120px] text-right ml-auto"
                            value={val}
                            onChange={(e) =>
                              setStockFisico(prev => ({ ...prev, [ins.id]: e.target.value }))
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {diff !== null && diff !== 0 ? (
                            <span className={diff < 0 ? 'text-destructive' : 'text-green-600'}>
                              {diff > 0 ? '+' : ''}{Math.round(diff * 100) / 100}
                            </span>
                          ) : diff === 0 ? (
                            <span className="text-muted-foreground">0</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mermas History */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Historial de Mermas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {mermasLoading ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Cargando mermas…</span>
            </div>
          ) : mermas.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">Sin mermas registradas</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Registrado por</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mermas.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell className="font-medium">{m.insumos?.nombre ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      -{m.cantidad} {m.insumos?.unidad_medida}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{m.motivo}</TableCell>
                    <TableCell className="text-muted-foreground">{m.usuario_nombre ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
