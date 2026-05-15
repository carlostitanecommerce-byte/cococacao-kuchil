import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, Users } from 'lucide-react';
import type { Area, CoworkingSession } from './types';

interface Props {
  areas: Area[];
  getOccupancy: (areaId: string) => number;
  getAreaSessions: (areaId: string) => CoworkingSession[];
  onCheckOut: (session: CoworkingSession) => void;
  onCancel: (session: CoworkingSession) => void;
}

export function OccupancyGrid({ areas, getOccupancy, getAreaSessions, onCheckOut, onCancel }: Props) {
  const getStatusColor = (isPrivado: boolean, areaSessions: CoworkingSession[], occ: number, cap: number) => {
    if (isPrivado) {
      return areaSessions.length > 0
        ? 'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-400'
        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400';
    }
    if (occ === 0) return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400';
    if (occ < cap) return 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400';
    return 'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-400';
  };

  const getStatusLabel = (isPrivado: boolean, areaSessions: CoworkingSession[], occ: number, cap: number) => {
    if (isPrivado) return areaSessions.length > 0 ? 'Ocupado' : 'Disponible';
    if (occ === 0) return 'Vacío';
    if (occ < cap) return 'Disponible';
    return 'Lleno';
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {areas.map(area => {
        const occupancy = getOccupancy(area.id);
        const areaSessions = getAreaSessions(area.id);
        const isPrivadoOcupado = area.es_privado && areaSessions.length > 0;

        return (
          <Card key={area.id} className={`border-2 transition-colors ${getStatusColor(area.es_privado, areaSessions, occupancy, area.capacidad_pax)}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {area.es_privado
                    ? <Lock className="h-3.5 w-3.5 opacity-70" />
                    : <Users className="h-3.5 w-3.5 opacity-70" />}
                  <CardTitle className="text-base font-heading">{area.nombre_area}</CardTitle>
                </div>
                {area.es_privado
                  ? <Badge variant="outline" className="text-xs">{isPrivadoOcupado ? 'Privado · Ocupado' : 'Privado · Libre'}</Badge>
                  : <Badge variant="outline" className="text-xs font-mono">{occupancy}/{area.capacidad_pax}</Badge>
                }
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">{getStatusLabel(area.es_privado, areaSessions, occupancy, area.capacidad_pax)}</p>
                {area.precio_por_hora > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ${area.precio_por_hora}/hr{area.es_privado ? ' (espacio)' : '/pax'}
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Progress bar: private shows full block when occupied */}
              <div className="w-full bg-muted rounded-full h-2">
                {area.es_privado ? (
                  <div
                    className={`h-2 rounded-full transition-all ${isPrivadoOcupado ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: isPrivadoOcupado ? '100%' : '0%' }}
                  />
                ) : (
                  <div
                    className={`h-2 rounded-full transition-all ${occupancy === 0 ? 'bg-emerald-500' : occupancy < area.capacidad_pax ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min((occupancy / area.capacidad_pax) * 100, 100)}%` }}
                  />
                )}
              </div>

              {/* Detalle por sesión vive solo en la tabla "Sesiones Activas" */}

            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
