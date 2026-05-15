import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  ScrollText,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Filter,
  X,
  Download,
  Activity,
  XCircle,
  Users,
  TrendingUp,
} from 'lucide-react';
import { format, startOfDay, endOfDay, subDays, isAfter } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import * as XLSX from 'xlsx';

interface AuditLog {
  id: string;
  user_id: string;
  accion: string;
  descripcion: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user_nombre?: string;
}

interface ProfileLite {
  id: string;
  nombre: string;
}

const ACCION_LABELS: Record<string, string> = {
  inicio_sesion: 'Inicio de sesión',
  creacion_usuario: 'Creación de usuario',
  eliminacion_usuario: 'Eliminación de usuario',
  ajuste_inventario: 'Ajuste de inventario',
  apertura_caja: 'Apertura de caja',
  cierre_caja: 'Cierre de caja',
  entrada_caja: 'Entrada de caja',
  salida_caja: 'Salida de caja',
  venta_completada: 'Venta completada',
  cancelar_venta: 'Cancelación de venta',
  cambio_metodo_pago: 'Cambio de método de pago',
  compra_insumo: 'Compra de insumo',
  crear_insumo: 'Creación de insumo',
  actualizar_insumo: 'Actualización de insumo',
  crear_producto: 'Creación de producto',
  actualizar_producto: 'Actualización de producto',
  duplicar_producto: 'Duplicación de producto',
  promocion_producto: 'Promoción de producto',
  precio_especial_manual: 'Precio especial manual',
  crear_paquete: 'Creación de paquete',
  duplicar_paquete: 'Duplicación de paquete',
  eliminar_paquete: 'Eliminación de paquete',
  checkin_coworking: 'Check-in coworking',
  checkout_coworking: 'Check-out coworking',
  cancelar_sesion_coworking: 'Cancelación de sesión coworking',
  descuento_inventario_cancelacion_sesion: 'Descuento por cancelación',
  crear_reservacion: 'Creación de reservación',
  cancelar_reservacion: 'Cancelación de reservación',
  reagendar_reservacion: 'Reagendado de reservación',
  checkin_desde_reservacion: 'Check-in desde reservación',
  solicitar_cancelacion_item_sesion: 'Solicitud cancelación ítem (coworking)',
  resolver_cancelacion_item_sesion: 'Resolución cancelación ítem (coworking)',
  aprobar_cancelacion_sesion: 'Aprobación cancelación de sesión',
  reabrir_sesion_coworking: 'Reapertura sesión coworking',
  registrar_merma: 'Registro de merma',
};

const ACCION_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  cancelar_venta: 'destructive',
  cancelar_sesion_coworking: 'destructive',
  cancelar_reservacion: 'destructive',
  eliminacion_usuario: 'destructive',
  eliminar_paquete: 'destructive',
  inicio_sesion: 'secondary',
  apertura_caja: 'default',
  cierre_caja: 'default',
  venta_completada: 'default',
};

const PAGE_SIZE = 25;

const formatActionLabel = (accion: string) =>
  ACCION_LABELS[accion] ||
  accion
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');

interface BitacoraStats {
  total: number;
  cancelaciones: number;
  usuariosActivos: number;
  topAccion: { accion: string; count: number } | null;
}

const CANCEL_ACTIONS = [
  'cancelar_venta',
  'cancelar_sesion_coworking',
  'cancelar_reservacion',
  'eliminacion_usuario',
  'eliminar_paquete',
  'descuento_inventario_cancelacion_sesion',
  'resolver_cancelacion_item_sesion',
];

const BitacoraTab = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [acciones, setAcciones] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stats, setStats] = useState<BitacoraStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [page, setPage] = useState(0);
  const [fechaInicio, setFechaInicio] = useState<Date>(subDays(new Date(), 7));
  const [fechaFin, setFechaFin] = useState<Date>(new Date());
  const [usuarioId, setUsuarioId] = useState<string>('all');
  const [accionFilter, setAccionFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Cargar listas para los filtros (una sola vez)
  useEffect(() => {
    const controller = new AbortController();
    const loadFilterOptions = async () => {
      try {
        const [profsRes, accsRes] = await Promise.all([
          supabase.from('profiles').select('id, nombre').order('nombre'),
          supabase.from('audit_logs').select('accion'),
        ]);
        if (controller.signal.aborted) return;
        if (profsRes.error) throw profsRes.error;
        if (accsRes.error) throw accsRes.error;
        setProfiles(profsRes.data ?? []);
        const unique = Array.from(
          new Set((accsRes.data ?? []).map((a) => a.accion))
        ).sort();
        setAcciones(unique);
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('Error cargando filtros bitácora:', err);
          toast.error('No se pudieron cargar los filtros de la bitácora.');
        }
      }
    };
    loadFilterOptions();
    return () => controller.abort();
  }, []);

  const fetchLogs = useCallback(
    async (signal: AbortSignal) => {
      // Validación: rango invertido
      if (isAfter(startOfDay(fechaInicio), endOfDay(fechaFin))) {
        toast.error('El rango de fechas es inválido.', {
          description: 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".',
        });
        setLogs([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        let query = supabase
          .from('audit_logs')
          .select('*', { count: 'exact' })
          .gte('created_at', startOfDay(fechaInicio).toISOString())
          .lte('created_at', endOfDay(fechaFin).toISOString())
          .order('created_at', { ascending: false })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (usuarioId !== 'all') query = query.eq('user_id', usuarioId);
        if (accionFilter !== 'all') query = query.eq('accion', accionFilter);
        if (search.trim()) query = query.ilike('descripcion', `%${search.trim()}%`);

        const { data, count, error } = await query;
        if (signal.aborted) return;
        if (error) throw error;

        const userIds = [...new Set((data ?? []).map((l) => l.user_id))];
        let profileMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profs, error: profErr } = await supabase
            .from('profiles')
            .select('id, nombre')
            .in('id', userIds);
          if (signal.aborted) return;
          if (profErr) throw profErr;
          profileMap = new Map((profs ?? []).map((p) => [p.id, p.nombre]));
        }

        setLogs(
          (data ?? []).map((l) => ({
            ...l,
            metadata: l.metadata as Record<string, unknown> | null,
            user_nombre: profileMap.get(l.user_id) || 'Desconocido',
          }))
        );
        setTotalCount(count ?? 0);
      } catch (err) {
        if (!signal.aborted) {
          console.error('Error fetching audit logs:', err);
          const message =
            err instanceof Error ? err.message : 'Error desconocido';
          toast.error('No se pudieron cargar los registros.', {
            description: message,
          });
          setLogs([]);
          setTotalCount(0);
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [fechaInicio, fechaFin, usuarioId, accionFilter, search, page]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchLogs(controller.signal);
    return () => controller.abort();
  }, [fetchLogs]);

  // Stats agregadas (sobre el rango y filtros completos, no paginadas)
  const fetchStats = useCallback(
    async (signal: AbortSignal) => {
      if (isAfter(startOfDay(fechaInicio), endOfDay(fechaFin))) {
        setStats({ total: 0, cancelaciones: 0, usuariosActivos: 0, topAccion: null });
        setStatsLoading(false);
        return;
      }
      setStatsLoading(true);
      try {
        let query = supabase
          .from('audit_logs')
          .select('accion, user_id')
          .gte('created_at', startOfDay(fechaInicio).toISOString())
          .lte('created_at', endOfDay(fechaFin).toISOString());

        if (usuarioId !== 'all') query = query.eq('user_id', usuarioId);
        if (accionFilter !== 'all') query = query.eq('accion', accionFilter);
        if (search.trim()) query = query.ilike('descripcion', `%${search.trim()}%`);

        // Trae hasta 10k para agregaciones (suficiente para rangos típicos)
        const { data, error } = await query.limit(10000);
        if (signal.aborted) return;
        if (error) throw error;

        const rows = data ?? [];
        const accionCounts = new Map<string, number>();
        const usuarios = new Set<string>();
        let cancelaciones = 0;
        for (const r of rows) {
          accionCounts.set(r.accion, (accionCounts.get(r.accion) ?? 0) + 1);
          usuarios.add(r.user_id);
          if (CANCEL_ACTIONS.includes(r.accion)) cancelaciones++;
        }
        let topAccion: BitacoraStats['topAccion'] = null;
        for (const [accion, count] of accionCounts) {
          if (!topAccion || count > topAccion.count) topAccion = { accion, count };
        }
        setStats({
          total: rows.length,
          cancelaciones,
          usuariosActivos: usuarios.size,
          topAccion,
        });
      } catch (err) {
        if (!signal.aborted) {
          console.error('Error stats bitácora:', err);
          setStats(null);
        }
      } finally {
        if (!signal.aborted) setStatsLoading(false);
      }
    },
    [fechaInicio, fechaFin, usuarioId, accionFilter, search]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal);
    return () => controller.abort();
  }, [fetchStats]);

  // Reset page cuando cambian filtros
  useEffect(() => {
    setPage(0);
  }, [fechaInicio, fechaFin, usuarioId, accionFilter, search]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters =
    usuarioId !== 'all' || accionFilter !== 'all' || search.trim() !== '';

  const clearFilters = () => {
    setUsuarioId('all');
    setAccionFilter('all');
    setSearch('');
  };

  const setPreset = (days: number) => {
    setFechaInicio(subDays(new Date(), days));
    setFechaFin(new Date());
  };

  const accionesOptions = useMemo(
    () =>
      acciones.map((a) => ({
        value: a,
        label: formatActionLabel(a),
      })),
    [acciones]
  );

  const handleExport = async () => {
    if (isAfter(startOfDay(fechaInicio), endOfDay(fechaFin))) {
      toast.error('Rango de fechas inválido.');
      return;
    }
    setExporting(true);
    try {
      // Trae todo el rango filtrado en lotes de 1000 (límite Supabase)
      const BATCH = 1000;
      let from = 0;
      const all: AuditLog[] = [];
      while (true) {
        let q = supabase
          .from('audit_logs')
          .select('*')
          .gte('created_at', startOfDay(fechaInicio).toISOString())
          .lte('created_at', endOfDay(fechaFin).toISOString())
          .order('created_at', { ascending: false })
          .range(from, from + BATCH - 1);
        if (usuarioId !== 'all') q = q.eq('user_id', usuarioId);
        if (accionFilter !== 'all') q = q.eq('accion', accionFilter);
        if (search.trim()) q = q.ilike('descripcion', `%${search.trim()}%`);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(
          ...data.map((l) => ({
            ...l,
            metadata: l.metadata as Record<string, unknown> | null,
          }))
        );
        if (data.length < BATCH) break;
        from += BATCH;
        if (all.length >= 50000) break; // Safety cap
      }

      if (all.length === 0) {
        toast.warning('No hay registros para exportar con los filtros actuales.');
        setExporting(false);
        return;
      }

      // Mapa de nombres
      const userIds = [...new Set(all.map((l) => l.user_id))];
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, nombre')
        .in('id', userIds);
      const profileMap = new Map((profs ?? []).map((p) => [p.id, p.nombre]));

      // Agregaciones para Resumen
      const accionCounts = new Map<string, number>();
      const userCounts = new Map<string, number>();
      let cancelaciones = 0;
      for (const l of all) {
        accionCounts.set(l.accion, (accionCounts.get(l.accion) ?? 0) + 1);
        userCounts.set(l.user_id, (userCounts.get(l.user_id) ?? 0) + 1);
        if (CANCEL_ACTIONS.includes(l.accion)) cancelaciones++;
      }
      const accionesOrdenadas = [...accionCounts.entries()].sort((a, b) => b[1] - a[1]);
      const usuariosOrdenados = [...userCounts.entries()].sort((a, b) => b[1] - a[1]);

      const wb = XLSX.utils.book_new();

      // Sheet Resumen
      const resumenRows: (string | number)[][] = [
        ['Bitácora de Actividad — Resumen'],
        [],
        ['Rango', `${format(fechaInicio, 'dd/MM/yyyy')} – ${format(fechaFin, 'dd/MM/yyyy')}`],
        ['Generado', format(new Date(), "dd/MM/yyyy HH:mm:ss", { locale: es })],
        [],
        ['Total de eventos', all.length],
        ['Cancelaciones / Eliminaciones', cancelaciones],
        ['Usuarios activos', userCounts.size],
        [],
        ['Acción', 'Eventos'],
        ...accionesOrdenadas.map(([a, c]) => [formatActionLabel(a), c]),
        [],
        ['Usuario', 'Eventos'],
        ...usuariosOrdenados.map(([uid, c]) => [profileMap.get(uid) || 'Desconocido', c]),
      ];
      const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
      wsResumen['!cols'] = [{ wch: 38 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

      // Sheet Bitácora detallada
      const detalleRows = all.map((l) => ({
        'Fecha / Hora': format(new Date(l.created_at), 'dd/MM/yyyy HH:mm:ss', { locale: es }),
        Usuario: profileMap.get(l.user_id) || 'Desconocido',
        Acción: formatActionLabel(l.accion),
        'Acción (clave)': l.accion,
        Descripción: l.descripcion ?? '',
        Detalles: l.metadata ? JSON.stringify(l.metadata) : '',
      }));
      const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
      wsDetalle['!cols'] = [
        { wch: 20 },
        { wch: 22 },
        { wch: 28 },
        { wch: 22 },
        { wch: 60 },
        { wch: 50 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetalle, 'Bitácora');

      const suffix = `${format(fechaInicio, 'yyyyMMdd')}_${format(fechaFin, 'yyyyMMdd')}`;
      XLSX.writeFile(wb, `Bitacora_CocoCacao_${suffix}.xlsx`);
      toast.success(`Bitácora exportada (${all.length.toLocaleString('es-MX')} registros).`);
    } catch (err) {
      console.error('Error exportando bitácora:', err);
      toast.error('No se pudo exportar la bitácora.', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Activity} label="Total de eventos" value={stats?.total ?? 0} loading={statsLoading} />
        <KpiCard icon={XCircle} label="Cancelaciones" value={stats?.cancelaciones ?? 0} loading={statsLoading} tone="destructive" />
        <KpiCard icon={Users} label="Usuarios activos" value={stats?.usuariosActivos ?? 0} loading={statsLoading} />
        <KpiCard
          icon={TrendingUp}
          label="Acción más frecuente"
          value={stats?.topAccion ? formatActionLabel(stats.topAccion.accion) : '—'}
          subValue={stats?.topAccion ? `${stats.topAccion.count} eventos` : undefined}
          loading={statsLoading}
          isText
        />
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-lg flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Bitácora de Actividad
          </CardTitle>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || loading}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exportando...' : 'Exportar Excel'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
        {/* Filtros */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Desde</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(fechaInicio, 'dd MMM yyyy', { locale: es })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={fechaInicio}
                  onSelect={(d) => d && setFechaInicio(d)}
                  initialFocus
                  className={cn('p-3 pointer-events-auto')}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Hasta</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(fechaFin, 'dd MMM yyyy', { locale: es })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={fechaFin}
                  onSelect={(d) => d && setFechaFin(d)}
                  initialFocus
                  className={cn('p-3 pointer-events-auto')}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Usuario</Label>
            <Select value={usuarioId} onValueChange={setUsuarioId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los usuarios</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre || 'Sin nombre'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Acción</Label>
            <Select value={accionFilter} onValueChange={setAccionFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las acciones</SelectItem>
                {accionesOptions.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar en descripción..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPreset(0)}>
              Hoy
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPreset(7)}>
              7 días
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPreset(30)}>
              30 días
            </Button>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Limpiar
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            {totalCount.toLocaleString('es-MX')} registros
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto rounded-md border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Fecha / Hora</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Descripción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-full max-w-md" /></TableCell>
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No hay registros que coincidan con los filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  const isOpen = expandedId === log.id;
                  const hasMeta =
                    log.metadata && Object.keys(log.metadata).length > 0;
                  return (
                    <Fragment key={log.id}>
                      <TableRow
                        className={cn(
                          'cursor-pointer hover:bg-muted/40',
                          isOpen && 'bg-muted/30'
                        )}
                        onClick={() => setExpandedId(isOpen ? null : log.id)}
                      >
                        <TableCell>
                          {hasMeta ? (
                            isOpen ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                          {format(new Date(log.created_at), 'dd/MM/yy HH:mm:ss', {
                            locale: es,
                          })}
                        </TableCell>
                        <TableCell className="font-medium">{log.user_nombre}</TableCell>
                        <TableCell>
                          <Badge
                            variant={ACCION_VARIANTS[log.accion] || 'outline'}
                            className="text-xs"
                          >
                            {formatActionLabel(log.accion)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                          {log.descripcion || '—'}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell />
                          <TableCell colSpan={4} className="py-3">
                            <div className="space-y-2">
                              {log.descripcion && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                                    Descripción completa
                                  </p>
                                  <p className="text-sm">{log.descripcion}</p>
                                </div>
                              )}
                              {hasMeta && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                                    Detalles
                                  </p>
                                  <pre className="text-xs bg-background border border-border/60 rounded p-3 overflow-x-auto font-mono">
                                    {JSON.stringify(log.metadata, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Paginación */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              Página {page + 1} de {totalPages} · Mostrando{' '}
              {Math.min(page * PAGE_SIZE + 1, totalCount)}–
              {Math.min((page + 1) * PAGE_SIZE, totalCount)} de{' '}
              {totalCount.toLocaleString('es-MX')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1 || loading}
              >
                Siguiente
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
};

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  subValue?: string;
  loading?: boolean;
  tone?: 'default' | 'destructive';
  isText?: boolean;
}

const KpiCard = ({ icon: Icon, label, value, subValue, loading, tone = 'default', isText }: KpiCardProps) => {
  const valueClass = cn(
    'font-bold tabular-nums break-words',
    isText ? 'text-base sm:text-lg' : 'text-xl sm:text-2xl',
    tone === 'destructive' && 'text-destructive'
  );
  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-4 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground truncate">{label}</p>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <>
            <p className={valueClass}>
              {typeof value === 'number' ? value.toLocaleString('es-MX') : value}
            </p>
            {subValue && (
              <p className="text-xs text-muted-foreground tabular-nums">{subValue}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default BitacoraTab;
