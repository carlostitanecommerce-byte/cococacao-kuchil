import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface MermaRow {
  id: string;
  cantidad: number;
  motivo: string;
  fecha: string;
  usuario_id: string;
  insumo_id: string;
  insumos: { nombre: string; unidad_medida: string } | null;
  usuario_nombre?: string;
}

interface InsumoLite { id: string; nombre: string }

interface Props { isAdmin: boolean }

const PAGE_SIZE = 25;

const MermasTab = ({ isAdmin }: Props) => {
  const [mermas, setMermas] = useState<MermaRow[]>([]);
  const [insumosList, setInsumosList] = useState<InsumoLite[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros (M4)
  const [busqueda, setBusqueda] = useState('');
  const [insumoFiltro, setInsumoFiltro] = useState<string>('todos');
  const [fechaDesde, setFechaDesde] = useState<string>('');
  const [fechaHasta, setFechaHasta] = useState<string>('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    supabase.from('insumos').select('id, nombre').order('nombre')
      .then(({ data }) => setInsumosList((data as InsumoLite[]) ?? []));
  }, []);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      let query = supabase
        .from('mermas')
        .select('id, cantidad, motivo, fecha, usuario_id, insumo_id, insumos(nombre, unidad_medida)')
        .order('fecha', { ascending: false })
        .limit(500);

      if (insumoFiltro !== 'todos') query = query.eq('insumo_id', insumoFiltro);
      if (fechaDesde) query = query.gte('fecha', `${fechaDesde}T00:00:00-06:00`);
      if (fechaHasta) query = query.lte('fecha', `${fechaHasta}T23:59:59-06:00`);

      const { data: rawMermas } = await query;
      const rows = (rawMermas ?? []) as MermaRow[];

      const userIds = [...new Set(rows.map(r => r.usuario_id))];
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, nombre')
          .in('id', userIds);
        const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.nombre]));
        rows.forEach(r => { r.usuario_nombre = profileMap[r.usuario_id] ?? '—'; });
      }

      setMermas(rows);
      setPage(0);
      setLoading(false);
    };
    fetch();
  }, [insumoFiltro, fechaDesde, fechaHasta]);

  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return mermas;
    const term = busqueda.toLowerCase();
    return mermas.filter(m =>
      m.motivo.toLowerCase().includes(term) ||
      (m.insumos?.nombre ?? '').toLowerCase().includes(term) ||
      (m.usuario_nombre ?? '').toLowerCase().includes(term)
    );
  }, [mermas, busqueda]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const paginadas = filtradas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const limpiarFiltros = () => {
    setBusqueda('');
    setInsumoFiltro('todos');
    setFechaDesde('');
    setFechaHasta('');
    setPage(0);
  };

  const hayFiltros = busqueda || insumoFiltro !== 'todos' || fechaDesde || fechaHasta;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-heading font-semibold text-foreground">Historial de Mermas</h2>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Motivo, insumo, usuario…"
                  value={busqueda}
                  onChange={e => { setBusqueda(e.target.value); setPage(0); }}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Insumo</Label>
              <Select value={insumoFiltro} onValueChange={setInsumoFiltro}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="todos">Todos los insumos</SelectItem>
                  {insumosList.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
            </div>
          </div>
          {hayFiltros && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {filtradas.length} resultado(s){mermas.length === 500 && ' (mostrando últimos 500)'}
              </p>
              <Button variant="ghost" size="sm" onClick={limpiarFiltros} className="gap-1">
                <X className="h-3 w-3" /> Limpiar filtros
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Registrado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando...</TableCell></TableRow>
              ) : paginadas.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {hayFiltros ? 'Sin resultados con esos filtros' : 'Sin mermas registradas'}
                </TableCell></TableRow>
              ) : paginadas.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(m.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                  </TableCell>
                  <TableCell className="font-medium">{m.insumos?.nombre ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">
                    -{m.cantidad} {m.insumos?.unidad_medida}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{m.motivo}</TableCell>
                  <TableCell className="text-muted-foreground">{m.usuario_nombre ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Paginación */}
      {filtradas.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Página {page + 1} de {totalPages} · Mostrando {paginadas.length} de {filtradas.length}
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MermasTab;
