import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarPlus, Edit, X, List, CalendarDays, FilterX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { checkReservationConflict } from './conflictCheck';
import { ReservationCalendar } from './ReservationCalendar';
import { QuickCheckInButton } from './QuickCheckInButton';
import type { Area, Reservacion } from './types';
import { todayCDMX } from '@/lib/utils';

interface Props {
  areas: Area[];
  reservaciones: Reservacion[];
  getOccupancy: (areaId: string) => number;
  getAvailablePax: (areaId: string) => number;
  onSuccess?: () => void | Promise<void>;
}

export function ReservacionesTab({ areas, reservaciones, getOccupancy, getAvailablePax, onSuccess }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRes, setEditingRes] = useState<Reservacion | null>(null);
  const [activeTab, setActiveTab] = useState<string>('calendar');
  const [selectedReservacionId, setSelectedReservacionId] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);

  const [clienteNombre, setClienteNombre] = useState('');
  const [areaId, setAreaId] = useState('');
  const [paxCount, setPaxCount] = useState('1');
  const [fechaReserva, setFechaReserva] = useState('');
  const [horaInicio, setHoraInicio] = useState('09:00');
  const [duracion, setDuracion] = useState('1');
  const [saving, setSaving] = useState(false);
  const [reservacionToCancel, setReservacionToCancel] = useState<Reservacion | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Scroll to selected row when switching to list tab
  useEffect(() => {
    if (activeTab === 'list' && selectedReservacionId && selectedRowRef.current) {
      setTimeout(() => {
        selectedRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [activeTab, selectedReservacionId]);

  const resetForm = () => {
    setClienteNombre(''); setAreaId(''); setPaxCount('1');
    setFechaReserva(''); setHoraInicio('09:00'); setDuracion('1');
    setEditingRes(null);
  };

  const openEdit = (r: Reservacion) => {
    setEditingRes(r);
    setClienteNombre(r.cliente_nombre);
    setAreaId(r.area_id);
    setPaxCount(String(r.pax_count));
    setFechaReserva(r.fecha_reserva);
    setHoraInicio(r.hora_inicio.slice(0, 5));
    setDuracion(String(r.duracion_horas));
    setDialogOpen(true);
  };

  const openNewFromDate = (dateStr: string) => {
    resetForm();
    setFechaReserva(dateStr);
    setDialogOpen(true);
  };

  const handleEventClick = (reservacion: Reservacion) => {
    setSelectedReservacionId(reservacion.id);
    setActiveTab('list');
  };

  const clearFilter = () => {
    setSelectedReservacionId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const selectedArea = areas.find(a => a.id === areaId);
    const conflict = await checkReservationConflict({
      areaId,
      fechaReserva,
      horaInicio,
      duracionHoras: parseFloat(duracion),
      paxCount: parseInt(paxCount),
      esPrivado: selectedArea?.es_privado ?? false,
      capacidadPax: selectedArea?.capacidad_pax ?? 0,
      excludeReservacionId: editingRes?.id,
    });

    if (conflict.hasConflict) {
      toast({ variant: 'destructive', title: 'Conflicto de horario', description: conflict.message });
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'reservacion_conflicto',
        descripcion: `Intento fallido: ${clienteNombre.trim()} en ${fechaReserva} ${horaInicio} — ${conflict.message}`,
        metadata: { area_id: areaId, fecha_reserva: fechaReserva, hora_inicio: horaInicio },
      });
      setSaving(false);
      return;
    }

    if (editingRes) {
      const { error } = await supabase.from('coworking_reservaciones').update({
        cliente_nombre: clienteNombre.trim(),
        area_id: areaId,
        pax_count: parseInt(paxCount),
        fecha_reserva: fechaReserva,
        hora_inicio: horaInicio,
        duracion_horas: parseFloat(duracion),
      }).eq('id', editingRes.id);

      if (error) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
      } else {
        await supabase.from('audit_logs').insert({
          user_id: user.id, accion: 'reagendar_reservacion',
          descripcion: `Reagendada reservación de ${clienteNombre.trim()}`,
          metadata: { reservacion_id: editingRes.id },
        });
        toast({ title: 'Reservación actualizada' });
        resetForm(); setDialogOpen(false);
        await onSuccess?.();
      }
    } else {
      const { error } = await supabase.from('coworking_reservaciones').insert({
        cliente_nombre: clienteNombre.trim(),
        area_id: areaId,
        pax_count: parseInt(paxCount),
        fecha_reserva: fechaReserva,
        hora_inicio: horaInicio,
        duracion_horas: parseFloat(duracion),
        usuario_id: user.id,
        estado: 'pendiente',
      });

      if (error) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
      } else {
        await supabase.from('audit_logs').insert({
          user_id: user.id, accion: 'crear_reservacion',
          descripcion: `Reservación: ${clienteNombre.trim()} para ${fechaReserva}`,
          metadata: { area_id: areaId, pax_count: parseInt(paxCount) },
        });
        toast({ title: 'Reservación creada' });
        resetForm(); setDialogOpen(false);
        await onSuccess?.();
      }
    }
    setSaving(false);
  };

  const requestCancel = (r: Reservacion) => {
    setReservacionToCancel(r);
    setCancelMotivo('');
  };

  const confirmCancel = async () => {
    const r = reservacionToCancel;
    if (!r || !user) return;
    setCancelling(true);
    const { error } = await supabase.from('coworking_reservaciones')
      .update({ estado: 'cancelada' }).eq('id', r.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      setCancelling(false);
      return;
    }
    const motivoTxt = cancelMotivo.trim();
    await supabase.from('audit_logs').insert({
      user_id: user.id, accion: 'cancelar_reservacion',
      descripcion: `Cancelada reservación de ${r.cliente_nombre}${motivoTxt ? ` — Motivo: ${motivoTxt}` : ''}`,
      metadata: { reservacion_id: r.id, motivo: motivoTxt || null },
    });
    toast({ title: 'Reservación cancelada' });
    if (selectedReservacionId === r.id) setSelectedReservacionId(null);
    await onSuccess?.();
    setReservacionToCancel(null);
    setCancelMotivo('');
    setCancelling(false);
  };

  const estadoBadge = (estado: string) => {
    if (estado === 'pendiente') return <Badge variant="outline" className="text-amber-600 border-amber-400">Pendiente</Badge>;
    if (estado === 'confirmada') return <Badge variant="outline" className="text-emerald-600 border-emerald-400">Confirmada</Badge>;
    return <Badge variant="outline">{estado}</Badge>;
  };

  const today = todayCDMX();

  // Filtered list: show only selected if coming from calendar, else show all
  const displayedReservaciones = selectedReservacionId
    ? reservaciones.filter(r => r.id === selectedReservacionId)
    : reservaciones;

  const selectedReservacion = selectedReservacionId
    ? reservaciones.find(r => r.id === selectedReservacionId)
    : null;

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Reservaciones</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm"><CalendarPlus className="mr-2 h-4 w-4" />Nueva Reservación</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingRes ? 'Reagendar Reservación' : 'Nueva Reservación'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Input value={clienteNombre} onChange={e => setClienteNombre(e.target.value)} placeholder="Nombre completo" required maxLength={100} />
                </div>
                <div className="space-y-2">
                  <Label>Área</Label>
                  <Select value={areaId} onValueChange={setAreaId} required>
                    <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                    <SelectContent>
                      {areas.map(a => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.nombre_area} ({a.es_privado ? 'Privado' : `cap. ${a.capacidad_pax} pax`})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Fecha</Label>
                    <Input type="date" value={fechaReserva} onChange={e => setFechaReserva(e.target.value)} required min={today} />
                  </div>
                  <div className="space-y-2">
                    <Label>Hora de inicio</Label>
                    <Input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Personas</Label>
                    <Input type="number" min={1} value={paxCount} onChange={e => setPaxCount(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Duración (hrs)</Label>
                    <Input type="number" min={0.5} step={0.5} value={duracion} onChange={e => setDuracion(e.target.value)} required />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={saving || !areaId}>
                  {saving ? 'Validando...' : editingRes ? 'Guardar Cambios' : 'Crear Reservación'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="calendar"><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Calendario</TabsTrigger>
              <TabsTrigger value="list"><List className="mr-1.5 h-3.5 w-3.5" />Lista</TabsTrigger>
            </TabsList>

            <TabsContent value="calendar">
              <ReservationCalendar
                areas={areas}
                reservaciones={reservaciones}
                onDateClick={openNewFromDate}
                onEventClick={handleEventClick}
              />
            </TabsContent>

            <TabsContent value="list">
              {/* Filter banner when coming from calendar */}
              {selectedReservacionId && selectedReservacion && (
                <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-md bg-primary/10 border border-primary/20">
                  <span className="text-sm text-primary font-medium">
                    🔍 Mostrando reservación seleccionada: <span className="font-semibold">{selectedReservacion.cliente_nombre}</span> — {selectedReservacion.fecha_reserva}
                  </span>
                  <Button variant="ghost" size="sm" onClick={clearFilter} className="text-muted-foreground hover:text-foreground h-7 px-2 gap-1.5">
                    <FilterX className="h-3.5 w-3.5" />
                    Ver todas
                  </Button>
                </div>
              )}

              {displayedReservaciones.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No hay reservaciones activas</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Área</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Hora</TableHead>
                        <TableHead>Duración</TableHead>
                        <TableHead>Pax</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedReservaciones.map(r => {
                        const area = areas.find(a => a.id === r.area_id);
                        const isToday = r.fecha_reserva === today;
                        const isSelected = r.id === selectedReservacionId;
                        return (
                          <TableRow
                            key={r.id}
                            ref={isSelected ? (el) => { selectedRowRef.current = el; } : undefined}
                            className={isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : undefined}
                          >
                            <TableCell className="font-medium">{r.cliente_nombre}</TableCell>
                            <TableCell>{area?.nombre_area ?? '—'}</TableCell>
                            <TableCell>{r.fecha_reserva}</TableCell>
                            <TableCell>{r.hora_inicio.slice(0, 5)}</TableCell>
                            <TableCell>{r.duracion_horas}h</TableCell>
                            <TableCell>{r.pax_count}</TableCell>
                            <TableCell>{estadoBadge(r.estado)}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {isToday && r.estado === 'pendiente' && (
                                  <QuickCheckInButton reservacion={r} area={area} getAvailablePax={getAvailablePax} onSuccess={onSuccess} />
                                )}
                                <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Reagendar">
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => requestCancel(r)} title="Cancelar" className="text-destructive">
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertDialog open={!!reservacionToCancel} onOpenChange={(v) => { if (!v && !cancelling) { setReservacionToCancel(null); setCancelMotivo(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar reservación?</AlertDialogTitle>
            <AlertDialogDescription>
              {reservacionToCancel && (
                <>Se cancelará la reservación de <span className="font-semibold">{reservacionToCancel.cliente_nombre}</span> para el {reservacionToCancel.fecha_reserva} a las {reservacionToCancel.hora_inicio.slice(0, 5)}. Esta acción no se puede deshacer.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-cancelacion">Motivo (opcional)</Label>
            <Textarea
              id="motivo-cancelacion"
              value={cancelMotivo}
              onChange={(e) => setCancelMotivo(e.target.value)}
              placeholder="Ej: Cliente avisó que no podrá asistir"
              maxLength={300}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Volver</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={(e) => { e.preventDefault(); confirmCancel(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? 'Cancelando...' : 'Cancelar reservación'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
