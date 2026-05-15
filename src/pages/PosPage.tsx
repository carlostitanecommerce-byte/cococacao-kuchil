import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ProductGrid } from '@/components/pos/ProductGrid';
import { CartPanel } from '@/components/pos/CartPanel';
import { StickyCheckoutBar } from '@/components/pos/StickyCheckoutBar';
import { PaqueteSelectorDialog } from '@/components/pos/PaqueteSelectorDialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { verificarStock } from '@/hooks/useValidarStock';
import { useCartStore } from '@/stores/cartStore';
import { useAuth } from '@/hooks/useAuth';
import { useIsDesktop } from '@/hooks/use-mobile';
import { enviarASesionKDS } from '@/components/coworking/sendToKitchen';
import type { PaqueteOpcionSeleccionada } from '@/components/pos/types';

interface PaqueteCtx { id: string; nombre: string; precio_venta: number }

const PosPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [ticketOpen, setTicketOpen] = useState(false);
  const [paqueteCtx, setPaqueteCtx] = useState<PaqueteCtx | null>(null);
  const [charging, setCharging] = useState(false);
  // M3: lock por producto_id para evitar doble-clic concurrente.
  const addingLockRef = useRef<Set<string>>(new Set());

  const items = useCartStore((s) => s.items);
  const ensureOwner = useCartStore((s) => s.ensureOwner);
  const addOrIncrementProduct = useCartStore((s) => s.addOrIncrementProduct);
  const addOrIncrementPaquete = useCartStore((s) => s.addOrIncrementPaquete);
  const updateQty = useCartStore((s) => s.updateQty);
  const updateNotas = useCartStore((s) => s.updateNotas);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);
  const coworkingSessionId = useCartStore((s) => s.coworkingSessionId);
  const clienteNombre = useCartStore((s) => s.clienteNombre);
  const tarifaUpsells = useCartStore((s) => s.tarifaUpsells);
  const setActiveCoworkingSession = useCartStore((s) => s.setActiveCoworkingSession);
  const setTarifaUpsells = useCartStore((s) => s.setTarifaUpsells);

  useEffect(() => {
    ensureOwner(user?.id ?? null);
  }, [user?.id, ensureOwner]);

  // Detección de contexto: cargar sesión de coworking desde URL
  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const clientName = searchParams.get('client_name');
    if (!sessionId) {
      setActiveCoworkingSession(null, null);
      setTarifaUpsells({});
      return;
    }
    setActiveCoworkingSession(sessionId, clientName);
    (async () => {
      const { data: sess } = await supabase
        .from('coworking_sessions')
        .select('tarifa_id, cliente_nombre')
        .eq('id', sessionId)
        .maybeSingle();
      if (!sess) {
        toast.error('Sesión de coworking no encontrada');
        return;
      }
      if (!sess.tarifa_id) {
        setTarifaUpsells({});
        toast.success(`Cuenta abierta: ${sess.cliente_nombre}`);
        return;
      }
      const { data: ups } = await supabase
        .from('tarifa_upsells')
        .select('producto_id, precio_especial')
        .eq('tarifa_id', sess.tarifa_id);
      const map: Record<string, number> = {};
      (ups ?? []).forEach((u: any) => { map[u.producto_id] = Number(u.precio_especial); });
      setTarifaUpsells(map);
      toast.success(`Cuenta abierta: ${sess.cliente_nombre}${Object.keys(map).length ? ` · ${Object.keys(map).length} precios especiales` : ''}`);
    })();
  }, [searchParams, setActiveCoworkingSession, setTarifaUpsells]);

  const addProduct = useCallback(async (p: { id: string; nombre: string; precio_venta: number; tipo?: 'simple' | 'paquete' }) => {
    // M3: anti doble-clic — si ya hay una operación en curso para este producto, ignorar.
    if (addingLockRef.current.has(p.id)) return;
    addingLockRef.current.add(p.id);
    try {
    // M2: validar stock acumulado considerando lo que ya está en el carrito
    const currentItems = useCartStore.getState().items;
    if (p.tipo === 'paquete') {
      // Para paquetes legacy (sin opciones), acumulamos cantidad existente.
      const existentePaquete = currentItems.find(
        (i) => i.tipo_concepto === 'paquete' && i.producto_id === p.id && !i.opciones
      );
      const cantidadAValidar = (existentePaquete?.cantidad ?? 0) + 1;
      const { data: validacionPaquete, error: rpcErr } = await supabase.rpc(
        'validar_stock_paquete',
        { p_paquete_id: p.id, p_cantidad: cantidadAValidar }
      );
      if (rpcErr) { toast.error('Error al validar stock del paquete'); return; }
      const resultado = validacionPaquete as unknown as { valido: boolean; error?: string };
      if (!resultado?.valido) { toast.error(resultado?.error || 'Stock insuficiente para este paquete'); return; }

      // ¿Tiene grupos dinámicos configurados?
      const { count: gruposCount } = await supabase
        .from('paquete_grupos')
        .select('id', { count: 'exact', head: true })
        .eq('paquete_id', p.id);

      if ((gruposCount ?? 0) > 0) {
        // Paquete dinámico → abrir modal de selección
        setPaqueteCtx({ id: p.id, nombre: p.nombre, precio_venta: p.precio_venta });
        return;
      }

      // Paquete legacy basado en paquete_componentes
      const { data: comps } = await supabase
        .from('paquete_componentes')
        .select('producto_id, cantidad, productos:producto_id(nombre, activo)')
        .eq('paquete_id', p.id);

      if (!comps || comps.length === 0) {
        toast.error('Este paquete no tiene componentes configurados.');
        return;
      }
      const invalid = (comps as any[]).filter(c => !c.productos || c.productos.activo === false);
      if (invalid.length > 0) {
        toast.error('Paquete con componentes inválidos o inactivos.');
        return;
      }

      const componentes = (comps ?? []).map((c: any) => ({
        producto_id: c.producto_id,
        nombre: c.productos?.nombre ?? '—',
        cantidad: Number(c.cantidad),
      }));

      addOrIncrementPaquete({
        producto_id: p.id,
        nombre: `📦 ${p.nombre}`,
        precio_unitario: p.precio_venta,
        cantidad: 1,
        subtotal: p.precio_venta,
        tipo_concepto: 'paquete',
        paquete_id: p.id,
        componentes,
      });
      return;
    }

    const existenteProd = currentItems.find(
      (i) => i.tipo_concepto === 'producto' && i.producto_id === p.id
    );
    const cantidadProdValidar = (existenteProd?.cantidad ?? 0) + 1;
    const validacion = await verificarStock(p.id, cantidadProdValidar);
    if (!validacion.valido) { toast.error(validacion.error); return; }

    const especial = tarifaUpsells[p.id];
    const precioFinal = especial != null ? especial : p.precio_venta;

    addOrIncrementProduct({
      producto_id: p.id,
      nombre: p.nombre,
      precio_unitario: precioFinal,
      cantidad: 1,
      subtotal: precioFinal,
      tipo_concepto: 'producto',
      precio_especial: especial != null,
    });
    } finally {
      addingLockRef.current.delete(p.id);
    }
  }, [addOrIncrementProduct, addOrIncrementPaquete, tarifaUpsells]);

  const handlePaqueteConfirm = useCallback(({ opciones, precioFinal }: { opciones: PaqueteOpcionSeleccionada[]; precioFinal: number }) => {
    if (!paqueteCtx) return;
    // Guardia: el paquete debe tener al menos una opción seleccionada para que el descuento de inventario sea correcto
    if (!opciones || opciones.length === 0) {
      toast.error('Selecciona al menos una opción del paquete');
      return;
    }
    // Derivar componentes para compatibilidad con KDS y prorrateo en ConfirmVentaDialog
    const counts = new Map<string, { producto_id: string; nombre: string; cantidad: number }>();
    for (const o of opciones) {
      const prev = counts.get(o.producto_id);
      if (prev) prev.cantidad += 1;
      else counts.set(o.producto_id, { producto_id: o.producto_id, nombre: o.nombre_producto, cantidad: 1 });
    }
    if (counts.size === 0) {
      toast.error('Las opciones del paquete no tienen productos válidos');
      return;
    }
    addOrIncrementPaquete({
      producto_id: paqueteCtx.id,
      nombre: `📦 ${paqueteCtx.nombre}`,
      precio_unitario: precioFinal,
      cantidad: 1,
      subtotal: precioFinal,
      tipo_concepto: 'paquete',
      paquete_id: paqueteCtx.id,
      opciones,
      componentes: Array.from(counts.values()),
    });
    setPaqueteCtx(null);
  }, [paqueteCtx, addOrIncrementPaquete]);

  const handleUpdateQty = useCallback(async (lineId: string, delta: number) => {
    if (delta > 0) {
      const item = items.find(i => (i.lineId ?? i.producto_id) === lineId);
      if (item && item.tipo_concepto === 'producto') {
        const validacion = await verificarStock(item.producto_id, 1);
        if (!validacion.valido) { toast.error(validacion.error); return; }
      }
      // Para paquetes el control de stock ya se valida globalmente al cobrar.
    }
    updateQty(lineId, delta);
  }, [updateQty, items]);

  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const itemCount = items.reduce((s, i) => s + i.cantidad, 0);

  const isOpenAccount = !!coworkingSessionId;

  const chargeToOpenAccount = useCallback(async () => {
    if (!coworkingSessionId || items.length === 0) return;
    setCharging(true);
    try {
      const payloadItems = items.map((it) => ({
        producto_id: it.tipo_concepto === 'paquete' ? null : it.producto_id,
        paquete_id: it.tipo_concepto === 'paquete' ? (it.paquete_id ?? it.producto_id) : null,
        paquete_nombre: it.tipo_concepto === 'paquete' ? it.nombre.replace(/^📦\s*/, '') : null,
        tipo_concepto: it.tipo_concepto === 'paquete' ? 'paquete' : 'producto',
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        subtotal: it.subtotal,
        descripcion: it.notas ?? null,
        componentes: it.tipo_concepto === 'paquete' && it.componentes
          ? it.componentes.map((c) => ({ producto_id: c.producto_id, cantidad: c.cantidad }))
          : null,
      }));

      const kdsItems = items.flatMap((it) => {
        if (it.tipo_concepto === 'paquete' && it.componentes && it.componentes.length > 0) {
          return it.componentes.map((c) => ({
            producto_id: c.producto_id,
            nombre: c.nombre,
            cantidad: c.cantidad * it.cantidad,
            notas: it.notas ?? null,
          }));
        }
        return [{
          producto_id: it.producto_id,
          nombre: it.nombre,
          cantidad: it.cantidad,
          notas: it.notas ?? null,
        }];
      });

      const { error } = await supabase.rpc('registrar_consumo_coworking' as any, {
        p_session_id: coworkingSessionId,
        p_items: payloadItems as any,
        p_kds_items: kdsItems as any,
      });

      if (error) {
        console.error(error);
        toast.error(error.message || 'Error al cargar a la cuenta');
        return;
      }

      toast.success(`Consumos cargados a la cuenta de ${clienteNombre ?? 'sesión'}`);
      clear();
      navigate('/coworking');
    } finally {
      setCharging(false);
    }
  }, [coworkingSessionId, clienteNombre, items, clear, navigate]);

  const goToCheckout = () => {
    setTicketOpen(false);
    if (isOpenAccount) {
      chargeToOpenAccount();
    } else {
      navigate('/caja');
    }
  };

  const checkoutLabel = isOpenAccount ? 'Cargar a Cuenta' : 'Procesar pago en Caja';
  const checkoutLabelMobile = isOpenAccount ? 'Cargar a Cuenta' : 'Cobrar';
  const CheckoutIcon = isOpenAccount ? ClipboardCheck : ArrowRight;

  const paqueteDialog = (
    <PaqueteSelectorDialog
      open={!!paqueteCtx}
      onOpenChange={(o) => { if (!o) setPaqueteCtx(null); }}
      paquete={paqueteCtx}
      onConfirm={handlePaqueteConfirm}
    />
  );

  if (isDesktop) {
    return (
      <>
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 h-[calc(100vh-3rem)]">
          <div className="lg:col-span-5 min-h-0">
            <ProductGrid onAdd={addProduct} />
          </div>
          <div className="lg:col-span-2 border border-border rounded-lg p-3 bg-card flex flex-col min-h-0">
            <CartPanel
              items={items}
              onUpdateQty={handleUpdateQty}
              onUpdateNotas={updateNotas}
              onRemove={removeItem}
              onClear={clear}
              subtotal={subtotal}
              coworkingSessionActive={isOpenAccount}
              clienteNombre={clienteNombre}
            />
            <Button
              className="mt-3 w-full"
              size="lg"
              disabled={items.length === 0 || charging}
              onClick={goToCheckout}
            >
              {checkoutLabel}
              <CheckoutIcon className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
        {paqueteDialog}
      </>
    );
  }

  // Tablet / mobile layout: products full-width + bottom bar + ticket Sheet
  return (
    <>
      <div className="flex flex-col h-[calc(100vh-3rem)] -mx-6 -my-6">
        <div className="flex-1 min-h-0 overflow-hidden px-4 pt-4">
          <ProductGrid onAdd={addProduct} />
        </div>

        <StickyCheckoutBar
          itemCount={itemCount}
          total={subtotal}
          onViewTicket={() => setTicketOpen(true)}
          onCheckout={goToCheckout}
        />

        <Sheet open={ticketOpen} onOpenChange={setTicketOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md p-4 flex flex-col">
            <SheetHeader className="mb-2">
              <SheetTitle>Ticket actual</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 flex flex-col">
              <CartPanel
                items={items}
                onUpdateQty={handleUpdateQty}
                onUpdateNotas={updateNotas}
                onRemove={removeItem}
                onClear={clear}
                subtotal={subtotal}
                coworkingSessionActive={isOpenAccount}
                clienteNombre={clienteNombre}
              />
            </div>
            <Button
              className="mt-3 w-full"
              size="lg"
              disabled={items.length === 0 || charging}
              onClick={goToCheckout}
            >
              {checkoutLabelMobile}
              <CheckoutIcon className="ml-2 h-4 w-4" />
            </Button>
          </SheetContent>
        </Sheet>
      </div>
      {paqueteDialog}
    </>
  );
};

export default PosPage;
