import { useState, useEffect } from 'react';
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
import { ChevronDown, ChevronUp, XCircle, RefreshCw, CalendarIcon, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cdmxDateRange } from '@/lib/ventasUtils';
import { CancelVentaDialog } from './CancelVentaDialog';
import { CambiarMetodoPagoDialog } from './CambiarMetodoPagoDialog';
import { TicketReimprimirDialog } from './TicketReimprimirDialog';

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
}

interface Props {
  isAdmin: boolean;
}

export function VentasTurnoPanel({ isAdmin }: Props) {
  const [ventas, setVentas] = useState<VentaTurno[]>([]);
  const [open, setOpen] = useState(false);
  const [cancelVenta, setCancelVenta] = useState<VentaTurno | null>(null);
  const [editPagoVenta, setEditPagoVenta] = useState<VentaTurno | null>(null);
  const [reprintVenta, setReprintVenta] = useState<VentaTurno | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const fetchVentas = async () => {
    const { desdeISO, hastaISO } = cdmxDateRange(selectedDate, selectedDate);
    const { data } = await supabase
      .from('ventas')
      .select('id, folio, total_neto, iva, monto_propina, metodo_pago, monto_efectivo, monto_tarjeta, monto_transferencia, estado, fecha, motivo_cancelacion, coworking_session_id, usuario_id')
      .eq('estado', 'completada')
      .gte('fecha', desdeISO)
      .lte('fecha', hastaISO)
      .order('fecha', { ascending: false })
      .limit(200);
    setVentas((data as VentaTurno[]) ?? []);
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
  }, [selectedDate]);

  const completadas = ventas.filter(v => v.estado === 'completada');

  const metodoPagoLabel: Record<string, string> = {
    efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Mixto',
  };

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Historial de Ventas Procesadas ({completadas.length})</span>
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              {/* Date picker */}
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

              {ventas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay ventas en esta fecha</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Hora</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Pago</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-[120px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ventas.map(v => (
                      <TableRow key={v.id} className={v.estado === 'cancelada' ? 'opacity-50' : ''}>
                        <TableCell className="text-xs font-medium">#{String(v.folio).padStart(4, '0')}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(v.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="font-medium">${v.total_neto.toFixed(2)}</TableCell>
                        <TableCell className="text-xs">{metodoPagoLabel[v.metodo_pago] ?? v.metodo_pago}</TableCell>
                        <TableCell>
                          {v.estado === 'completada' ? (
                            <Badge variant="outline" className="text-xs">Completada</Badge>
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
                                {isAdmin && (
                                  <>
                                    <Button variant="ghost" size="icon" title="Cambiar método de pago" onClick={() => setEditPagoVenta(v)}>
                                      <RefreshCw className="h-4 w-4 text-primary" />
                                    </Button>
                                    <Button variant="ghost" size="icon" title="Cancelar venta" onClick={() => setCancelVenta(v)}>
                                      <XCircle className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <CancelVentaDialog
        venta={cancelVenta}
        isAdmin={isAdmin}
        onClose={() => setCancelVenta(null)}
        onSuccess={() => { setCancelVenta(null); fetchVentas(); }}
      />

      <CambiarMetodoPagoDialog
        venta={editPagoVenta}
        onClose={() => setEditPagoVenta(null)}
        onSuccess={() => { setEditPagoVenta(null); fetchVentas(); }}
      />

      <TicketReimprimirDialog
        venta={reprintVenta as any}
        onClose={() => setReprintVenta(null)}
      />
    </>
  );
}
