import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataPagination } from '@/components/ui/data-pagination';
import { Loader2, Package, RefreshCw, Search, XCircle } from 'lucide-react';
import type { Area, Membresia } from './types';

interface Props {
  membresias: Membresia[];
  areas: Area[];
  onSuccess: () => void | Promise<void>;
  onRenew: (m: Membresia) => void;
}

type EstadoFiltro = 'todos' | 'activa' | 'pendiente_pago' | 'vencida';

const PAGE_SIZE_DEFAULT = 20;

const formatDate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const tipoCobroLabel = (t?: string) => {
  if (t === 'mes') return 'Mensual';
  if (t === 'paquete_horas') return 'Paquete de horas';
  return t ?? '—';
};

interface MembresiaFull extends Membresia {
  cliente_nombre?: string;
  tarifa_nombre?: string;
  tarifa_tipo?: string;
}

const FILTROS: { value: EstadoFiltro; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'activa', label: 'Activas' },
  { value: 'pendiente_pago', label: 'Pendientes de Pago' },
  { value: 'vencida', label: 'Vencidas' },
];

export function MembresiasDashboardTab({ areas, onSuccess, onRenew }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<MembresiaFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('todos');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  const [toCancel, setToCancel] = useState<MembresiaFull | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchAll = async () => {
    const { data, error } = await supabase
      .from('coworking_membresias' as any)
      .select('*, clientes(nombre_completo), tarifas_coworking(nombre, tipo_cobro)')
      .order('fecha_fin', { ascending: false });
    if (error) {
      toast.error('No se pudieron cargar las membresías', { description: error.message });
      setRows([]);
    } else {
      setRows(((data ?? []) as any[]).map((m) => ({
        ...m,
        cliente_nombre: m.clientes?.nombre_completo,
        tarifa_nombre: m.tarifas_coworking?.nombre,
        tarifa_tipo: m.tarifas_coworking?.tipo_cobro,
      })) as MembresiaFull[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('membresias-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coworking_membresias' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const areaMap = useMemo(() => {
    const m = new Map<string, Area>();
    areas.forEach((a) => m.set(a.id, a));
    return m;
  }, [areas]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((m) => {
      if (estadoFiltro !== 'todos' && m.estado !== estadoFiltro) return false;
      if (q && !(m.cliente_nombre ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, estadoFiltro, query]);

  useEffect(() => { setPage(1); }, [query, estadoFiltro, pageSize]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const renderEstadoBadge = (estado: string) => {
    switch (estado) {
      case 'activa':
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 hover:bg-emerald-500/20">
            Activa
          </Badge>
        );
      case 'pendiente_pago':
        return (
          <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30 hover:bg-amber-500/20">
            Pendiente de pago
          </Badge>
        );
      case 'vencida':
        return <Badge variant="destructive">Vencida</Badge>;
      case 'cancelada':
        return <Badge variant="secondary">Cancelada</Badge>;
      default:
        return <Badge variant="outline">{estado}</Badge>;
    }
  };

  const handleCancel = async () => {
    if (!toCancel) return;
    setCancelling(true);
    const { error } = await supabase
      .from('coworking_membresias' as any)
      .update({ estado: 'cancelada' })
      .eq('id', toCancel.id);
    if (error) {
      setCancelling(false);
      toast.error('No se pudo cancelar la membresía', { description: error.message });
      return;
    }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'cancelar_membresia_coworking',
        descripcion: `Cancelación membresía · ${toCancel.cliente_nombre ?? toCancel.cliente_id}`,
        metadata: {
          membresia_id: toCancel.id,
          cliente_id: toCancel.cliente_id,
          tarifa_id: toCancel.tarifa_id,
        },
      });
    }
    setCancelling(false);
    setToCancel(null);
    toast.success('Membresía cancelada');
    await fetchAll();
    await onSuccess();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-heading font-bold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Membresías
          </h2>
          <p className="text-sm text-muted-foreground">
            Administra contratos mensuales y paquetes de horas.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente"
            className="pl-8 w-64"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={estadoFiltro === f.value ? 'default' : 'outline'}
            onClick={() => setEstadoFiltro(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Tarifa</TableHead>
              <TableHead>Área</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Horas</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right w-32">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando...
                </TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {query.trim()
                    ? `Sin resultados para "${query.trim()}"`
                    : 'Sin membresías registradas'}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((m) => {
                const area = m.area_id ? areaMap.get(m.area_id) : null;
                const isPaquete = m.tarifa_tipo === 'paquete_horas';
                const canCancel = m.estado === 'activa' || m.estado === 'pendiente_pago';
                const canRenew = m.estado !== 'cancelada';
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.cliente_nombre ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{m.tarifa_nombre ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {tipoCobroLabel(m.tarifa_tipo)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {area?.nombre_area ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(m.fecha_inicio)} → {formatDate(m.fecha_fin)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {isPaquete
                        ? `${Number(m.horas_disponibles ?? 0)} / ${Number(m.horas_totales ?? 0)} h`
                        : '—'}
                    </TableCell>
                    <TableCell>{renderEstadoBadge(m.estado)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={!canRenew}
                          onClick={() => onRenew(m)}
                          title="Renovar"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        {canCancel && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive disabled:opacity-50"
                            onClick={() => setToCancel(m)}
                            title={m.estado === 'pendiente_pago' ? 'Membresía en Caja. Cancela la orden desde el Punto de Venta.' : 'Cancelar'}
                            disabled={m.estado === 'pendiente_pago'}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <DataPagination
        paginaActual={page}
        totalItems={filtered.length}
        porPagina={pageSize}
        onPaginaChange={setPage}
        onPorPaginaChange={setPageSize}
        etiqueta="membresías"
        opcionesPorPagina={[10, 20, 50, 100]}
      />

      <AlertDialog open={!!toCancel} onOpenChange={(o) => !o && setToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar membresía</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Cancelar la membresía de <strong>{toCancel?.cliente_nombre ?? 'este cliente'}</strong>?
              Esta acción marca la membresía como cancelada y libera el espacio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleCancel(); }}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Cancelar membresía
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
