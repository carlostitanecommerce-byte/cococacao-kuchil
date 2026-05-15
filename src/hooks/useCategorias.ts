import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CategoriaAmbito = 'insumo' | 'producto' | 'paquete';

export function useCategorias(ambito?: CategoriaAmbito | CategoriaAmbito[]) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const ambitoKey = Array.isArray(ambito) ? [...ambito].sort().join(',') : (ambito ?? '');

  const fetchCategorias = async () => {
    setLoading(true);
    let q = supabase.from('categorias_maestras').select('nombre').order('nombre');
    if (Array.isArray(ambito)) {
      if (ambito.length > 0) q = q.in('ambito', ambito);
    } else if (ambito) {
      q = q.eq('ambito', ambito);
    }
    const { data } = await q;
    const nombres = Array.from(new Set((data ?? []).map((c: any) => c.nombre as string)));
    setCategorias(nombres);
    setLoading(false);
  };

  useEffect(() => { fetchCategorias(); }, [ambitoKey]);

  return { categorias, loading, refetch: fetchCategorias };
}
