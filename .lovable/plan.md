## Objetivo

Extender el hook `useCoworkingData` para exponer las membresías vigentes en tiempo real, sin refetch manual, para que los componentes de coworking (check-in, reservaciones, futuras UIs) puedan consumirlas.

Nota: la tabla real es `coworking_membresias` (renombrada). El filtro por estado (`activa`, `pendiente_pago`) sustituye la semántica del sufijo `_activas`.

## 1. `src/components/coworking/types.ts`

Añadir la interfaz `Membresia`:

```ts
export interface Membresia {
  id: string;
  cliente_id: string;
  tarifa_id: string;
  area_id: string | null;
  usuario_id: string;
  fecha_inicio: string;   // DATE 'YYYY-MM-DD'
  fecha_fin: string;      // DATE
  estado: 'pendiente_pago' | 'activa' | 'vencida' | 'cancelada';
  horas_totales: number;
  horas_disponibles: number;
  notas: string | null;
  created_at: string;
  updated_at: string;
}
```

## 2. `src/components/coworking/useCoworkingData.ts`

- Importar `Membresia` de `./types`.
- Nuevo estado: `const [membresias, setMembresias] = useState<Membresia[]>([]);`.
- En `fetchData` agregar una cuarta consulta en paralelo (con `as any` en el arreglo de estados, igual patrón que `sessions`, para evitar el choque de tipos literales del cliente de Supabase):

  ```ts
  supabase
    .from('coworking_membresias')
    .select('*')
    .in('estado', ['activa', 'pendiente_pago'] as any)
    .order('fecha_fin', { ascending: true }),
  ```

  y `setMembresias((membresiasRes.data as unknown as Membresia[]) ?? []);`.

- Reutilizar el canal Realtime existente `coworking-all-changes` (evita abrir un canal nuevo y mantiene el cleanup ya existente en el `useEffect`):

  ```ts
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'coworking_membresias' },
      () => fetchData())
  ```

- Exponer `membresias` en el objeto retornado por el hook. Los consumidores actuales no rompen (solo se agrega una propiedad).

## 3. Habilitar Realtime en la tabla

Migración corta. `REPLICA IDENTITY FULL` es indispensable para que los eventos `UPDATE`/`DELETE` lleguen con la fila completa:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.coworking_membresias;
ALTER TABLE public.coworking_membresias REPLICA IDENTITY FULL;
```

## 4. Fuera de alcance

- No se cambia UI (check-in, reservaciones, nuevas tabs) — solo se expone el dato.
- No se toca RLS ni schema (ya definidos).
- No se define aún el paso `activa → vencida` (job posterior).

## 5. Verificación

- Build + tsgo pasan.
- Al abrir `/coworking`, `membresias` llega poblado con `estado ∈ {activa, pendiente_pago}`.
- Un `INSERT` / `UPDATE` / `DELETE` en `coworking_membresias` dispara refetch y actualiza el array sin recargar.
- Consumidores existentes de `useCoworkingData` siguen funcionando sin cambios.
