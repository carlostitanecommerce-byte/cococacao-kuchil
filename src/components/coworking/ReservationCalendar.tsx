import { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import './fullcalendar.css';
import type { Area, Reservacion } from './types';

const AREA_COLORS = [
  { bg: 'hsl(25, 65%, 28%)', border: 'hsl(25, 65%, 22%)', text: 'hsl(30, 25%, 97%)' },
  { bg: 'hsl(36, 72%, 52%)', border: 'hsl(36, 72%, 42%)', text: 'hsl(25, 30%, 12%)' },
  { bg: 'hsl(160, 50%, 40%)', border: 'hsl(160, 50%, 30%)', text: 'hsl(0, 0%, 100%)' },
  { bg: 'hsl(220, 55%, 50%)', border: 'hsl(220, 55%, 40%)', text: 'hsl(0, 0%, 100%)' },
  { bg: 'hsl(280, 45%, 50%)', border: 'hsl(280, 45%, 40%)', text: 'hsl(0, 0%, 100%)' },
  { bg: 'hsl(0, 60%, 50%)', border: 'hsl(0, 60%, 40%)', text: 'hsl(0, 0%, 100%)' },
];

interface Props {
  areas: Area[];
  reservaciones: Reservacion[];
  onDateClick?: (dateStr: string) => void;
  onEventClick?: (reservacion: Reservacion) => void;
}

export function ReservationCalendar({ areas, reservaciones, onDateClick, onEventClick }: Props) {
  const [filterAreaId, setFilterAreaId] = useState<string>('all');

  const areaColorMap = useMemo(() => {
    const map: Record<string, typeof AREA_COLORS[0]> = {};
    areas.forEach((a, i) => { map[a.id] = AREA_COLORS[i % AREA_COLORS.length]; });
    return map;
  }, [areas]);

  const events = useMemo(() => {
    const filtered = filterAreaId === 'all'
      ? reservaciones
      : reservaciones.filter(r => r.area_id === filterAreaId);

    return filtered.map(r => {
      const area = areas.find(a => a.id === r.area_id);
      const colors = areaColorMap[r.area_id] ?? AREA_COLORS[0];
      const horaIso = r.hora_inicio.length === 5 ? `${r.hora_inicio}:00` : r.hora_inicio;
      const startDate = new Date(`${r.fecha_reserva}T${horaIso}-06:00`);
      const endDate = new Date(startDate.getTime() + r.duracion_horas * 3600000);

      return {
        id: r.id,
        title: `${r.cliente_nombre} — ${area?.nombre_area ?? ''} (${r.pax_count}p)`,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: colors.text,
        extendedProps: { reservacion: r },
      };
    });
  }, [reservaciones, areas, filterAreaId, areaColorMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4">
        <div className="space-y-1.5 w-64">
          <Label className="text-xs">Filtrar por Área</Label>
          <Select value={filterAreaId} onValueChange={setFilterAreaId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las áreas</SelectItem>
              {areas.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: areaColorMap[a.id]?.bg }} />
                    {a.nombre_area}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          {areas.map(a => (
            <div key={a.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: areaColorMap[a.id]?.bg }} />
              {a.nombre_area}
            </div>
          ))}
        </div>
      </div>

      {onEventClick && (
        <p className="text-xs text-muted-foreground">
          💡 Haz clic en una reservación del calendario para ver sus detalles en la lista.
        </p>
      )}

      <div className="bg-card rounded-lg border border-border p-2 sm:p-4 fullcalendar-wrapper">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          locale="es"
          buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana', day: 'Día' }}
          events={events}
          height="auto"
          dateClick={(info) => onDateClick?.(info.dateStr)}
          eventClick={(info) => {
            const reservacion = info.event.extendedProps.reservacion as Reservacion;
            onEventClick?.(reservacion);
          }}
          eventDisplay="block"
          slotMinTime="06:00:00"
          slotMaxTime="23:00:00"
          allDaySlot={false}
          nowIndicator
          
        />
      </div>
    </div>
  );
}
