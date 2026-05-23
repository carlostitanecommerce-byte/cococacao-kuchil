import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, Trash2, Plus, Minus, CreditCard, AlertCircle, Lock, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/stores/cartStore';
import { useVentaConfig } from '@/components/caja/useVentaConfig';
import { ConfirmVentaDialog } from '@/components/caja/ConfirmVentaDialog';
import { useCajaSession } from '@/hooks/useCajaSession';
import { verificarStock } from '@/hooks/useValidarStock';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { VentaSummary, MixedPayment, CartItem } from '@/components/pos/types';

type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'mixto';
type TipoConsumo = 'sitio' | 'para_llevar' | 'delivery';

export function CajaCheckoutPanel() {
  const items = useCartStore((s) => s.items);
  const coworkingSessionId = useCartStore((s) => s.coworkingSessionId);
  const clienteNombre = useCartStore((s) => s.clienteNombre);
  const updateQty = useCartStore((s) => s.updateQty);
  const removeItem = useCartStore((s) => s.removeItem);
  const clear = useCartStore((s) => s.clear);

  const { config } = useVentaConfig();
  const { cajaAbierta } = useCajaSession();

  const [tipoConsumo, setTipoConsumo] = useState<TipoConsumo>('sitio');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [propinaPct, setPropinaPct] = useState<0 | 10 | 15 | 'manual'>(0);
  const [propinaManual, setPropinaManual] = useState('');
  const [propinaEnDigital, setPropinaEnDigital] = useState(false);
  const [mixed, setMixed] = useState<MixedPayment>({ efectivo: 0, tarjeta: 0, transferencia: 0 });
  const [summary, setSummary] = useState<VentaSummary | null>(null);
  const [incrementing, setIncrementing] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.subtotal, 0), [items]);
  const openAccountCount = useMemo(
    () => items.filter((i) => !!i.open_account_detalle_id).length,
    [items]
  );

  const propina = useMemo(() => {
    if (propinaPct === 'manual') return Math.max(0, parseFloat(propinaManual) || 0);
    return +(subtotal * (propinaPct / 100)).toFixed(2);
  }, [propinaPct, propinaManual, subtotal]);

  // Validaciones de propina (punto 6)
  const propinaPctSobreSubtotal = subtotal > 0 ? (propina / subtotal) * 100 : 0;
  const propinaExcedeSubtotal = propina > subtotal && subtotal > 0;
  const propinaInusual = !propinaExcedeSubtotal && propinaPctSobreSubtotal > 50;

  // Comisión bancaria SIEMPRE sobre subtotal de productos cobrados con tarjeta,
  // nunca sobre propina. En mixto, restamos la propina si el cajero indicó que
  // está incluida en el monto de tarjeta (propinaEnDigital). Esta es la fuente
  // de verdad de la comisión bancaria — cualquier cambio aquí afecta reportes
  // contables (ver mem://features/accounting-export-unified).
  const tarjetaBaseProductos = (() => {
    if (metodoPago === 'tarjeta') return subtotal;
    if (metodoPago === 'mixto' && mixed.tarjeta > 0) {
      const propinaEnTarjeta = propinaEnDigital ? propina : 0;
      return Math.max(0, mixed.tarjeta - propinaEnTarjeta);
    }
    return 0;
  })();
  const comision = +(tarjetaBaseProductos * (config.comision_bancaria_porcentaje / 100)).toFixed(2);

  const total = +(subtotal + propina).toFixed(2);

  const sumaMixta = +(mixed.efectivo + mixed.tarjeta + mixed.transferencia).toFixed(2);
  const sumaMixtaCuadra = metodoPago !== 'mixto' || Math.abs(sumaMixta - total) < 0.01;
  // Punto 5: si la propina se cobra por terminal en mixto, el monto de tarjeta
  // debe alcanzar para cubrir al menos la propina.
  const mixtoTarjetaCubrePropina =
    metodoPago !== 'mixto' || !propinaEnDigital || propina === 0 || mixed.tarjeta + 0.01 >= propina;
  const mixtoValido = sumaMixtaCuadra && mixtoTarjetaCubrePropina;

  const handleMetodoPagoChange = (v: MetodoPago) => {
    setMetodoPago(v);
    // Solo "tarjeta" permite mantener propinaEnDigital implícito; en cualquier
    // otro método reseteamos para que el cajero lo marque explícitamente si aplica.
    if (v !== 'tarjeta') setPropinaEnDigital(false);
  };

  const isReadOnlyLine = (item: CartItem) =>
    item.tipo_concepto === 'coworking' || !!item.open_account_detalle_id;

  const handleLimpiarClick = () => {
    if (coworkingSessionId && openAccountCount > 0) {
      setConfirmClearOpen(true);
    } else {
      clear();
    }
  };

  const handleIncrement = async (item: CartItem) => {
    const key = item.lineId ?? item.producto_id;
    if (isReadOnlyLine(item)) return;
    setIncrementing(key);
    try {
      const nuevaCantidad = item.cantidad + 1;

      if (item.tipo_concepto === 'producto') {
        const res = await verificarStock(item.producto_id, nuevaCantidad);
        if (!res.valido) {
          toast.error(res.error ?? 'Sin stock suficiente');
          return;
        }
      } else if (item.tipo_concepto === 'paquete' && (item.componentes?.length || item.opciones?.length)) {
        // Carrito tentativo con la cantidad incrementada para que la RPC valide
        // expandiendo componentes/opciones del paquete.
        const tentativos = items.map((i) => {
          const k = i.lineId ?? i.producto_id;
          if (k !== key) return i;
          return { ...i, cantidad: nuevaCantidad, subtotal: nuevaCantidad * i.precio_unitario };
        });
        const { data, error } = await supabase.rpc('validar_stock_carrito', {
          p_items: tentativos as any,
          p_coworking_session_id: coworkingSessionId ?? null,
        });
        if (error) {
          toast.error('Sin conexión al validar stock. Intenta de nuevo.');
          return;
        }
        const resp = data as unknown as { valido: boolean; error?: string };
        if (!resp?.valido) {
          toast.error(resp?.error ?? 'Sin stock suficiente para el paquete');
          return;
        }
      }

      updateQty(key, 1);
    } finally {
      setIncrementing(null);
    }
  };

  const handleCobrar = () => {
    if (items.length === 0) { toast.error('Agrega productos al ticket'); return; }
    if (!cajaAbierta?.id) {
      toast.error('La caja se cerró. Reabre una caja para cobrar.');
      return;
    }
    if (propinaExcedeSubtotal) {
      toast.error('La propina no puede exceder el subtotal del ticket.');
      return;
    }
    if (!sumaMixtaCuadra) {
      toast.error(`Pagos mixtos suman $${sumaMixta.toFixed(2)} pero el total es $${total.toFixed(2)}`);
      return;
    }
    if (!mixtoTarjetaCubrePropina) {
      toast.error(`El monto de tarjeta debe cubrir al menos la propina digital ($${propina.toFixed(2)}).`);
      return;
    }


    const ventaSummary: VentaSummary = {
      items,
      subtotal,
      iva: +(subtotal - subtotal / (1 + config.iva_porcentaje / 100)).toFixed(2),
      comision,
      propina,
      total,
      metodo_pago: metodoPago,
      tipo_consumo: tipoConsumo,
      mixed_payment: metodoPago === 'mixto' ? mixed : undefined,
      propina_en_digital: propinaEnDigital,
      coworking_session_id: coworkingSessionId ?? undefined,
      caja_id: cajaAbierta.id,
    };
    setSummary(ventaSummary);
  };

  const handleSuccess = () => {
    clear();
    setMetodoPago('efectivo');
    setTipoConsumo('sitio');
    setPropinaPct(0);
    setPropinaManual('');
    setPropinaEnDigital(false);
    setMixed({ efectivo: 0, tarjeta: 0, transferencia: 0 });
  };

  const showPropinaDigitalCheckbox =
    propina > 0 &&
    (metodoPago === 'tarjeta' ||
      metodoPago === 'efectivo' ||
      metodoPago === 'transferencia' ||
      (metodoPago === 'mixto' && mixed.tarjeta > 0));

  return (
    <div className="border border-border rounded-lg bg-card flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-heading font-bold text-lg flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" /> Ticket activo
        </h2>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleLimpiarClick} className="text-destructive hover:text-destructive">
            Limpiar
          </Button>
        )}
      </div>

      {clienteNombre && (
        <div className="px-4 py-2 bg-primary/5 border-b border-border text-xs">
          <Badge variant="outline" className="mr-2">Coworking</Badge>
          <span className="font-medium">{clienteNombre}</span>
        </div>
      )}

      {openAccountCount > 0 && (
        <TooltipProvider>
          <div className="px-4 py-1.5 bg-muted/40 border-b border-border text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            <span>{openAccountCount} línea{openAccountCount !== 1 ? 's' : ''} de cuenta abierta (no editables aquí)</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex"><Info className="h-3 w-3" /></button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Para modificar cantidades o eliminar consumos de la cuenta abierta usa Coworking → Administrar cuenta. Aquí solo se cobran.
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0 max-h-[40vh]">
        {items.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>El ticket está vacío</p>
            <p className="text-xs mt-1">Agrega productos desde POS o importa una sesión de coworking</p>
          </div>
        ) : (
          items.map((item) => {
            const readOnly = isReadOnlyLine(item);
            const esCoworkingCharge = item.tipo_concepto === 'coworking';
            const k = item.lineId ?? item.producto_id;
            const isBusy = incrementing === k;
            return (
              <div key={k} className={`flex items-center gap-2 text-sm border border-border rounded-md p-2 ${readOnly ? 'bg-muted/30' : ''}`}>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.nombre}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">${item.precio_unitario.toFixed(2)} c/u</p>
                    {readOnly && (
                      <Badge variant="secondary" className="text-[10px] px-1 h-4 gap-1">
                        <Lock className="h-2.5 w-2.5" />
                        {esCoworkingCharge ? 'Coworking' : 'Cuenta abierta'}
                      </Badge>
                    )}
                  </div>
                </div>
                {!readOnly ? (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(k, -1)} disabled={isBusy}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center text-xs">{item.cantidad}</span>
                    <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => handleIncrement(item)} disabled={isBusy}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground px-2">×{item.cantidad}</span>
                )}
                <span className="font-bold w-16 text-right">${item.subtotal.toFixed(2)}</span>
                {!readOnly && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItem(k)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      {items.length > 0 && (
        <div className="p-4 border-t border-border space-y-3">
          {/* Tipo consumo */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Consumo</Label>
              <Select value={tipoConsumo} onValueChange={(v) => setTipoConsumo(v as TipoConsumo)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sitio">En sitio</SelectItem>
                  <SelectItem value="para_llevar">Para llevar</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Método de pago</Label>
              <Select value={metodoPago} onValueChange={(v) => handleMetodoPagoChange(v as MetodoPago)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="mixto">Mixto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {metodoPago === 'mixto' && (
            <div className="space-y-2 p-2 rounded-md bg-muted/30 border border-border">
              <Label className="text-xs">Distribución (debe sumar ${total.toFixed(2)})</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['efectivo', 'tarjeta', 'transferencia'] as const).map((k) => (
                  <div key={k}>
                    <Label className="text-[10px] capitalize">{k}</Label>
                    <Input
                      type="number" min={0} step={0.01}
                      value={mixed[k] || ''}
                      onChange={(e) => setMixed({ ...mixed, [k]: parseFloat(e.target.value) || 0 })}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
              {!sumaMixtaCuadra && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Suma actual: ${sumaMixta.toFixed(2)}
                </p>
              )}
              {sumaMixtaCuadra && !mixtoTarjetaCubrePropina && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  El monto de tarjeta debe cubrir al menos la propina (${propina.toFixed(2)}).
                </p>
              )}
              {propinaEnDigital && propina > 0 && mixed.tarjeta > 0 && mixtoTarjetaCubrePropina && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    Se asumen ${propina.toFixed(2)} de propina dentro de tarjeta. La comisión se calcula sobre el resto (${Math.max(0, mixed.tarjeta - propina).toFixed(2)}).
                  </span>
                </p>
              )}
            </div>
          )}

          {/* Propina */}
          <div className="space-y-1">
            <Label className="text-xs">Propina</Label>
            <div className="grid grid-cols-4 gap-1">
              {([0, 10, 15] as const).map((p) => (
                <Button
                  key={p}
                  variant={propinaPct === p ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPropinaPct(p)}
                  className="h-8 text-xs"
                >
                  {p === 0 ? 'Sin' : `${p}%`}
                </Button>
              ))}
              <Button
                variant={propinaPct === 'manual' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPropinaPct('manual')}
                className="h-8 text-xs"
              >
                Manual
              </Button>
            </div>
            {propinaPct === 'manual' && (
              <Input
                type="number" min={0} step={0.01} placeholder="0.00"
                value={propinaManual}
                onChange={(e) => setPropinaManual(e.target.value)}
                className="h-8 text-sm mt-1"
              />
            )}
            {propinaExcedeSubtotal && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                <AlertCircle className="h-3 w-3" />
                La propina no puede exceder el subtotal del ticket.
              </p>
            )}
            {propinaInusual && (
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1 mt-1">
                <AlertTriangle className="h-3 w-3" />
                Propina inusualmente alta ({propinaPctSobreSubtotal.toFixed(0)}% del subtotal). Confirma con el cliente.
              </p>
            )}
            {showPropinaDigitalCheckbox && (
              <div className="flex items-center gap-2 mt-1">
                <Checkbox
                  id="propina-digital"
                  checked={propinaEnDigital}
                  onCheckedChange={(v) => setPropinaEnDigital(!!v)}
                />
                <Label htmlFor="propina-digital" className="text-xs cursor-pointer">
                  {metodoPago === 'mixto'
                    ? 'Propina incluida en el monto de tarjeta'
                    : metodoPago === 'tarjeta'
                    ? 'Propina cobrada por terminal (tarjeta)'
                    : 'Propina cobrada por método digital'}
                </Label>
              </div>
            )}
          </div>

          <Separator />

          {/* Totales */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
            </div>
            {propina > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Propina</span><span>${propina.toFixed(2)}</span>
              </div>
            )}
            {comision > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground italic">
                <span>Comisión bancaria ({config.comision_bancaria_porcentaje}%)</span>
                <span>${comision.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold pt-1">
              <span>Total</span>
              <span className="text-primary">${total.toFixed(2)}</span>
            </div>
          </div>

          {!cajaAbierta && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> La caja se cerró. Reabre una caja para cobrar.
            </p>
          )}

          <Button
            size="lg"
            className="w-full"
            onClick={handleCobrar}
            disabled={!mixtoValido || !cajaAbierta}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Cobrar ${total.toFixed(2)}
          </Button>
        </div>
      )}

      <ConfirmVentaDialog
        summary={summary}
        onClose={() => setSummary(null)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
