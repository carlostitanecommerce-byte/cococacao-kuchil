import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { verificarStock } from '@/hooks/useValidarStock';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Gift, Sparkles, ShoppingBag, Users, Pencil, Check, X, ShoppingCart, Ban } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Area, CoworkingSession } from './types';
import { enviarASesionKDS } from './sendToKitchen';

interface SnapshotAmenity {
  producto_id: string;
  cantidad_incluida: number;
  nombre?: string;
}

interface PendingAmenityUpdate {
  newPax: number;
  oldPax: number;
}

interface SessionItem {
  id: string;
  producto_id: string;
  nombre: string;
  precio_especial: number;
  cantidad: number;
  pendingCancelQty: number;
  tipo_concepto: string;
}

interface Props {
  session: CoworkingSession | null;
  areas: Area[];
  onClose: () => void;
  onSuccess?: () => void | Promise<void>;
}

export function ManageSessionAccountDialog({ session, areas, onClose, onSuccess }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [items, setItems] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditingPax, setIsEditingPax] = useState(false);
  const [tempPax, setTempPax] = useState('');
  const [pendingAmenityUpdate, setPendingAmenityUpdate] = useState<PendingAmenityUpdate | null>(null);
  const mutationLockRef = useRef(false);
  const mutatedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SessionItem | null>(null);
  const [cancelQty, setCancelQty] = useState('1');
  const [cancelMotivo, setCancelMotivo] = useState('');

  const openCancel = (item: SessionItem) => {
    const max = item.cantidad - item.pendingCancelQty;
    setCancelTarget(item);
    setCancelQty(String(max));
    setCancelMotivo('');
  };

  const handleConfirmCancel = () => withLock(async () => {
    if (!session || !cancelTarget) return;
    const qty = parseInt(cancelQty, 10);
    const max = cancelTarget.cantidad - cancelTarget.pendingCancelQty;
    if (isNaN(qty) || qty < 1 || qty > max) {
      toast({ variant: 'destructive', title: 'Cantidad inválida', description: `Debe estar entre 1 y ${max}.` });
      return;
    }
    if (cancelMotivo.trim().length < 4) {
      toast({ variant: 'destructive', title: 'Motivo requerido', description: 'Mínimo 4 caracteres.' });
      return;
    }
    const { error } = await supabase.rpc('solicitar_cancelacion_item_sesion' as any, {
      p_session_id: session.id,
      p_detalle_id: cancelTarget.id,
      p_cantidad: qty,
      p_motivo: cancelMotivo.trim(),
    });
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo solicitar', description: error.message });
      return;
    }
    mutatedRef.current = true;
    toast({ title: 'Solicitud enviada a cocina', description: 'Cocina decidirá si retorna al stock o registra merma.' });
    setCancelTarget(null);
    await reloadItemsAndCancels();
  });

  const withLock = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (mutationLockRef.current) return undefined;
    mutationLockRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      mutationLockRef.current = false;
      setBusy(false);
    }
  };

  const missingAmenities = useMemo(() => {
    if (!session || !session.tarifa_snapshot?.amenities) return [];
    const snapshotAmenities = session.tarifa_snapshot.amenities as any[];
    const result: any[] = [];

    for (const a of snapshotAmenities) {
      const maxAllowed = (a.cantidad_incluida || 0) * session.pax_count;
      const currentItem = items.find(
        i => i.producto_id === a.producto_id && i.tipo_concepto === 'amenity',
      );
      const currentQty = currentItem ? currentItem.cantidad : 0;

      if (maxAllowed > currentQty) {
        result.push({
          ...a,
          disponible: maxAllowed - currentQty,
          currentItemId: currentItem?.id,
        });
      }
    }
    return result;
  }, [session, items]);

  const handleRestoreAmenity = (amenity: any) => withLock(() => doRestoreAmenity(amenity));
  const doRestoreAmenity = async (amenity: any) => {
    if (!session) return;
    const qty = Math.max(1, Number(amenity.disponible) || 1);
    const { data, error } = await supabase.rpc('registrar_amenity_sesion' as any, {
      p_session_id: session.id,
      p_producto_id: amenity.producto_id,
      p_cantidad: qty,
    });
    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo reclamar', description: error.message });
      return;
    }
    const result = data as { ok: boolean; nombre?: string };
    mutatedRef.current = true;

    const kdsRes = await enviarASesionKDS({
      context: { sessionId: session.id, clienteNombre: session.cliente_nombre, motivo: 'add' },
      items: [{
        producto_id: amenity.producto_id,
        nombre: result.nombre || amenity.nombre || 'Amenity',
        cantidad: qty,
        isAmenity: true,
      }],
    });
    toast({
      title: qty > 1 ? `${qty} beneficios reclamados` : 'Beneficio reclamado',
      description: kdsRes.folio ? `Comanda #${String(kdsRes.folio).padStart(4, '0')} enviada a cocina` : undefined,
    });
    await reloadItemsAndCancels();
  };

  // Recarga items + cancelaciones pendientes (para refrescar pendingCancelQty)
  const reloadItemsAndCancels = async () => {
    if (!session) return;
    const [itemsRes, cancelRes] = await Promise.all([
      (supabase as any)
        .from('detalle_ventas')
        .select('id, producto_id, precio_unitario, cantidad, tipo_concepto, productos:producto_id(nombre)')
        .eq('coworking_session_id', session.id)
        .is('venta_id', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('cancelaciones_items_sesion')
        .select('detalle_id, cantidad')
        .eq('session_id', session.id)
        .eq('estado', 'pendiente_decision'),
    ]);
    const pendingByDetalle = new Map<string, number>();
    (cancelRes.data ?? []).forEach((c: any) => {
      if (c.detalle_id) pendingByDetalle.set(c.detalle_id, (pendingByDetalle.get(c.detalle_id) ?? 0) + (c.cantidad || 0));
    });
    const mapped: SessionItem[] = ((itemsRes.data ?? []) as any[]).map((u: any) => ({
      id: u.id,
      producto_id: u.producto_id,
      nombre: u.productos?.nombre ?? 'Producto',
      precio_especial: Number(u.precio_unitario) || 0,
      cantidad: u.cantidad,
      pendingCancelQty: pendingByDetalle.get(u.id) ?? 0,
      tipo_concepto: u.tipo_concepto ?? 'producto',
    }));
    setItems(mapped);
  };

  useEffect(() => {
    if (!session) return;
    const fetchAll = async () => {
      setLoading(true);
      await reloadItemsAndCancels();
      setLoading(false);
    };
    fetchAll();
  }, [session]);

  // Realtime: refrescar al cambiar cancelaciones (decisión de cocina) o upsells
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel(`manage-session-${session.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cancelaciones_items_sesion', filter: `session_id=eq.${session.id}` },
        () => { reloadItemsAndCancels(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'detalle_ventas', filter: `coworking_session_id=eq.${session.id}` },
        () => { reloadItemsAndCancels(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.id]);

  const sessionArea = session ? areas.find(a => a.id === session.area_id) : undefined;

  const handleSavePax = () => withLock(async () => {
    if (!session) return;
    const pax = parseInt(tempPax, 10);
    if (isNaN(pax) || pax < 1) {
      toast({ variant: 'destructive', title: 'Pax inválido' });
      return;
    }
    if (sessionArea && pax > sessionArea.capacidad_pax) {
      toast({ variant: 'destructive', title: 'Excede capacidad', description: `Máximo ${sessionArea.capacidad_pax} personas.` });
      return;
    }

    const oldPax = session.pax_count;
    const { error } = await supabase
      .from('coworking_sessions')
      .update({ pax_count: pax })
      .eq('id', session.id);

    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      return;
    }

    mutatedRef.current = true;
    toast({ title: `Pax actualizado a ${pax}` });
    setIsEditingPax(false);
    await onSuccess?.();

    const amenities = (session.tarifa_snapshot?.amenities ?? []) as SnapshotAmenity[];
    if (pax !== oldPax && Array.isArray(amenities) && amenities.length > 0) {
      setPendingAmenityUpdate({ newPax: pax, oldPax });
    }
  });

  const handleConfirmAmenityRecalc = () => withLock(async () => {
    if (!pendingAmenityUpdate || !session) return;
    const { newPax: pax } = pendingAmenityUpdate;

    const { data, error } = await supabase.rpc('recalcular_amenities_pax' as any, {
      p_session_id: session.id,
      p_new_pax: pax,
    });

    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo recalcular amenities', description: error.message });
      return;
    }

    const result = data as {
      ok: boolean;
      increments: Array<{ producto_id: string; nombre: string; cantidad: number }>;
      mermas_creadas: number;
      lineas_aumentadas: number;
      lineas_reducidas: number;
      lineas_eliminadas: number;
    };

    let kdsFolio: number | null = null;
    if (result.increments && result.increments.length > 0) {
      const kdsRes = await enviarASesionKDS({
        context: { sessionId: session.id, clienteNombre: session.cliente_nombre, motivo: 'incremento' },
        items: result.increments.map(d => ({ ...d, isAmenity: true })),
      });
      kdsFolio = kdsRes.folio;
    }

    const partes: string[] = [];
    if (result.lineas_aumentadas > 0) partes.push(`${result.lineas_aumentadas} aumento(s)`);
    if (result.lineas_reducidas > 0 || result.lineas_eliminadas > 0) {
      partes.push(`${result.lineas_reducidas + result.lineas_eliminadas} reducción(es)`);
    }
    if (result.mermas_creadas > 0) partes.push(`${result.mermas_creadas} merma(s)`);
    if (kdsFolio) partes.push(`cocina #${String(kdsFolio).padStart(4, '0')}`);

    mutatedRef.current = true;
    toast({
      title: `Amenities actualizados a ${pax} pax`,
      description: partes.length > 0 ? partes.join(' · ') : 'Sin cambios.',
    });

    setPendingAmenityUpdate(null);
    await reloadItemsAndCancels();
    await onSuccess?.();
  });

  const handleClose = () => {
    setIsEditingPax(false);
    onClose();
    if (mutatedRef.current) {
      mutatedRef.current = false;
      onSuccess?.();
    }
  };

  const handleGoToPos = () => {
    if (!session) return;
    const params = new URLSearchParams({
      session_id: session.id,
      client_name: session.cliente_nombre,
    });
    handleClose();
    navigate(`/pos?${params.toString()}`);
  };

  if (!session) return null;

  const totalCuenta = items.reduce((sum, i) => sum + i.precio_especial * i.cantidad, 0);

  return (
    <Dialog open={!!session} onOpenChange={() => handleClose()}>
      <DialogContent className="sm:max-w-2xl lg:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <span>Cuenta de la sesión — {session.cliente_nombre}</span>
            <div className="flex items-center gap-1.5 ml-auto mr-8 text-sm font-normal">
              <Users className="h-4 w-4 text-muted-foreground" />
              {isEditingPax ? (
                <>
                  <Input
                    type="number"
                    min={1}
                    max={sessionArea?.capacidad_pax ?? 99}
                    value={tempPax}
                    onChange={e => setTempPax(e.target.value)}
                    className="h-7 w-16 text-sm"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSavePax} disabled={busy} title="Guardar">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setIsEditingPax(false)} title="Cancelar">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="font-medium">{session.pax_count} pax</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => { setTempPax(String(session.pax_count)); setIsEditingPax(true); }}
                    title="Editar pax"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </DialogTitle>
          {sessionArea && (
            <p className="text-xs text-muted-foreground mt-1">
              {sessionArea.nombre_area} · Capacidad máxima: {sessionArea.capacidad_pax}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Estado de la cuenta (solo lectura) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Estado de la Cuenta</h3>
              <span className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? 'concepto' : 'conceptos'}
              </span>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground py-3">Cargando...</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center border border-dashed rounded-md">
                Aún no hay productos en la cuenta. Usa “Agregar Consumo en POS” para registrar consumos.
              </p>
            ) : (
              <div className="space-y-1.5">
                {items.map(item => {
                  const isAmenity = item.tipo_concepto === 'amenity';
                  const hasPending = item.pendingCancelQty > 0;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between rounded-md border p-2.5 text-sm ${
                        hasPending ? 'border-destructive/50 bg-destructive/5' : 'border-border/60 bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isAmenity ? (
                          <Gift className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-accent-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <span className="font-medium truncate">{item.nombre}</span>
                          {item.cantidad > 1 && (
                            <span className="text-muted-foreground ml-1">×{item.cantidad}</span>
                          )}
                          {hasPending && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-destructive font-semibold">
                              Cancelación pendiente ({item.pendingCancelQty})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={
                            isAmenity ? 'text-primary font-medium' : 'text-foreground font-medium'
                          }
                        >
                          {isAmenity ? 'Incluido' : `$${(item.precio_especial * item.cantidad).toFixed(2)}`}
                        </span>
                        {!isAmenity && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => openCancel(item)}
                            disabled={busy || item.pendingCancelQty >= item.cantidad}
                            title="Solicitar cancelación de este item"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground text-right pt-1">
                  Total consumos: <span className="font-medium text-foreground">${totalCuenta.toFixed(2)}</span>
                </p>
              </div>
            )}
          </section>

          {missingAmenities.length > 0 && (
            <section className="space-y-2 pb-2 border-b border-border/50">
              <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                <Gift className="h-4 w-4" /> Beneficios por reclamar
              </h3>
              <div className="space-y-1.5">
                {missingAmenities.map((ma, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-md p-2 text-sm">
                    <div>
                      <span className="font-medium text-foreground">{ma.nombre || 'Amenity'}</span>
                      <span className="text-xs text-muted-foreground ml-2">Disponibles: {ma.disponible}</span>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 border-primary/30 text-primary hover:bg-primary/10" onClick={() => handleRestoreAmenity(ma)} disabled={busy}>
                      <Plus className="h-3 w-3 mr-1" /> Reclamar
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 bg-background gap-2 flex-col sm:flex-row sm:items-center">
          <p className="text-[11px] text-muted-foreground sm:mr-auto sm:text-left text-center leading-tight">
            Las cancelaciones se envían a cocina para registrar merma o devolver al stock antes del cobro en POS.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cerrar
            </Button>
            <Button onClick={handleGoToPos} className="gap-2">
              <ShoppingCart className="h-4 w-4" />
              Agregar Consumo en POS
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!pendingAmenityUpdate} onOpenChange={(open) => { if (!open) setPendingAmenityUpdate(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Actualizar amenities incluidos?</AlertDialogTitle>
            <AlertDialogDescription>
              Cambiaste el pax de {pendingAmenityUpdate?.oldPax} a {pendingAmenityUpdate?.newPax}. ¿Deseas actualizar
              también la cantidad de amenities incluidos según el nuevo número de personas?
              Esta acción recalculará la cantidad gratis de cada amenity en la cuenta de la sesión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, dejar como está</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAmenityRecalc}>Sí, actualizar amenities</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Solicitar cancelación de item</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.nombre} — disponible para cancelar: {cancelTarget ? cancelTarget.cantidad - cancelTarget.pendingCancelQty : 0}.
              Cocina decidirá si los insumos se devuelven al stock o se registran como merma.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cancel-qty">Cantidad a cancelar</Label>
              <Input
                id="cancel-qty"
                type="number"
                min={1}
                max={cancelTarget ? cancelTarget.cantidad - cancelTarget.pendingCancelQty : 1}
                value={cancelQty}
                onChange={e => setCancelQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-motivo">Motivo</Label>
              <Textarea
                id="cancel-motivo"
                placeholder="Ej. Cliente cambió de opinión, error en pedido, etc."
                value={cancelMotivo}
                onChange={e => setCancelMotivo(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cerrar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCancel} disabled={busy}>
              Enviar a cocina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
