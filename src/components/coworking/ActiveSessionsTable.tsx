import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Clock, Users, LogOut as LogOutIcon, XCircle, ShoppingBag, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import type { Area, CoworkingSession } from './types';
import { SessionTimer } from './SessionTimer';

interface Props {
  sessions: CoworkingSession[];
  areas: Area[];
  onCheckOut: (session: CoworkingSession) => void;
  onCancel: (session: CoworkingSession) => void;
  onManageAccount?: (session: CoworkingSession) => void;
  onPaxUpdated?: () => void | Promise<void>;
}

export function ActiveSessionsTable({ sessions, areas, onCheckOut, onCancel, onManageAccount, onPaxUpdated }: Props) {
  const { toast } = useToast();
  const { roles } = useAuth();
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  // Roles autorizados a reabrir (alineado con la RPC reabrir_sesion_coworking)
  const canReopen = roles.some(r =>
    ['administrador', 'supervisor', 'caja', 'recepcion'].includes(r),
  );

  if (sessions.length === 0) return null;

  const handleReopen = async (s: CoworkingSession) => {
    if (reopeningId) return;
    setReopeningId(s.id);
    try {
      const { error } = await supabase.rpc('reabrir_sesion_coworking' as any, {
        p_session_id: s.id,
      });
      if (error) {
        toast({
          variant: 'destructive',
          title: 'No se pudo reabrir',
          description: error.message,
        });
        return;
      }
      toast({
        title: 'Sesión reabierta',
        description: `${s.cliente_nombre} vuelve al estado activo. El cobro previo se descartó.`,
      });
      await onPaxUpdated?.();
    } finally {
      setReopeningId(null);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-5 w-5" />Sesiones Activas
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>Pax</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Tiempo</TableHead>
                <TableHead>Salida Est.</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map(s => {
                const area = areas.find(a => a.id === s.area_id);
                const isPendientePago = (s.estado as string) === 'pendiente_pago';
                return (
                  <TableRow key={s.id} className={isPendientePago ? 'bg-amber-500/5' : ''}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{s.cliente_nombre}</span>
                        {isPendientePago && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700 bg-amber-500/10">
                            Pendiente de pago
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{area?.nombre_area ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />{s.pax_count}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(s.fecha_inicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <SessionTimer
                        fechaInicio={s.fecha_inicio}
                        fechaFinEstimada={s.fecha_fin_estimada}
                        fechaSalidaReal={s.fecha_salida_real}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(s.fecha_fin_estimada).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-nowrap justify-end">
                        {isPendientePago ? (
                          <>
                            {canReopen && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleReopen(s)}
                                disabled={reopeningId === s.id}
                                title="Devolver la sesión al estado activo (descarta el pre-cobro)"
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                {reopeningId === s.id ? 'Reabriendo...' : 'Reabrir'}
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onCancel(s)} title="Cancelar sesión">
                              <XCircle className="h-3 w-3 mr-1" />Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            {onManageAccount && (
                              <Button variant="default" size="sm" onClick={() => onManageAccount(s)} title="Gestionar cuenta de la sesión">
                                <ShoppingBag className="h-3 w-3 mr-1" />Cuenta
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => onCheckOut(s)} title="Registrar salida">
                              <LogOutIcon className="h-3 w-3 mr-1" />Salida
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onCancel(s)} title="Cancelar sesión">
                              <XCircle className="h-3 w-3 mr-1" />Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
