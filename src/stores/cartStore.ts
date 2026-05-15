import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartItem } from '@/components/pos/types';

const keyOf = (i: CartItem) => i.lineId ?? i.producto_id;

const ensureLineId = (i: CartItem): CartItem =>
  i.lineId ? i : { ...i, lineId: i.producto_id };

interface CartState {
  items: CartItem[];
  coworkingSessionId: string | null;
  clienteNombre: string | null;
  ownerUserId: string | null;
  /** Mapa producto_id → precio especial proveniente de tarifa_upsells de la sesión activa. */
  tarifaUpsells: Record<string, number>;
  ensureOwner: (userId: string | null) => void;
  setItems: (items: CartItem[]) => void;
  addOrIncrementProduct: (item: CartItem) => void;
  addOrIncrementPaquete: (item: CartItem) => void;
  updateQty: (key: string, delta: number) => void;
  setQty: (key: string, qty: number) => void;
  updateNotas: (key: string, notas: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  importCoworkingSession: (items: CartItem[], sessionId: string, clienteNombre: string) => void;
  setActiveCoworkingSession: (sessionId: string | null, clienteNombre: string | null) => void;
  setTarifaUpsells: (map: Record<string, number>) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      coworkingSessionId: null,
      clienteNombre: null,
      ownerUserId: null,
      tarifaUpsells: {},
      ensureOwner: (userId) => {
        const current = get().ownerUserId;
        if (userId && current && current !== userId) {
          set({ items: [], coworkingSessionId: null, clienteNombre: null, tarifaUpsells: {}, ownerUserId: userId });
        } else if (userId && !current) {
          set({ ownerUserId: userId });
        } else if (!userId && current) {
          set({ items: [], coworkingSessionId: null, clienteNombre: null, tarifaUpsells: {}, ownerUserId: null });
        }
      },
      setItems: (items) => set({ items: items.map(ensureLineId) }),
      addOrIncrementProduct: (item) => {
        const items = get().items;
        const incoming = ensureLineId({ ...item, lineId: item.producto_id });
        const existing = items.find(
          (i) => i.producto_id === incoming.producto_id && i.tipo_concepto === 'producto'
        );
        if (existing) {
          set({
            items: items.map((i) =>
              i.producto_id === incoming.producto_id && i.tipo_concepto === 'producto'
                ? { ...i, cantidad: i.cantidad + 1, subtotal: (i.cantidad + 1) * i.precio_unitario }
                : i
            ),
          });
        } else {
          set({ items: [...items, incoming] });
        }
      },
      addOrIncrementPaquete: (item) => {
        const items = get().items;
        const isDinamico = !!item.opciones && item.opciones.length > 0;
        if (isDinamico) {
          const lineId = item.lineId ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `pq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          set({ items: [...items, { ...item, lineId }] });
          return;
        }
        const incoming = ensureLineId({ ...item, lineId: item.producto_id });
        const existing = items.find(
          (i) => i.producto_id === incoming.producto_id && i.tipo_concepto === 'paquete' && !i.opciones
        );
        if (existing) {
          set({
            items: items.map((i) =>
              i.producto_id === incoming.producto_id && i.tipo_concepto === 'paquete' && !i.opciones
                ? { ...i, cantidad: i.cantidad + 1, subtotal: (i.cantidad + 1) * i.precio_unitario }
                : i
            ),
          });
        } else {
          set({ items: [...items, incoming] });
        }
      },
      updateQty: (key, delta) =>
        set({
          items: get().items.map((i) => {
            if (keyOf(i) !== key) return i;
            const newQty = Math.max(1, i.cantidad + delta);
            return { ...i, cantidad: newQty, subtotal: newQty * i.precio_unitario };
          }),
        }),
      setQty: (key, qty) =>
        set({
          items: get().items.map((i) =>
            keyOf(i) === key ? { ...i, cantidad: qty, subtotal: qty * i.precio_unitario } : i
          ),
        }),
      updateNotas: (key, notas) =>
        set({
          items: get().items.map((i) =>
            keyOf(i) === key ? { ...i, notas: notas.trim() || undefined } : i
          ),
        }),
      removeItem: (key) =>
        set({ items: get().items.filter((i) => keyOf(i) !== key) }),
      clear: () => set({ items: [], coworkingSessionId: null, clienteNombre: null, tarifaUpsells: {} }),
      importCoworkingSession: (items, sessionId, clienteNombre) =>
        set({ items: items.map(ensureLineId), coworkingSessionId: sessionId, clienteNombre }),
      setActiveCoworkingSession: (sessionId, clienteNombre) =>
        set({ coworkingSessionId: sessionId, clienteNombre }),
      setTarifaUpsells: (map) => set({ tarifaUpsells: map }),
    }),
    {
      name: 'pos-cart',
      storage: createJSONStorage(() => sessionStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.items) {
          state.items = state.items.map(ensureLineId);
        }
      },
    }
  )
);
