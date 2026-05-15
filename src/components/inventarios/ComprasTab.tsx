import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Search, Package, Ban } from 'lucide-react';

interface Insumo {
  id: string;
  nombre: string;
  unidad_medida: string;
  presentacion: string;
  costo_presentacion: number;
  cantidad_por_presentacion: number;
  stock_actual: number;
}

interface CompraRow {
  id: string;
  insumo_id: string;
  cantidad_presentaciones: number;
  cantidad_unidades: number;
  costo_total: number;
  costo_presentacion: number;
  nota: string | null;
  usuario_id: string;
  fecha: string;
  anulada?: boolean;
  motivo_anulacion?: string | null;
  anulada_at?: string | null;
  insumo_nombre?: string;
  usuario_nombre?: string;
}

interface Props {
  isAdmin: boolean;
}

const PAGE_SIZE = 50;

const ComprasTab = ({ isAdmin }: Props) => {
  const { user } = useAuth();
  const [compras, setCompras] = useState<CompraRow[]>([]);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Form state
  const [selectedInsumoId, setSelectedInsumoId] = useState('');
  const [cantidadPresentaciones, setCantidadPresentaciones] = useState('');
  const [costoPresentacion, setCostoPresentacion] = useState('');
  const [nota, setNota] = useState('');
  const [actualizarCosto, setActualizarCosto] = useState(false);

  // M6: anular compra
  const [anularTarget, setAnularTarget] = useState<CompraRow | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [anulando, setAnulando] = useState(false);

  const handleAnular = async () => {
    if (!anularTarget) return;
    if (!motivoAnular.trim()) { toast.error('El motivo es obligatorio'); return; }
    setAnulando(true);
    const { error } = await supabase.rpc('anular_compra_insumo', {
      p_compra_id: anularTarget.id,
      p_motivo: motivoAnular.trim(),
    });
    setAnulando(false);
    if (error) {
      toast.error(error.message || 'No se pudo anular la compra');
      return;
    }
    toast.success('Compra anulada');
    setAnularTarget(null);
    setMotivoAnular('');
    fetchData();
  };

  const selectedInsumo = useMemo(
    () => insumos.find((i) => i.id === selectedInsumoId),
    [insumos, selectedInsumoId]
  );

  const cantidadNum = parseFloat(cantidadPresentaciones) || 0;
  const costoNum = parseFloat(costoPresentacion) || 0;
  const totalUnidades = selectedInsumo ? cantidadNum * selectedInsumo.cantidad_por_presentacion : 0;
  const costoTotal = cantidadNum * costoNum;

  const fetchData = async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let comprasQuery = supabase
      .from('compras_insumos')
      .select('*', { count: 'exact' })
      .order('fecha', { ascending: false })
      .range(from, to);

    if (fechaDesde) {
      comprasQuery = comprasQuery.gte('fecha', `${fechaDesde}T00:00:00-06:00`);
    }
    if (fechaHasta) {
      comprasQuery = comprasQuery.lte('fecha', `${fechaHasta}T23:59:59-06:00`);
    }

    const [insumosRes, comprasRes] = await Promise.all([
      supabase.from('insumos').select('id, nombre, unidad_medida, presentacion, costo_presentacion, cantidad_por_presentacion, stock_actual').order('nombre'),
      comprasQuery,
    ]);

    if (insumosRes.data) setInsumos(insumosRes.data);
    setTotalCount(comprasRes.count ?? 0);

    if (comprasRes.data && insumosRes.data) {
      const insumoMap = new Map(insumosRes.data.map((i) => [i.id, i.nombre]));
      const userIds = [...new Set(comprasRes.data.map((c) => c.usuario_id))];
      
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, nombre')
          .in('id', userIds);
        if (profiles) {
          profileMap = new Map(profiles.map((p) => [p.id, p.nombre]));
        }
      }

      setCompras(
        comprasRes.data.map((c) => ({
          ...c,
          insumo_nombre: insumoMap.get(c.insumo_id) || 'Desconocido',
          usuario_nombre: profileMap.get(c.usuario_id) || 'Desconocido',
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fechaDesde, fechaHasta]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const resetForm = () => {
    setSelectedInsumoId('');
    setCantidadPresentaciones('');
    setCostoPresentacion('');
    setNota('');
    setActualizarCosto(false);
  };

  const handleInsumoChange = (id: string) => {
    setSelectedInsumoId(id);
    const ins = insumos.find((i) => i.id === id);
    if (ins) {
      setCostoPresentacion(String(ins.costo_presentacion));
    }
  };

  const handleSave = async () => {
    if (!selectedInsumoId || cantidadNum <= 0 || costoNum <= 0 || !user) {
      toast.error('Completa todos los campos requeridos');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('compras_insumos').insert({
        insumo_id: selectedInsumoId,
        cantidad_presentaciones: cantidadNum,
        cantidad_unidades: totalUnidades,
        costo_total: costoTotal,
        costo_presentacion: costoNum,
        nota: nota || null,
        usuario_id: user.id,
      });

      if (error) throw error;

      // Opcionalmente actualizar costo de presentación del insumo
      if (actualizarCosto && selectedInsumo) {
        const nuevoCostoUnitario = costoNum / selectedInsumo.cantidad_por_presentacion;
        const { error: updateErr } = await supabase
          .from('insumos')
          .update({
            costo_presentacion: costoNum,
            costo_unitario: nuevoCostoUnitario,
          })
          .eq('id', selectedInsumoId);
        if (updateErr) throw updateErr;
      }

      // Audit log
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'compra_insumo',
        descripcion: `Compra de ${cantidadNum} ${selectedInsumo?.presentacion || ''} de ${selectedInsumo?.nombre || ''} por $${costoTotal.toFixed(2)}`,
        metadata: {
          insumo_id: selectedInsumoId,
          cantidad_presentaciones: cantidadNum,
          cantidad_unidades: totalUnidades,
          costo_total: costoTotal,
        },
      });

      toast.success('Compra registrada correctamente');
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Error al registrar compra');
    } finally {
      setSaving(false);
    }
  };

  const comprasFiltradas = useMemo(() => {
    if (!busqueda) return compras;
    const q = busqueda.toLowerCase();
    return compras.filter(
      (c) =>
        c.insumo_nombre?.toLowerCase().includes(q) ||
        c.nota?.toLowerCase().includes(q)
    );
  }, [compras, busqueda]);

  const fmtMoney = (v: number) =>
    v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por insumo..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          <Input
            type="date"
            value={fechaDesde}
            onChange={(e) => { setPage(0); setFechaDesde(e.target.value); }}
            className="w-full sm:w-40"
            title="Desde"
          />
          <Input
            type="date"
            value={fechaHasta}
            onChange={(e) => { setPage(0); setFechaHasta(e.target.value); }}
            className="w-full sm:w-40"
            title="Hasta"
          />
          {(fechaDesde || fechaHasta) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPage(0); setFechaDesde(''); setFechaHasta(''); }}
            >
              Limpiar
            </Button>
          )}
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Registrar Compra
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Historial de Compras
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({totalCount} registro{totalCount !== 1 ? 's' : ''})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Cargando...</p>
          ) : comprasFiltradas.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {busqueda ? 'Sin resultados para la búsqueda' : 'No hay compras registradas'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Presentaciones</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Costo Total</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>Registrado por</TableHead>
                  {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {comprasFiltradas.map((c) => (
                  <TableRow key={c.id} className={c.anulada ? 'opacity-60' : ''}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>
                          {new Date(c.fecha).toLocaleString('es-MX', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {c.anulada && (
                          <span className="text-xs font-semibold text-destructive uppercase">Anulada</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={`font-medium ${c.anulada ? 'line-through' : ''}`}>{c.insumo_nombre}</TableCell>
                    <TableCell className="text-right">{c.cantidad_presentaciones}</TableCell>
                    <TableCell className="text-right">{c.cantidad_unidades}</TableCell>
                    <TableCell className="text-right">{fmtMoney(c.costo_total)}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={c.anulada ? `Anulada: ${c.motivo_anulacion ?? ''}` : (c.nota ?? '')}>
                      {c.anulada ? (
                        <span className="text-destructive">Anulada — {c.motivo_anulacion || 'sin motivo'}</span>
                      ) : (c.nota || '—')}
                    </TableCell>
                    <TableCell>{c.usuario_nombre}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {!c.anulada && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive gap-1"
                            onClick={() => { setAnularTarget(c); setMotivoAnular(''); }}
                            title="Anular compra (revierte stock)"
                          >
                            <Ban className="h-3.5 w-3.5" /> Anular
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* Dialog Registrar Compra */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Compra de Insumo</DialogTitle>
            <DialogDescription>Selecciona el insumo y la cantidad comprada</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Insumo</Label>
              <Select value={selectedInsumoId} onValueChange={handleInsumoChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar insumo..." />
                </SelectTrigger>
                <SelectContent>
                  {insumos.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedInsumo && (
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Presentación:</span> {selectedInsumo.presentacion} ({selectedInsumo.cantidad_por_presentacion} {selectedInsumo.unidad_medida})</p>
                <p><span className="text-muted-foreground">Costo actual:</span> {fmtMoney(selectedInsumo.costo_presentacion)} / {selectedInsumo.presentacion}</p>
                <p><span className="text-muted-foreground">Stock actual:</span> {selectedInsumo.stock_actual} {selectedInsumo.unidad_medida}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cantidad de presentaciones</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={cantidadPresentaciones}
                  onChange={(e) => setCantidadPresentaciones(e.target.value)}
                  placeholder="Ej: 3"
                />
              </div>
              <div className="space-y-2">
                <Label>Costo por presentación</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costoPresentacion}
                  onChange={(e) => setCostoPresentacion(e.target.value)}
                  placeholder="$0.00"
                />
              </div>
            </div>

            {selectedInsumo && cantidadNum > 0 && (
              <div className="rounded-md bg-primary/10 p-3 text-sm space-y-1">
                <p className="font-medium">Resumen:</p>
                <p>+ {totalUnidades} {selectedInsumo.unidad_medida} al stock</p>
                <p className="font-semibold">Total: {fmtMoney(costoTotal)}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Nota (opcional)</Label>
              <Textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Proveedor, factura, observaciones..."
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="actualizar-costo"
                checked={actualizarCosto}
                onCheckedChange={(v) => setActualizarCosto(v === true)}
              />
              <label htmlFor="actualizar-costo" className="text-sm cursor-pointer">
                Actualizar costo de presentación del insumo
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !selectedInsumoId || cantidadNum <= 0}>
              {saving ? 'Guardando...' : 'Registrar Compra'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* M6: AlertDialog para anular compra */}
      <AlertDialog open={!!anularTarget} onOpenChange={(o) => { if (!o) { setAnularTarget(null); setMotivoAnular(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular compra</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Se descontarán <strong>{anularTarget?.cantidad_unidades}</strong> unidades de{' '}
                  <strong>"{anularTarget?.insumo_nombre}"</strong> del stock actual. La compra quedará marcada como{' '}
                  <strong>anulada</strong> en el historial (no se elimina, para conservar la traza).
                  Si el insumo ya fue consumido, el sistema bloqueará la operación.
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Motivo de la anulación *</Label>
                  <Textarea
                    rows={2}
                    value={motivoAnular}
                    onChange={(e) => setMotivoAnular(e.target.value)}
                    placeholder="Ej. Captura duplicada, costo erróneo, devolución a proveedor…"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anulando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleAnular(); }}
              disabled={anulando || !motivoAnular.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {anulando ? 'Anulando…' : 'Anular compra'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ComprasTab;
