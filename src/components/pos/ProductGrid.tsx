import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCategorias } from '@/hooks/useCategorias';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImageIcon, LayoutGrid, Rows3, Package } from 'lucide-react';
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

const DENSITY_KEY = 'pos-grid-density';

export function ProductGrid({ onAdd }: Props) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const { categorias: categoriasDB } = useCategorias(['producto', 'paquete']);
  const [categoriaActiva, setCategoriaActiva] = useState('Todos');
  const [densidad, setDensidad] = useState<Densidad>(() => {
    if (typeof window === 'undefined') return 'compacto';
    return (localStorage.getItem(DENSITY_KEY) as Densidad) || 'compacto';
  });

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, densidad);
  }, [densidad]);

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

  const categoriasConProductos = categoriasDB.filter(cat =>
    productos.some(p => p.categoria === cat)
  );
  const allTabs = ['Todos', ...categoriasConProductos];

  // Si la categoría seleccionada desaparece (admin la borró), regresa a "Todos".
  useEffect(() => {
    if (!loading && !allTabs.includes(categoriaActiva)) {
      setCategoriaActiva('Todos');
    }
  }, [allTabs, categoriaActiva, loading]);

  const filtered = productos.filter(p =>
    categoriaActiva === 'Todos' || p.categoria === categoriaActiva
  );

  const isCompacto = densidad === 'compacto';

  const gridCols = isCompacto
    ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';

  return (
    <div className="flex flex-col h-full">
      {/* Barra sticky: categorías + toggle densidad */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-2 -mt-1 pt-1">
        <div className="flex items-start gap-2">
          <div className="flex-1 flex flex-wrap gap-1.5">
            {allTabs.map(cat => (
              <Badge
                key={cat}
                variant={categoriaActiva === cat ? 'default' : 'outline'}
                className="cursor-pointer select-none text-xs px-2 py-0.5"
                onClick={() => setCategoriaActiva(cat)}
              >
                {cat}
              </Badge>
            ))}
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
                  No hay productos en esta categoría
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
