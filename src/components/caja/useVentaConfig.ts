import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { VentaConfig } from '@/components/pos/types';

export function useVentaConfig() {
  const [config, setConfig] = useState<VentaConfig>({ iva_porcentaje: 16, comision_bancaria_porcentaje: 3.5 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from('configuracion_ventas').select('clave, valor');
      if (data) {
        const map: Record<string, number> = {};
        data.forEach(r => { map[r.clave] = Number(r.valor); });
        setConfig({
          iva_porcentaje: map['iva_porcentaje'] ?? 16,
          comision_bancaria_porcentaje: map['comision_bancaria_porcentaje'] ?? 3.5,
        });
      }
      setLoading(false);
    };
    fetch();
  }, []);

  return { config, loading };
}
