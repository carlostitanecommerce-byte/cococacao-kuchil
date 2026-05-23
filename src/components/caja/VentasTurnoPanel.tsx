import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ChevronDown, ChevronUp, XCircle, RefreshCw, CalendarIcon, Printer, Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { cdmxDateRange } from '@/lib/ventasUtils';
import { CancelVentaDialog } from './CancelVentaDialog';
import { CambiarMetodoPagoDialog } from './CambiarMetodoPagoDialog';
import { TicketReimprimirDialog } from './TicketReimprimirDialog';
import { DataPagination } from '@/components/ui/data-pagination';

interface VentaTurno {
  id: string;
  folio: number;
  total_neto: number;
  iva?: number;
  monto_propina: number;
  metodo_pago: string;
  monto_efectivo: number;
  monto_tarjeta: number;
  monto_transferencia: number;
  estado: string;
  fecha: string;
  motivo_cancelacion: string | null;
  coworking_session_id: string | null;
  usuario_id?: string;
  caja_id?: string | null;
  cajaEstado?: 'abierta' | 'cerrada';
  cajaFolio?: number | null;
}

interface CajaAbierta {
  id: string;
  folio: number;
}

interface Props {
  isAdmin: boolean;
  cajaAbierta?: CajaAbierta | null;
}

const QUERY_LIMIT = 200;

export function VentasTurnoPanel({ isAdmin, cajaAbierta }: Props) {
  const [ventas, setVentas] = useState<VentaTurno[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [cancelVenta, setCancelVenta] = useState<VentaTurno | null>(null);
  const [editPagoVenta, setEditPagoVenta] = useState<VentaTurno | null>(null);
  const [reprintVenta, setReprintVenta] = useState<VentaTurno | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [paginaActual, setPaginaActual] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  // No-admin: forzar fecha = hoy y filtro por caja activa.
  const effectiveDate = isAdmin ? selectedDate : new Date();
  const noAdminLockedToTurno = !isAdmin && !!cajaAbierta;

  const fetchVentas = async () => {
    // No-admin sin caja abierta: no debería ver historial.
    if (!isAdmin && !cajaAbierta) {
      setVentas([]);
      setTotalCount(0);
      return;
    }

    const { desdeISO, hastaISO } = cdmxDateRange(effectiveDate, effectiveDate);
    let query = supabase
      .from('ventas')
      .select('id, folio, total_neto, iva, monto_propina, metodo_pago, monto_efectivo, monto_tarjeta, monto_transferencia, estado, fecha, motivo_cancelacion, coworking_session_id, usuario_id, caja_id', { count: 'exact' })
      .in('estado', ['completada', 'cancelada'])
      .gte('fecha', desdeISO)
      .lte('fecha', hastaISO)
      .order('fecha', { ascending: false })
      .limit(QUERY_LIMIT);

    if (noAdminLockedToTurno) {
      query = query.eq('caja_id', cajaAbierta!.id);
    }

    const { data, count } = await query;
    const rows = (data as VentaTurno[]) ?? [];
    setTotalCount(count ?? rows.length);

    // Para admin: resolver estado/folio de la caja de cada venta (para detectar turnos cerrados).
    if (isAdmin && rows.length > 0) {
      const cajaIds = [...new Set(rows.map(v => v.caja_id).filter(Boolean) as string[])];
      if (cajaIds.length > 0) {
        const { data: cajasData } = await supabase
          .from('cajas')
          .select('id, estado, folio')
          .in('id', cajaIds);
        const map = new Map((cajasData ?? []).map(c => [c.id, c]));
        rows.forEach(v => {
          if (v.caja_id) {
            const c = map.get(v.caja_id);
            v.cajaEstado = (c?.estado as 'abierta' | 'cerrada') ?? 'cerrada';
            v.cajaFolio = c?.folio ?? null;
          }
        });
      }
    } else if (noAdminLockedToTurno) {
      rows.forEach(v => {
        v.cajaEstado = 'abierta';
        v.cajaFolio = cajaAbierta!.folio;
      });
    }

    setVentas(rows);
  };

  useEffect(() => {
    fetchVentas();

    const channel = supabase
      .channel('pos-ventas-turno-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, () => fetchVentas())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'detalle_ventas' }, () => fetchVentas())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isAdmin, cajaAbierta?.id]);

  useEffect(() => { setPaginaActual(1); }, [selectedDate, porPagina]);

  const completadas = ventas.filter(v => v.estado === 'completada');
  const canceladas = ventas.filter(v => v.estado === 'cancelada');

  const ventasPagina = useMemo(() => {
    const inicio = (paginaActual - 1) * porPagina;
    return ventas.slice(inicio, inicio + porPagina);
  }, [ventas, paginaActual, porPagina]);

  const metodoPagoLabel: Record<string, string> = {
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Mixto',
  };

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  const titulo = noAdminLockedToTurno
    ? `Ventas del turno actual${cajaAbierta ? ` (#${String(cajaAbierta.folio).padStart(4, '0')})` : ''}`
    : 'Historial de Ventas';

  return (
    <TooltipProvider>
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{titulo} ({completadas.length} completadas · {canceladas.length} canceladas)</span>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              {/* Date picker — solo admin */}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn('gap-1.5 text-left font-normal', !selectedDate && 'text-muted-foreground')}>
                        <CalendarIcon className="h-4 w-4" />
                        {format(selectedDate, "d 'de' MMMM yyyy", { locale: es })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(d) => d && setSelectedDate(d)}
                        disabled={(d) => d > new Date()}
                        initialFocus
                        className={cn('p-3 pointer-events-auto')}
                      />
                    </PopoverContent>
                  </Popover>
                  {!isToday && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDate(new Date())}>Hoy</Button>
                  )}
                </div>
              )}

              {ventas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay ventas en esta fecha</p>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Hora</TableHead>
                      {isAdmin && <TableHead>Turno</TableHead>}
                      <TableHead>Total</TableHead>
                      <TableHead>Pago</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-[120px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ventasPagina.map(v => {
                      const turnoCerrado = v.cajaEstado === 'cerrada';
                      return (
                      <TableRow key={v.id} className={v.estado === 'cancelada' ? 'opacity-50' : ''}>
                        <TableCell className="text-xs font-medium">#{String(v.folio).padStart(4, '0')}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(v.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' })}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-xs">
                            {v.cajaFolio ? (
                              <span className="inline-flex items-center gap-1">
                                #{String(v.cajaFolio).padStart(4, '0')}
                                {turnoCerrado && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Lock className="h-3 w-3 text-amber-600" />
                                    </TooltipTrigger>
                                    <TooltipContent>Turno cerrado · correcciones post-cierre</TooltipContent>
                                  </Tooltip>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="font-medium">${v.total_neto.toFixed(2)}</TableCell>
                        <TableCell className="text-xs">{metodoPagoLabel[v.metodo_pago] ?? v.metodo_pago}</TableCell>
                        <TableCell>
                          {v.estado === 'completada' ? (
                            <Badge variant="outline" className="text-xs">Completada</Badge>
                          ) : v.motivo_cancelacion ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive" className="text-xs cursor-help">Cancelada</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">{v.motivo_cancelacion}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Cancelada</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {v.estado === 'completada' && (
                              <>
                                <Button variant="ghost" size="icon" title="Reimprimir ticket" onClick={() => setReprintVenta(v)}>
                                  <Printer className="h-4 w-4 text-muted-foreground" />
                                </Button>
                                {isAdmin ? (
                                  <>
                                    <Button variant="ghost" size="icon" title={turnoCerrado ? 'Cambiar método (corrección post-cierre)' : 'Cambiar método de pago'} onClick={() => setEditPagoVenta(v)}>
                                      <RefreshCw className={cn('h-4 w-4', turnoCerrado ? 'text-amber-600' : 'text-primary')} />
                                    </Button>
                                    <Button variant="ghost" size="icon" title={turnoCerrado ? 'Cancelar (corrección post-cierre)' : 'Cancelar venta'} onClick={() => setCancelVenta(v)}>
                                      <XCircle className={cn('h-4 w-4', turnoCerrado ? 'text-amber-600' : 'text-destructive')} />
                                    </Button>
                                  </>
                                ) : (
                                  <Button variant="ghost" size="icon" title="Solicitar cancelación" onClick={() => setCancelVenta(v)}>
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <DataPagination
                  paginaActual={paginaActual}
                  totalItems={ventas.length}
                  porPagina={porPagina}
                  onPaginaChange={setPaginaActual}
                  onPorPaginaChange={setPorPagina}
                  etiqueta="ventas"
                />
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <CancelVentaDialog
        venta={cancelVenta}
        isAdmin={isAdmin}
        cajaEstado={cancelVenta?.cajaEstado}
        cajaFolio={cancelVenta?.cajaFolio ?? null}
        onClose={() => setCancelVenta(null)}
        onSuccess={() => { setCancelVenta(null); fetchVentas(); }}
      />

      <CambiarMetodoPagoDialog
        venta={editPagoVenta}
        cajaEstado={editPagoVenta?.cajaEstado}
        cajaFolio={editPagoVenta?.cajaFolio ?? null}
        onClose={() => setEditPagoVenta(null)}
        onSuccess={() => { setEditPagoVenta(null); fetchVentas(); }}
      />

      <TicketReimprimirDialog
        venta={reprintVenta as any}
        onClose={() => setReprintVenta(null)}
      />
    </TooltipProvider>
  );
}
