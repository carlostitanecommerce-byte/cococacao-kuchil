import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Gift, Sparkles, Package } from 'lucide-react';
import type { CoworkingSession } from './types';
import { nowCDMX } from '@/lib/utils';
import {
  fetchSessionUpsellsForCancel,
  cancelarSesionAtomico,
  type SessionUpsellRow,
  type EntregaItem,
} from './cancelacionUtils';

interface Props {
  session: CoworkingSession | null;
  isAdmin: boolean;
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}

type Step = 'motivo' | 'entregas';

interface EntregaState {
  entregado: boolean;
  cantidad: number;
}

export function CancelSessionDialog({ session, isAdmin, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('motivo');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [upsells, setUpsells] = useState<SessionUpsellRow[]>([]);
  const [loadingUpsells, setLoadingUpsells] = useState(false);
  const [entregas, setEntregas] = useState<Record<string, EntregaState>>({});

  useEffect(() => {
    if (!session) return;
    setStep('motivo');
    setMotivo('');
    setUpsells([]);
    setEntregas({});
  }, [session?.id]);

  const handleClose = () => {
    setMotivo('');
    setStep('motivo');
    setUpsells([]);
    setEntregas({});
    onClose();
  };

  const goToEntregas = async () => {
    if (!session || !motivo.trim()) return;
    setLoadingUpsells(true);
    const rows = await fetchSessionUpsellsForCancel(session.id);
    setUpsells(rows);
    // Default: amenities NO entregados, extras pagados SÍ entregados
    const initial: Record<string, EntregaState> = {};
    for (const r of rows) {
      initial[r.id] = {
        entregado: !r.isAmenity, // pagados ON, amenities OFF
        cantidad: r.cantidad,
      };
    }
    setEntregas(initial);
    setLoadingUpsells(false);

    // Si no hay items, saltar el paso 2 y confirmar directo
    if (rows.length === 0) {
      await ejecutarCancelacion([]);
    } else {
      setStep('entregas');
    }
  };

  const buildEntregadosFinal = (): EntregaItem[] => {
    const list: EntregaItem[] = [];
    for (const u of upsells) {
      const st = entregas[u.id];
      if (!st || !st.entregado) continue;
      const cant = Math.max(0, Math.min(st.cantidad, u.cantidad));
      if (cant <= 0) continue;
      list.push({ producto_id: u.producto_id, nombre: u.nombre, cantidad: cant });
    }
    return list;
  };

  const ejecutarCancelacion = async (entregadosFinal: EntregaItem[]) => {
    if (!user || !session) return;
    setLoading(true);

    if (isAdmin) {
      // Admin: cancelación atómica vía RPC (mermas + stock + limpieza + estado + audit en una sola transacción)
      const resumen = await cancelarSesionAtomico({
        sessionId: session.id,
        motivo: motivo.trim(),
        entregados: entregadosFinal,
        isAdmin: true,
      });

      if (!resumen.ok) {
        toast({ variant: 'destructive', title: 'Error al cancelar', description: resumen.error ?? 'Operación rechazada' });
        setLoading(false);
        return;
      }

      const desc = entregadosFinal.length > 0
        ? `Cancelada. ${resumen.mermasCreadas} merma(s) registrada(s) por entregas reales.`
        : `Cancelada. Sin descuento de inventario.`;
      toast({ title: 'Sesión cancelada', description: desc });
    } else {
      // Operador: envía solicitud con los items que dice haber entregado
      const { error } = await supabase
        .from('solicitudes_cancelacion_sesiones' as any)
        .insert({
          session_id: session.id,
          solicitante_id: user.id,
          motivo: motivo.trim(),
          items_entregados: entregadosFinal as any,
        });

      if (error) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
        setLoading(false);
        return;
      }

      await supabase.from('audit_logs').insert([{
        user_id: user.id,
        accion: 'solicitar_cancelacion_sesion',
        descripcion: `Solicitud de cancelación: ${session.cliente_nombre} — Motivo: ${motivo.trim()} — Declara entregar ${entregadosFinal.length} item(s)`,
        metadata: {
          session_id: session.id,
          area_id: session.area_id,
          cliente_nombre: session.cliente_nombre,
          pax_count: session.pax_count,
          motivo: motivo.trim(),
          entregados: entregadosFinal as any,
        } as any,
      }]);

      toast({ title: 'Solicitud enviada', description: 'El administrador revisará las entregas y aprobará.' });
    }

    setLoading(false);
    handleClose();
    await onSuccess?.();
  };

  const handleConfirmEntregas = async () => {
    await ejecutarCancelacion(buildEntregadosFinal());
  };

  const totalEntregados = Object.entries(entregas).filter(([, s]) => s.entregado && s.cantidad > 0).length;

  return (
    <AlertDialog open={!!session} onOpenChange={open => !open && !loading && handleClose()}>
      <AlertDialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {step === 'motivo'
              ? (isAdmin ? 'Cancelar Sesión' : 'Solicitar Cancelación')
              : '¿Qué se entregó al cliente?'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            {step === 'motivo' ? (
              isAdmin ? (
                <>
                  ¿Estás seguro de que deseas cancelar esta sesión?{' '}
                  <span className="font-semibold text-foreground">Esta acción no se puede deshacer.</span>
                </>
              ) : (
                <>Se enviará una solicitud al administrador para cancelar esta sesión.</>
              )
            ) : (
              <>
                Marca los amenities y productos que el cliente <span className="font-semibold text-foreground">sí recibió</span>.
                Esos se descontarán del inventario como merma. Lo no entregado se liberará sin afectar stock.
              </>
            )}
            {session && step === 'motivo' && (
              <span className="block mt-2 text-foreground/80">
                Cliente: <span className="font-medium">{session.cliente_nombre}</span> · {session.pax_count} pax
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {step === 'motivo' && (
          <div className="space-y-2 py-2">
            <Label htmlFor="motivo" className="text-sm font-medium">
              Motivo de la cancelación <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="motivo"
              placeholder="Ej. Falla técnica, Cliente se retiró por urgencia..."
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className="min-h-[90px] resize-none"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground text-right">{motivo.length}/300</p>
          </div>
        )}

        {step === 'entregas' && (
          <div className="space-y-3 py-2">
            {loadingUpsells ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Cargando...</p>
            ) : upsells.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                Esta sesión no tiene amenities ni productos asociados.
              </p>
            ) : (
              <>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Por defecto: <span className="font-medium text-foreground">amenities OFF</span> (asumimos que no se consumieron),
                  <span className="font-medium text-foreground"> productos pagados ON</span> (suelen ya haberse servido).
                  Ajusta lo que sea necesario.
                </div>

                <div className="space-y-2">
                  {upsells.map(u => {
                    const st = entregas[u.id] ?? { entregado: false, cantidad: u.cantidad };
                    return (
                      <div
                        key={u.id}
                        className="flex items-center gap-3 rounded-md border border-border/60 bg-background p-3"
                      >
                        <div className="shrink-0">
                          {u.isAmenity ? (
                            <Gift className="h-4 w-4 text-primary" />
                          ) : (
                            <Sparkles className="h-4 w-4 text-accent-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{u.nombre}</span>
                            <span className="text-xs text-muted-foreground">
                              {u.isAmenity ? 'Amenity' : `$${u.precio_especial.toFixed(2)}`} · solicitado ×{u.cantidad}
                            </span>
                          </div>
                          {st.entregado && (
                            <div className="flex items-center gap-2 mt-2">
                              <Label htmlFor={`qty-${u.id}`} className="text-xs text-muted-foreground">
                                Cantidad entregada:
                              </Label>
                              <Input
                                id={`qty-${u.id}`}
                                type="number"
                                min={1}
                                max={u.cantidad}
                                value={st.cantidad}
                                onChange={e =>
                                  setEntregas(prev => ({
                                    ...prev,
                                    [u.id]: {
                                      ...prev[u.id],
                                      cantidad: Math.max(1, Math.min(u.cantidad, parseInt(e.target.value, 10) || 1)),
                                    },
                                  }))
                                }
                                className="h-7 w-20 text-xs"
                              />
                              <span className="text-xs text-muted-foreground">/ {u.cantidad}</span>
                            </div>
                          )}
                        </div>
                        <Switch
                          checked={st.entregado}
                          onCheckedChange={checked =>
                            setEntregas(prev => ({
                              ...prev,
                              [u.id]: { entregado: checked, cantidad: prev[u.id]?.cantidad ?? u.cantidad },
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                  <Package className="h-3.5 w-3.5" />
                  <span>
                    {totalEntregados} de {upsells.length} marcados como entregados
                    {totalEntregados > 0 && ' · se descontarán del inventario'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        <AlertDialogFooter className="flex-row gap-2 sm:justify-end">
          {step === 'motivo' ? (
            <>
              <AlertDialogCancel onClick={handleClose} disabled={loading}>
                Regresar
              </AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={goToEntregas}
                disabled={!motivo.trim() || loadingUpsells}
              >
                {loadingUpsells ? 'Cargando...' : 'Continuar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('motivo')} disabled={loading}>
                Atrás
              </Button>
              <Button variant="destructive" onClick={handleConfirmEntregas} disabled={loading}>
                {loading
                  ? (isAdmin ? 'Cancelando...' : 'Enviando...')
                  : (isAdmin ? 'Confirmar Cancelación' : 'Enviar Solicitud')}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
