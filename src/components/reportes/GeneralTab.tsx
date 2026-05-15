import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Download, FileSpreadsheet, Loader2, Receipt, CreditCard, TrendingUp, Wallet, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, addDays, subDays, isSameDay, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchCajaResumen } from '@/lib/cajaUtils';

interface VentaRow {
  id: string;
  folio: number;
  fecha: string;
  total_bruto: number;
  total_neto: number;
  iva: number;
  comisiones_bancarias: number;
  metodo_pago: string;
  estado: string;
  coworking_session_id: string | null;
  monto_propina: number;
  monto_tarjeta: number;
  monto_efectivo: number;
  monto_transferencia: number;
}

interface DetalleRow {
  id: string;
  venta_id: string;
  producto_id: string | null;
  descripcion: string | null;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  tipo_concepto: string;
  coworking_session_id: string | null;
  paquete_id: string | null;
}

interface ProductoMap {
  [id: string]: { nombre: string; categoria: string };
}

interface RecetaRow {
  producto_id: string;
  insumo_id: string;
  cantidad_necesaria: number;
}

interface InsumoMap {
  [id: string]: { nombre: string; categoria: string; unidad_medida: string; costo_unitario: number };
}

interface ProductoFull {
  id: string;
  nombre: string;
  categoria: string;
  tipo: string;
}

interface PaqueteComponente {
  paquete_id: string;
  producto_id: string;
  cantidad: number;
}

interface ConfigVentas {
  ivaPorcentaje: number;        // ej. 16
  comisionPorcentaje: number;   // ej. 3.5
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const metodoPagoLabel: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

export default function GeneralTab() {
  const [desde, setDesde] = useState<Date>(startOfMonth(new Date()));
  const [hasta, setHasta] = useState<Date>(endOfMonth(new Date()));
  const [ventas, setVentas] = useState<VentaRow[]>([]);
  const [detalles, setDetalles] = useState<DetalleRow[]>([]);
  const [productos, setProductos] = useState<ProductoMap>({});
  const [recetas, setRecetas] = useState<RecetaRow[]>([]);
  const [insumos, setInsumos] = useState<InsumoMap>({});
  const [loading, setLoading] = useState(false);
  const [exportingSales, setExportingSales] = useState(false);
  const [exportingCOGS, setExportingCOGS] = useState(false);
  const [exportingCaja, setExportingCaja] = useState(false);

  const [paqueteComponentes, setPaqueteComponentes] = useState<PaqueteComponente[]>([]);
  const [config, setConfig] = useState<ConfigVentas>({ ivaPorcentaje: 16, comisionPorcentaje: 0 });

  // L2: control de race conditions y resultados truncados
  const abortRef = useRef<AbortController | null>(null);
  const [truncated, setTruncated] = useState<string[]>([]);

  // L2: límites explícitos (Supabase trunca silenciosamente a 1000 por defecto)
  const LIMIT_VENTAS = 10000;
  const LIMIT_DETALLES = 20000;
  const LIMIT_CATALOGO = 5000;

  useEffect(() => {
    fetchData();
    return () => {
      abortRef.current?.abort();
    };
  }, [desde, hasta]);

  const fetchData = async () => {
    // L2: cancela petición previa si el usuario cambia el rango rápido
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setTruncated([]);
    const desdeISO = format(desde, 'yyyy-MM-dd') + 'T00:00:00-06:00';
    const hastaISO = format(hasta, 'yyyy-MM-dd') + 'T23:59:59-06:00';

    try {
      const [ventasRes, productosRes, recetasRes, insumosRes, paqueteRes, configRes] = await Promise.all([
        supabase
          .from('ventas')
          .select('id, folio, fecha, total_bruto, total_neto, iva, comisiones_bancarias, metodo_pago, estado, coworking_session_id, monto_propina, monto_tarjeta, monto_efectivo, monto_transferencia')
          .gte('fecha', desdeISO)
          .lte('fecha', hastaISO)
          .eq('estado', 'completada')
          .order('fecha', { ascending: true })
          .limit(LIMIT_VENTAS)
          .abortSignal(signal),
        supabase.from('productos').select('id, nombre, categoria, tipo').limit(LIMIT_CATALOGO).abortSignal(signal),
        supabase.from('recetas').select('producto_id, insumo_id, cantidad_necesaria').limit(LIMIT_CATALOGO).abortSignal(signal),
        supabase.from('insumos').select('id, nombre, categoria, unidad_medida, costo_unitario').limit(LIMIT_CATALOGO).abortSignal(signal),
        supabase.from('paquete_componentes').select('paquete_id, producto_id, cantidad').limit(LIMIT_CATALOGO).abortSignal(signal),
        supabase.from('configuracion_ventas').select('clave, valor').abortSignal(signal),
      ]);

      if (signal.aborted) return;

      // L2: error explícito si alguna consulta falló
      const failed = [
        { name: 'ventas', err: ventasRes.error },
        { name: 'productos', err: productosRes.error },
        { name: 'recetas', err: recetasRes.error },
        { name: 'insumos', err: insumosRes.error },
        { name: 'paquetes', err: paqueteRes.error },
        { name: 'configuración', err: configRes.error },
      ].filter(x => x.err);
      if (failed.length > 0) {
        throw new Error(`Error al cargar ${failed.map(f => f.name).join(', ')}`);
      }

      const ventasData = ventasRes.data ?? [];
      setVentas(ventasData);

      // L2: rastrear truncado
      const trunc: string[] = [];
      if (ventasData.length >= LIMIT_VENTAS) trunc.push(`ventas (${LIMIT_VENTAS})`);

      const pMap: ProductoMap = {};
      (productosRes.data ?? []).forEach((p: ProductoFull) => {
        pMap[p.id] = { nombre: p.nombre, categoria: p.categoria };
      });
      setProductos(pMap);
      setRecetas(recetasRes.data ?? []);
      setPaqueteComponentes(paqueteRes.data ?? []);

      const iMap: InsumoMap = {};
      (insumosRes.data ?? []).forEach(i => { iMap[i.id] = { nombre: i.nombre, categoria: i.categoria, unidad_medida: i.unidad_medida, costo_unitario: i.costo_unitario }; });
      setInsumos(iMap);

      const cfgRows = configRes.data ?? [];
      const ivaRow = cfgRows.find(r => r.clave === 'iva_porcentaje');
      const comRow = cfgRows.find(r => r.clave === 'comision_bancaria_porcentaje');
      setConfig({
        ivaPorcentaje: ivaRow ? Number(ivaRow.valor) : 16,
        comisionPorcentaje: comRow ? Number(comRow.valor) : 0,
      });

      if (ventasData.length > 0) {
        const ventaIds = ventasData.map(v => v.id);
        const allDetalles: DetalleRow[] = [];
        let detalleAborted = false;
        for (let i = 0; i < ventaIds.length; i += 100) {
          if (signal.aborted) { detalleAborted = true; break; }
          if (allDetalles.length >= LIMIT_DETALLES) break;
          const batch = ventaIds.slice(i, i + 100);
          const { data, error } = await supabase
            .from('detalle_ventas')
            .select('id, venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, tipo_concepto, coworking_session_id, paquete_id')
            .in('venta_id', batch)
            .limit(LIMIT_DETALLES)
            .abortSignal(signal);
          if (error) throw new Error(`Error al cargar detalles de venta: ${error.message}`);
          if (data) allDetalles.push(...data);
        }
        if (detalleAborted) return;
        if (allDetalles.length >= LIMIT_DETALLES) trunc.push(`detalles (${LIMIT_DETALLES})`);
        setDetalles(allDetalles as DetalleRow[]);
      } else {
        setDetalles([]);
      }

      setTruncated(trunc);
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') return;
      console.error('Exportación contable - fetchData error:', err);
      toast.error(err?.message || 'Error al cargar datos del reporte contable');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  // L1: índice O(1) de recetas por producto (también usado para expansión de paquetes)
  const recetasPorProducto = useMemo(() => {
    const map: Record<string, RecetaRow[]> = {};
    recetas.forEach(r => {
      (map[r.producto_id] ||= []).push(r);
    });
    return map;
  }, [recetas]);

  // L1: índice de componentes por paquete
  const componentesPorPaquete = useMemo(() => {
    const map: Record<string, PaqueteComponente[]> = {};
    paqueteComponentes.forEach(c => {
      (map[c.paquete_id] ||= []).push(c);
    });
    return map;
  }, [paqueteComponentes]);

  // L1: dado un detalle (producto simple o paquete) devuelve costo total real de insumos
  const costoInsumosDeDetalle = (d: DetalleRow): number => {
    let costo = 0;
    const acumulaProducto = (productoId: string, factor: number) => {
      const recs = recetasPorProducto[productoId] || [];
      recs.forEach(r => {
        const ins = insumos[r.insumo_id];
        if (ins) costo += r.cantidad_necesaria * factor * ins.costo_unitario;
      });
    };
    if (d.paquete_id) {
      const comps = componentesPorPaquete[d.paquete_id] || [];
      comps.forEach(c => acumulaProducto(c.producto_id, c.cantidad * d.cantidad));
    } else if (d.producto_id) {
      acumulaProducto(d.producto_id, d.cantidad);
    }
    return costo;
  };

  const kpis = useMemo(() => {
    const ingresoGravable = ventas.reduce((s, v) => s + Number(v.total_neto), 0);
    const totalPropinas = ventas.reduce((s, v) => s + Number(v.monto_propina), 0);
    const ivaTotal = ventas.reduce((s, v) => s + Number(v.iva), 0);
    // L1: comisiones reales registradas en la venta (no recalculadas)
    const comisionesTotal = ventas.reduce((s, v) => s + Number(v.comisiones_bancarias), 0);

    // L1: COGS expandiendo paquetes y usando índice O(1)
    let costoInsumos = 0;
    detalles.forEach(d => {
      costoInsumos += costoInsumosDeDetalle(d);
    });

    const utilidad = ingresoGravable - ivaTotal - comisionesTotal - costoInsumos;
    return { ingresoGravable, totalPropinas, ivaTotal, comisionesTotal, costoInsumos, utilidad };
  }, [ventas, detalles, recetasPorProducto, componentesPorPaquete, insumos]);

  const fileNameSuffix = () => {
    const m1 = MESES[desde.getMonth()];
    const y1 = desde.getFullYear();
    const m2 = MESES[hasta.getMonth()];
    const y2 = hasta.getFullYear();
    return m1 === m2 && y1 === y2 ? `${m1}_${y1}` : `${m1}${y1}_${m2}${y2}`;
  };

  const exportVentas = async () => {
    setExportingSales(true);
    try {
      const ivaFactor = 1 + config.ivaPorcentaje / 100; // p.ej. 1.16
      const ivaLabel = `IVA (${config.ivaPorcentaje}%)`;

      // L1: agrupar líneas por venta para prorratear comisiones y propinas reales
      const detallesPorVenta: Record<string, DetalleRow[]> = {};
      detalles.forEach(d => {
        (detallesPorVenta[d.venta_id] ||= []).push(d);
      });

      const rows: any[] = [];

      ventas.forEach(venta => {
        const lineas = detallesPorVenta[venta.id] || [];
        const totalLineas = lineas.reduce((s, l) => s + Number(l.subtotal), 0);
        const comisionVenta = Number(venta.comisiones_bancarias) || 0;
        const propinaVenta = Number(venta.monto_propina) || 0;

        let comisionAcum = 0;
        let propinaAcum = 0;

        lineas.forEach((d, idx) => {
          const totalLinea = Number(d.subtotal);
          const subtSinIVA = +(totalLinea / ivaFactor).toFixed(2);
          const ivaLinea = +(totalLinea - subtSinIVA).toFixed(2);

          // L1: nombre/categoría — soporta producto simple, paquete, coworking, amenity
          let concepto = d.descripcion || '';
          let categoria = '';
          if (d.paquete_id && productos[d.paquete_id]) {
            concepto = productos[d.paquete_id].nombre;
            categoria = productos[d.paquete_id].categoria;
          } else if (d.producto_id && productos[d.producto_id]) {
            concepto = productos[d.producto_id].nombre;
            categoria = productos[d.producto_id].categoria;
          } else if (d.tipo_concepto === 'coworking') {
            concepto = d.descripcion || 'Servicio Coworking';
            categoria = 'Coworking';
          } else if (d.tipo_concepto === 'amenity') {
            concepto = d.descripcion || 'Amenidad';
            categoria = 'Amenidades';
          }

          // L1: comisión real prorrateada por participación de la línea en el total
          let comisionLinea = 0;
          if (comisionVenta > 0 && totalLineas > 0) {
            if (idx === lineas.length - 1) {
              // última línea: residual para que sume exacto
              comisionLinea = +(comisionVenta - comisionAcum).toFixed(2);
            } else {
              comisionLinea = +((totalLinea / totalLineas) * comisionVenta).toFixed(2);
              comisionAcum += comisionLinea;
            }
          }

          // L1: propina prorrateada (en lugar de cargarla a la primera línea)
          let propinaLinea = 0;
          if (propinaVenta > 0 && totalLineas > 0) {
            if (idx === lineas.length - 1) {
              propinaLinea = +(propinaVenta - propinaAcum).toFixed(2);
            } else {
              propinaLinea = +((totalLinea / totalLineas) * propinaVenta).toFixed(2);
              propinaAcum += propinaLinea;
            }
          }

          rows.push({
            'Fecha y Hora': format(new Date(venta.fecha), 'dd/MM/yyyy HH:mm', { locale: es }),
            'Folio del Ticket': `#${String(venta.folio).padStart(4, '0')}`,
            'Concepto': concepto,
            'Categoría': categoria,
            'Cantidad': d.cantidad,
            'Precio Unitario': Number(d.precio_unitario),
            'Subtotal': subtSinIVA,
            [ivaLabel]: ivaLinea,
            'Comisión Bancaria': comisionLinea,
            'Total': totalLinea,
            'Propina': propinaLinea,
            'Método de Pago': metodoPagoLabel[venta.metodo_pago] || venta.metodo_pago,
            'Monto Efectivo': Number(venta.monto_efectivo),
            'Monto Tarjeta': Number(venta.monto_tarjeta),
            'Monto Transferencia': Number(venta.monto_transferencia),
          });
        });
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 18 }, { wch: 12 }, { wch: 30 }, { wch: 16 },
        { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
        { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      ];
      const wb = XLSX.utils.book_new();

      // L3: Hoja "Resumen" con totales del periodo (consistente con KPIs en pantalla)
      const ventasCount = ventas.length;
      const desgloseEfectivo = ventas.reduce((s, v) => s + Number(v.monto_efectivo), 0);
      const desgloseTarjeta = ventas.reduce((s, v) => s + Number(v.monto_tarjeta), 0);
      const desgloseTransfer = ventas.reduce((s, v) => s + Number(v.monto_transferencia), 0);
      const subtotalSinIVA = +(kpis.ingresoGravable / (1 + config.ivaPorcentaje / 100)).toFixed(2);

      const resumenRows: (string | number)[][] = [
        ['Reporte de Ventas para Contabilidad', ''],
        ['Periodo', `${format(desde, 'dd/MM/yyyy')} – ${format(hasta, 'dd/MM/yyyy')}`],
        ['Generado', format(new Date(), 'dd/MM/yyyy HH:mm', { locale: es })],
        ['', ''],
        ['Tickets', ventasCount],
        ['Líneas exportadas', rows.length],
        ['', ''],
        ['Subtotal (sin IVA)', subtotalSinIVA],
        [`IVA (${config.ivaPorcentaje}%)`, +kpis.ivaTotal.toFixed(2)],
        ['Ingreso Gravable (con IVA)', +kpis.ingresoGravable.toFixed(2)],
        ['Propinas (no gravable)', +kpis.totalPropinas.toFixed(2)],
        ['Ingreso Bruto Total', +(kpis.ingresoGravable + kpis.totalPropinas).toFixed(2)],
        ['', ''],
        ['Comisiones bancarias (reales)', +kpis.comisionesTotal.toFixed(2)],
        ['COGS (costo de insumos)', +kpis.costoInsumos.toFixed(2)],
        ['Utilidad Estimada', +kpis.utilidad.toFixed(2)],
        ['', ''],
        ['Cobrado en Efectivo', +desgloseEfectivo.toFixed(2)],
        ['Cobrado en Tarjeta', +desgloseTarjeta.toFixed(2)],
        ['Cobrado en Transferencia', +desgloseTransfer.toFixed(2)],
      ];
      if (truncated.length > 0) {
        resumenRows.push(['', '']);
        resumenRows.push(['⚠ Resultados parciales', truncated.join(', ')]);
      }
      const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
      wsResumen['!cols'] = [{ wch: 32 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

      XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
      XLSX.writeFile(wb, `Ventas_CocoCacao_${fileNameSuffix()}.xlsx`);
      toast.success('Archivo de ventas exportado correctamente');
    } catch (err) {
      console.error(err);
      toast.error('Error al exportar ventas');
    }
    setExportingSales(false);
  };

  const exportCOGS = async () => {
    setExportingCOGS(true);
    try {
      // L1: agrega consumo de insumos expandiendo paquetes y usando índice O(1)
      const consumoMap: Record<string, number> = {};

      const acumular = (productoId: string, factor: number) => {
        const recs = recetasPorProducto[productoId] || [];
        recs.forEach(r => {
          consumoMap[r.insumo_id] = (consumoMap[r.insumo_id] || 0) + r.cantidad_necesaria * factor;
        });
      };

      detalles.forEach(d => {
        if (d.paquete_id) {
          const comps = componentesPorPaquete[d.paquete_id] || [];
          comps.forEach(c => acumular(c.producto_id, c.cantidad * d.cantidad));
        } else if (d.producto_id) {
          acumular(d.producto_id, d.cantidad);
        }
      });

      const rows = Object.entries(consumoMap).map(([insumoId, cantidadGastada]) => {
        const ins = insumos[insumoId];
        if (!ins) return null;
        const costoTotal = +(cantidadGastada * ins.costo_unitario).toFixed(2);
        return {
          'Insumo': ins.nombre,
          'Categoría': ins.categoria,
          'Cantidad Gastada': +cantidadGastada.toFixed(4),
          'Unidad de Medida': ins.unidad_medida,
          'Costo Unitario': ins.costo_unitario,
          'Costo Total': costoTotal,
        };
      }).filter(Boolean);

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'COGS');
      XLSX.writeFile(wb, `COGS_CocoCacao_${fileNameSuffix()}.xlsx`);
      toast.success('Archivo COGS exportado correctamente');
    } catch (err) {
      console.error(err);
      toast.error('Error al exportar COGS');
    }
    setExportingCOGS(false);
  };

  const exportCajaGlobal = async () => {
    setExportingCaja(true);
    try {
      const { turnos: turnosData } = await fetchCajaResumen(desde, hasta);
      if (turnosData.length === 0) {
        toast.warning('No hay turnos de caja en el periodo seleccionado');
        setExportingCaja(false);
        return;
      }

      const rows = turnosData.map(t => ({
        'Fecha Apertura': format(new Date(t.caja.fecha_apertura), 'dd/MM/yyyy HH:mm', { locale: es }),
        'Fecha Cierre': t.caja.fecha_cierre ? format(new Date(t.caja.fecha_cierre), 'dd/MM/yyyy HH:mm', { locale: es }) : 'Abierto',
        'Folio Turno': `#${String(t.caja.folio).padStart(4, '0')}`,
        'Usuario': t.nombreUsuario,
        'Estado': t.caja.estado === 'abierta' ? 'Activo' : 'Cerrado',
        'Apertura': t.caja.monto_apertura,
        'Ventas Efectivo': t.ventasEfectivo,
        'Entradas': t.entradas,
        'Salidas': t.salidas,
        'Esperado': t.esperado,
        'Real': t.caja.monto_cierre ?? '',
        'Diferencia': t.caja.diferencia ?? '',
        'Notas de Cierre': (t.caja as any).notas_cierre ?? '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 10 },
        { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Reporte Caja');
      XLSX.writeFile(wb, `ReporteCaja_CocoCacao_${fileNameSuffix()}.xlsx`);
      toast.success('Reporte de caja exportado correctamente');
    } catch (err) {
      console.error(err);
      toast.error('Error al exportar reporte de caja');
    }
    setExportingCaja(false);
  };

  const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  return (
    <div className="space-y-6">
      {/* L3: Rango de fechas con chevrons y presets */}
      <Card className="border-border/60">
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <DateNav label="Desde" date={desde} onChange={setDesde} />
            <DateNav label="Hasta" date={hasta} onChange={setHasta} />
            <Badge variant="outline" className="h-9 px-3 text-xs">
              {loading ? '…' : `${ventas.length} ventas en periodo`}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <PresetButton label="Hoy" onClick={() => { const t = new Date(); setDesde(t); setHasta(t); }} />
            <PresetButton label="Ayer" onClick={() => { const y = subDays(new Date(), 1); setDesde(y); setHasta(y); }} />
            <PresetButton label="Esta semana" onClick={() => { const t = new Date(); setDesde(startOfWeek(t, { weekStartsOn: 1 })); setHasta(endOfWeek(t, { weekStartsOn: 1 })); }} />
            <PresetButton label="Mes actual" onClick={() => { const t = new Date(); setDesde(startOfMonth(t)); setHasta(endOfMonth(t)); }} />
            <PresetButton label="Mes anterior" onClick={() => { const t = subDays(startOfMonth(new Date()), 1); setDesde(startOfMonth(t)); setHasta(endOfMonth(t)); }} />
          </div>
        </CardContent>
      </Card>

      {/* L2: Banner de resultados parciales */}
      {truncated.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Resultados parciales</p>
            <p className="text-xs opacity-90">
              Se alcanzó el límite de filas en: <strong>{truncated.join(', ')}</strong>. Los KPIs y exportaciones podrían
              estar incompletos. Reduce el rango de fechas para obtener un cálculo exacto.
            </p>
          </div>
        </div>
      )}

      {/* L3: KPIs con skeletons — grid responsivo (2/3/5) y tarjetas verticales para que quepa el monto completo */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-border/60 shadow-sm">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-6 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <KPICard icon={Receipt} label="Ingreso Gravable" value={fmt(kpis.ingresoGravable)} />
          <KPICard icon={Receipt} label="Ingreso Bruto Total" value={fmt(kpis.ingresoGravable + kpis.totalPropinas)} />
          <KPICard icon={Receipt} label={`IVA (${config.ivaPorcentaje}%) Acumulado`} value={fmt(kpis.ivaTotal)} />
          <KPICard icon={CreditCard} label="Propinas (No Gravable)" value={fmt(kpis.totalPropinas)} />
          <KPICard icon={TrendingUp} label="Utilidad Estimada" value={fmt(kpis.utilidad)} accent />
        </div>
      )}

      {/* Export Buttons */}
      <div className="flex flex-wrap gap-4">
        <Button onClick={exportVentas} disabled={exportingSales || ventas.length === 0} className="gap-2">
          {exportingSales ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Exportar Ventas para Contabilidad
        </Button>
        <Button variant="outline" onClick={exportCOGS} disabled={exportingCOGS || ventas.length === 0} className="gap-2">
          {exportingCOGS ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Exportar Movimientos de Inventario (COGS)
        </Button>
        <Button variant="outline" onClick={exportCajaGlobal} disabled={exportingCaja} className="gap-2">
          {exportingCaja ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          Exportar Reporte de Caja Global
        </Button>
      </div>
    </div>
  );
}

// L3: DateNav con chevrons (paso de un día) + popover de calendario
function DateNav({ label, date, onChange }: { label: string; date: Date; onChange: (d: Date) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onChange(subDays(date, 1))}
          aria-label={`${label}: día anterior`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('w-[170px] justify-start text-left font-normal', !date && 'text-muted-foreground')}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {format(date, 'dd MMM yyyy', { locale: es })}
              {isSameDay(date, new Date()) && <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">Hoy</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={d => d && onChange(d)}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onChange(addDays(date, 1))}
          aria-label={`${label}: día siguiente`}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClick}>
      {label}
    </Button>
  );
}

function KPICard({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: string; accent?: boolean }) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('rounded-lg p-1.5 shrink-0', accent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            <Icon className="h-4 w-4" />
          </div>
          <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        </div>
        <p className={cn('text-base sm:text-lg font-bold tabular-nums break-words leading-tight', accent && 'text-primary')}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
