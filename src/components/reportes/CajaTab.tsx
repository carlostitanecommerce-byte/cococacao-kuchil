import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { Loader2, Wallet, ArrowUpCircle, ArrowDownCircle, Clock, AlertTriangle, CheckCircle2, CalendarIcon } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { fetchCajaResumen, type CajaTurnoResumen } from '@/lib/cajaUtils';

export default function CajaTab() {
  const { roles } = useAuth();
  const isAdminOrSupervisor = roles.includes('administrador') || roles.includes('supervisor');

  const [desde, setDesde] = useState<Date>(startOfMonth(new Date()));
  const [hasta, setHasta] = useState<Date>(endOfMonth(new Date()));
  const [turnos, setTurnos] = useState<CajaTurnoResumen[]>([]);
  const [selectedCajaId, setSelectedCajaId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true);
      setTruncated(false);
      try {
        const { turnos: data, truncated: tr } = await fetchCajaResumen(desde, hasta, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setTurnos(data);
        setTruncated(tr);
        if (data.length > 0) {
          const active = data.find(t => t.caja.estado === 'abierta');
          setSelectedCajaId(active?.caja.id ?? data[0].caja.id);
        } else {
          setSelectedCajaId('');
        }
      } catch (err: any) {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return;
        console.error('[CajaTab] fetchCajaResumen error', err);
        toast.error('No se pudo cargar el reporte de caja', {
          description: err?.message ?? 'Error de conexión con el servidor.',
        });
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [desde, hasta]);

  // Global consolidated summary
  const consolidado = useMemo(() => {
    const fondoTotal = turnos.reduce((s, t) => s + t.caja.monto_apertura, 0);
    const ventasEfectivo = turnos.reduce((s, t) => s + t.ventasEfectivo, 0);
    const entradas = turnos.reduce((s, t) => s + t.entradas, 0);
    const salidas = turnos.reduce((s, t) => s + t.salidas, 0);
    const diferenciaNeta = turnos
      .filter(t => t.caja.estado === 'cerrada' && t.caja.diferencia != null)
      .reduce((s, t) => s + (t.caja.diferencia ?? 0), 0);
    return { fondoTotal, ventasEfectivo, entradas, salidas, diferenciaNeta };
  }, [turnos]);

  const selectedTurno = useMemo(() => turnos.find(t => t.caja.id === selectedCajaId), [turnos, selectedCajaId]);

  const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isClosed = selectedTurno?.caja.estado === 'cerrada';

  return (
    <div className="space-y-6">
      {/* Date Range Selector */}
      <Card className="border-border/60">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <DatePicker label="Desde" date={desde} onChange={setDesde} />
            <DatePicker label="Hasta" date={hasta} onChange={setHasta} />
            <Badge variant="outline" className="h-9 px-3 text-xs">
              {turnos.length} turno{turnos.length !== 1 ? 's' : ''} en periodo
            </Badge>
          </div>
        </CardContent>
      </Card>

      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Volumen de datos elevado: se alcanzó el límite de carga del periodo. Algunos registros pueden no estar incluidos. Reduce el rango para mayor exactitud.
          </span>
        </div>
      )}

      {/* Consolidated Summary */}
      {turnos.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Resumen Consolidado del Periodo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <SummaryCard
                label="Fondo Apertura Total"
                value={fmt(consolidado.fondoTotal)}
                tooltip="Capital inicial entregado al inicio del turno para dar cambio. No forma parte de las ventas del día."
              />
              <SummaryCard label="Ingresos por Ventas (Solo Efectivo)" value={fmt(consolidado.ventasEfectivo)} />
              <SummaryCard label="Entradas" value={fmt(consolidado.entradas)} accent="text-primary" />
              <SummaryCard label="Salidas" value={fmt(consolidado.salidas)} accent="text-destructive" />
              <SummaryCard
                label="Diferencia Neta"
                value={fmt(consolidado.diferenciaNeta)}
                accent={consolidado.diferenciaNeta < -0.01 ? 'text-destructive' : 'text-primary'}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {turnos.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">No hay registros de caja en este periodo.</p>
      ) : (
        <>
          {/* Per-Turn Selector */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Detalle por Turno</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedCajaId} onValueChange={setSelectedCajaId}>
                <SelectTrigger className="w-full max-w-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {turnos.map(t => {
                    const fecha = new Date(t.caja.fecha_apertura).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
                    const folioStr = `#${String(t.caja.folio).padStart(4, '0')}`;
                    return (
                      <SelectItem key={t.caja.id} value={t.caja.id}>
                        <span className="flex items-center gap-2">
                          <Badge variant={t.caja.estado === 'abierta' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                            {t.caja.estado === 'abierta' ? 'Activo' : 'Cerrado'}
                          </Badge>
                          Turno {folioStr} — {fecha} — {t.nombreUsuario}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedTurno && (
            <>
              {/* Arqueo de Turno */}
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Auditoría de Arqueo
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <ArqueoCard label="Fondo Fijo" value={selectedTurno.caja.monto_apertura} />
                      <ArqueoCard label="Ventas Efectivo" value={selectedTurno.ventasEfectivo} />
                      <ArqueoCard label="Entradas" value={selectedTurno.entradas} accent="text-primary" />
                      <ArqueoCard label="Salidas" value={selectedTurno.salidas} accent="text-destructive" />
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      {(isAdminOrSupervisor || isClosed) && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium">Efectivo Esperado</span>
                          <span className="font-mono font-semibold text-lg">{fmt(selectedTurno.esperado)}</span>
                        </div>
                      )}

                      {isClosed && selectedTurno.caja.monto_cierre != null && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium">Efectivo Contado (Real)</span>
                            <span className="font-mono font-semibold text-lg">{fmt(selectedTurno.caja.monto_cierre)}</span>
                          </div>
                          {(() => {
                            const diff = selectedTurno.caja.diferencia ?? 0;
                            const isOk = Math.abs(diff) < 0.01;
                            return (
                              <div className={`flex justify-between items-center rounded-lg p-3 ${isOk ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                                <span className="text-sm font-medium flex items-center gap-2">
                                  {isOk
                                    ? <CheckCircle2 className="h-4 w-4 text-primary" />
                                    : <AlertTriangle className="h-4 w-4 text-destructive" />}
                                  Diferencia
                                </span>
                                <span className={`font-mono font-bold text-lg ${isOk ? 'text-primary' : 'text-destructive'}`}>
                                  {diff >= 0 ? '+' : ''}{fmt(diff)}
                                </span>
                              </div>
                            );
                          })()}
                        </>
                      )}

                      {!isClosed && !isAdminOrSupervisor && (
                        <p className="text-sm text-muted-foreground italic">
                          El monto esperado se revelará al realizar el cierre de caja (Arqueo Ciego).
                        </p>
                      )}

                      {!isClosed && isAdminOrSupervisor && (
                        <Badge variant="outline" className="text-xs">Turno en curso — pendiente de cierre</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Movimientos */}
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Bitácora de Movimientos Manuales</CardTitle>
                  <p className="text-xs text-muted-foreground">{selectedTurno.movimientos.length} movimiento{selectedTurno.movimientos.length !== 1 ? 's' : ''}</p>
                </CardHeader>
                <CardContent>
                  {selectedTurno.movimientos.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-4">Sin movimientos manuales en este turno.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Hora</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead className="text-right">Monto</TableHead>
                            <TableHead>Motivo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedTurno.movimientos.map(m => (
                            <TableRow key={m.id}>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {new Date(m.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                              </TableCell>
                              <TableCell>
                                {m.tipo === 'entrada'
                                  ? <span className="flex items-center gap-1 text-primary text-sm"><ArrowUpCircle className="h-3.5 w-3.5" /> Entrada</span>
                                  : <span className="flex items-center gap-1 text-destructive text-sm"><ArrowDownCircle className="h-3.5 w-3.5" /> Salida</span>}
                              </TableCell>
                              <TableCell className={`text-right font-mono text-sm font-medium ${m.tipo === 'entrada' ? 'text-primary' : 'text-destructive'}`}>
                                {m.tipo === 'entrada' ? '+' : '-'}{fmt(m.monto)}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{m.motivo}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Shared sub-components ── */

function DatePicker({ label, date, onChange }: { label: string; date: Date; onChange: (d: Date) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !date && 'text-muted-foreground')}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            {format(date, 'dd MMM yyyy', { locale: es })}
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
    </div>
  );
}

function SummaryCard({ label, value, accent, tooltip }: { label: string; value: string; accent?: string; tooltip?: string }) {
  const labelEl = tooltip ? (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="text-xs text-muted-foreground mb-1 inline-flex items-center justify-center gap-1 cursor-help">
            {label}
            <Info className="h-3 w-3" />
          </p>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-center">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    <p className="text-xs text-muted-foreground mb-1">{label}</p>
  );
  return (
    <div className="rounded-lg border border-border/60 p-3 text-center">
      {labelEl}
      <p className={`font-mono font-semibold text-lg ${accent ?? ''}`}>{value}</p>
    </div>
  );
}

function ArqueoCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  return (
    <div className="rounded-lg border border-border/60 p-3 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`font-mono font-semibold text-lg ${accent ?? ''}`}>{fmt(value)}</p>
    </div>
  );
}
