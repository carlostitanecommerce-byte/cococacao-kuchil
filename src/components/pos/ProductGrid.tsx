import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCategorias } from '@/hooks/useCategorias';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImageIcon, LayoutGrid, Rows3, Package, ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Producto {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number;
  precio_upsell_coworking: number | null;
  activo: boolean;
  tipo: 'simple' | 'paquete';
  imagen_url: string | null;
}

interface Props {
  onAdd: (producto: Producto) => void;
}

type Densidad = 'compacto' | 'comodo';
type Modo = 'producto' | 'paquete';

const DENSITY_KEY = 'pos-grid-density';
const MODE_KEY = 'pos-grid-mode';

export function ProductGrid({ onAdd }: Props) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const { categorias: categoriasProducto } = useCategorias('producto');
  const { categorias: categoriasPaquete } = useCategorias('paquete');
  const [modo, setModo] = useState<Modo>(() => {
    if (typeof window === 'undefined') return 'producto';
    return (localStorage.getItem(MODE_KEY) as Modo) || 'producto';
  });
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [densidad, setDensidad] = useState<Densidad>(() => {
    if (typeof window === 'undefined') return 'compacto';
    return (localStorage.getItem(DENSITY_KEY) as Densidad) || 'compacto';
  });

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, densidad);
  }, [densidad]);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, modo);
  }, [modo]);

  useEffect(() => {
    let cancelled = false;
    const fetchProductos = async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, categoria, precio_venta, precio_upsell_coworking, activo, tipo, imagen_url')
        .eq('activo', true)
        .order('nombre');
      if (cancelled) return;
      if (data) setProductos(data as Producto[]);
      setLoading(false);
    };
    fetchProductos();

    const channel = supabase
      .channel('pos-productos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => fetchProductos())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, []);

  const tipoActivo: 'simple' | 'paquete' = modo === 'producto' ? 'simple' : 'paquete';
  const categoriasDelModo = modo === 'producto' ? categoriasProducto : categoriasPaquete;

  const categoriasVisibles = categoriasDelModo.filter(cat =>
    productos.some(p => p.tipo === tipoActivo && p.categoria === cat)
  );

  // Si la categoría seleccionada desaparece del modo actual, limpiar.
  useEffect(() => {
    if (categoriaActiva && !categoriasVisibles.includes(categoriaActiva)) {
      setCategoriaActiva(null);
    }
  }, [categoriasVisibles, categoriaActiva]);

  const filtered = productos.filter(p =>
    p.tipo === tipoActivo && (categoriaActiva === null || p.categoria === categoriaActiva)
  );

  const isCompacto = densidad === 'compacto';

  const gridCols = isCompacto
    ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';

  const toggleModo = () => {
    setModo(m => (m === 'producto' ? 'paquete' : 'producto'));
    setCategoriaActiva(null);
  };

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeBadgeRef = useRef<HTMLSpanElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 1);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useLayoutEffect(() => {
    updateScrollState();
  }, [categoriasVisibles, updateScrollState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState]);

  useEffect(() => {
    if (categoriaActiva && activeBadgeRef.current) {
      activeBadgeRef.current.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    }
  }, [categoriaActiva]);

  const scrollByAmount = (dir: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Barra sticky: modo + categorías + toggle densidad */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-2 -mt-1 pt-1">
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
            onClick={toggleModo}
            title="Alternar entre Productos y Paquetes"
          >
            {modo === 'producto' ? 'Productos' : 'Paquetes'}
            <ArrowLeftRight className="h-3 w-3" />
          </Button>
          <div className="relative flex-1 min-w-0">
            <div
              ref={scrollRef}
              className="flex gap-1.5 overflow-x-auto no-scrollbar scroll-smooth snap-x"
            >
              {categoriasVisibles.map(cat => {
                const active = categoriaActiva === cat;
                return (
                  <Badge
                    key={cat}
                    data-cat={cat}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer select-none text-xs px-2 py-0.5 shrink-0 whitespace-nowrap snap-start"
                    onClick={() => setCategoriaActiva(prev => prev === cat ? null : cat)}
                  >
                    {cat}
                  </Badge>
                );
              })}
            </div>
            {canLeft && (
              <>
                <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Desplazar categorías a la izquierda"
                  onClick={() => scrollByAmount(-1)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full bg-background border border-border shadow-sm hover:bg-accent"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {canRight && (
              <>
                <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Desplazar categorías a la derecha"
                  onClick={() => scrollByAmount(1)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full bg-background border border-border shadow-sm hover:bg-accent"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            title={isCompacto ? 'Cambiar a vista cómoda' : 'Cambiar a vista compacta'}
            onClick={() => setDensidad(isCompacto ? 'comodo' : 'compacto')}
          >
            {isCompacto ? <LayoutGrid className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 mt-2">
        <div className={cn('grid gap-2', gridCols)}>
          {loading ? (
            Array.from({ length: isCompacto ? 12 : 8 }).map((_, idx) => (
              <div
                key={`sk-${idx}`}
                className="flex flex-col rounded-md border border-border bg-card overflow-hidden animate-pulse"
              >
                <div className={cn('w-full bg-muted', isCompacto ? 'h-14' : 'aspect-[5/3]')} />
                <div className="p-1.5">
                  <div className="h-3 w-3/4 bg-muted rounded" />
                </div>
              </div>
            ))
          ) : (
            <>
              {filtered.map(p => {
                const isPaquete = p.tipo === 'paquete';
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    title={p.nombre}
                    onClick={() => onAdd(p)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(p); } }}
                    className="group relative flex flex-col rounded-md border border-border bg-card overflow-hidden cursor-pointer transition hover:border-primary hover:shadow-md active:scale-[0.98]"
                  >
                    <div className={cn('relative w-full bg-muted', isCompacto ? 'h-14' : 'aspect-[5/3]')}>
                      {p.imagen_url ? (
                        <img
                          src={p.imagen_url}
                          alt={p.nombre}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-6 w-6 opacity-40" />
                        </div>
                      )}
                      {isPaquete && (
                        <Badge className="absolute top-1 left-1 text-[9px] px-1 py-0 h-4 bg-primary/90 text-primary-foreground border-0">
                          <Package className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                    </div>
                    <div className="px-1.5 py-1">
                      <span className={cn('block font-medium leading-tight line-clamp-2 min-h-[2.2em]', isCompacto ? 'text-[11px]' : 'text-sm')}>
                        {p.nombre}
                      </span>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="col-span-full text-center text-muted-foreground py-12">
                  {modo === 'producto' ? 'No hay productos en esta categoría' : 'No hay paquetes en esta categoría'}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
