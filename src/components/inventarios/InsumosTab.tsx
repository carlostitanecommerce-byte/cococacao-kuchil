import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCategorias } from '@/hooks/useCategorias';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, PackagePlus, Pencil, Trash2, ShieldAlert, Search, Copy, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import MermaDialog from './MermaDialog';
import { DataPagination } from '@/components/ui/data-pagination';

interface Insumo {
  id: string;
  nombre: string;
  unidad_medida: string;
  stock_actual: number;
  stock_minimo: number;
  costo_unitario: number;
  presentacion: string;
  costo_presentacion: number;
  cantidad_por_presentacion: number;
  categoria: string;
}

const PRESENTACIONES = ['Bolsa', 'Saco', 'Caja', 'Frasco', 'Botella', 'Galón', 'Unidad', 'Cubeta'];

const emptyForm = {
  nombre: '',
  unidad_medida: 'gr',
  stock_actual: '',
  stock_minimo: '',
  costo_presentacion: '',
  cantidad_por_presentacion: '',
  presentacion: 'Bolsa',
  categoria: 'Otros',
};

interface Props { isAdmin: boolean }

const InsumosTab = ({ isAdmin }: Props) => {
  const { user } = useAuth();
  const { categorias: CATEGORIAS_INSUMO } = useCategorias('insumo');
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mermaDialogOpen, setMermaDialogOpen] = useState(false);
  const [selectedInsumo, setSelectedInsumo] = useState<Insumo | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Insumo | null>(null);
  // Ajuste manual de stock requiere motivo (RPC ajustar_stock_insumo)
  const [stockMotivoOpen, setStockMotivoOpen] = useState(false);
  const [stockMotivo, setStockMotivo] = useState('');
  const [pendingStockChange, setPendingStockChange] = useState<{
    insumoId: string;
    nombre: string;
    stockPrev: number;
    stockNuevo: number;
    payloadRestante: Record<string, any>;
  } | null>(null);

  // Filtros
  const [busqueda, setBusqueda] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('Todas');
  const [soloStockBajo, setSoloStockBajo] = useState(false);

  const fetchInsumos = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('insumos').select('*').order('nombre');
      if (error) throw error;
      setInsumos((data as Insumo[]) ?? []);
    } catch (err: any) {
      toast.error('No se pudieron cargar los insumos: ' + (err?.message || 'error desconocido'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInsumos(); }, []);

  // M5: Realtime — refresca al detectar cambios externos (compras, mermas, ediciones de otros usuarios)
  useEffect(() => {
    const channel = supabase
      .channel('inv-insumos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insumos' }, () => {
        fetchInsumos();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const calcCostoUnitario = (costoPres: string, cantPres: string) => {
    const c = parseFloat(costoPres) || 0;
    const q = parseFloat(cantPres) || 0;
    return q > 0 ? c / q : 0;
  };

  const costoUnitarioCalculado = calcCostoUnitario(form.costo_presentacion, form.cantidad_por_presentacion);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (insumo: Insumo) => {
    setEditingId(insumo.id);
    setForm({
      nombre: insumo.nombre,
      unidad_medida: insumo.unidad_medida,
      stock_actual: String(insumo.stock_actual),
      stock_minimo: String(insumo.stock_minimo),
      costo_presentacion: String(insumo.costo_presentacion),
      cantidad_por_presentacion: String(insumo.cantidad_por_presentacion),
      presentacion: insumo.presentacion,
      categoria: insumo.categoria,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSaving(true);
    // Nota: costo_unitario se calcula automáticamente en el trigger BEFORE UPDATE
    // y stock_actual NO se incluye en updates (se canaliza vía RPC ajustar_stock_insumo).
    const stockNuevo = parseFloat(form.stock_actual) || 0;
    const payloadBase = {
      nombre: form.nombre.trim(),
      unidad_medida: form.unidad_medida,
      stock_minimo: parseFloat(form.stock_minimo) || 0,
      presentacion: form.presentacion,
      costo_presentacion: parseFloat(form.costo_presentacion) || 0,
      cantidad_por_presentacion: parseFloat(form.cantidad_por_presentacion) || 1,
      categoria: form.categoria,
    };

    if (editingId) {
      const previo = insumos.find(i => i.id === editingId);
      const stockCambio = previo && previo.stock_actual !== stockNuevo;

      // Si cambió el stock, interceptar con diálogo de motivo (RPC requiere motivo)
      if (stockCambio && previo) {
        setSaving(false);
        setPendingStockChange({
          insumoId: editingId,
          nombre: payloadBase.nombre,
          stockPrev: previo.stock_actual,
          stockNuevo,
          payloadRestante: payloadBase,
        });
        setStockMotivo('');
        setStockMotivoOpen(true);
        return;
      }

      // Sin cambio de stock: update directo (sin stock_actual ni costo_unitario)
      const { error } = await supabase.from('insumos').update(payloadBase).eq('id', editingId);
      if (error) {
        if (error.code === '23505' || /unique/i.test(error.message)) {
          toast.error(`Ya existe un insumo con el nombre "${payloadBase.nombre}"`);
        } else {
          toast.error('Error al actualizar insumo');
        }
      } else {
        toast.success('Insumo actualizado');
        await supabase.from('audit_logs').insert({
          user_id: user!.id,
          accion: 'actualizar_insumo',
          descripcion: `Insumo actualizado: ${payloadBase.nombre}`,
          metadata: { insumo_id: editingId, ...payloadBase },
        });
      }
    } else {
      // INSERT: el trigger BEFORE UPDATE no aplica, stock_actual permitido
      const payloadInsert = { ...payloadBase, stock_actual: stockNuevo };
      const { error } = await supabase.from('insumos').insert(payloadInsert);
      if (error) {
        if (error.code === '23505' || /unique/i.test(error.message)) {
          toast.error(`Ya existe un insumo con el nombre "${payloadInsert.nombre}"`);
        } else {
          toast.error('Error al crear insumo');
        }
      } else {
        toast.success('Insumo creado');
        await supabase.from('audit_logs').insert({
          user_id: user!.id,
          accion: 'crear_insumo',
          descripcion: `Insumo creado: ${payloadInsert.nombre}`,
          metadata: { ...payloadInsert },
        });
      }
    }
    setSaving(false);
    setDialogOpen(false);
    fetchInsumos();
  };

  const confirmStockMotivo = async () => {
    if (!pendingStockChange) return;
    const motivo = stockMotivo.trim();
    if (motivo.length < 3) { toast.error('El motivo debe tener al menos 3 caracteres'); return; }
    setSaving(true);

    // 1) Ajuste de stock vía RPC (atómico + audit)
    const { error: rpcErr } = await supabase.rpc('ajustar_stock_insumo' as any, {
      _insumo_id: pendingStockChange.insumoId,
      _nuevo_stock: pendingStockChange.stockNuevo,
      _motivo: motivo,
    });
    if (rpcErr) {
      toast.error(rpcErr.message || 'No se pudo ajustar el stock');
      setSaving(false);
      return;
    }

    // 2) Update del resto de campos (sin stock_actual ni costo_unitario)
    const { error: updErr } = await supabase
      .from('insumos')
      .update(pendingStockChange.payloadRestante)
      .eq('id', pendingStockChange.insumoId);
    if (updErr) {
      if (updErr.code === '23505' || /unique/i.test(updErr.message)) {
        toast.error(`Ya existe un insumo con el nombre "${pendingStockChange.payloadRestante.nombre}"`);
      } else {
        toast.error('Stock ajustado, pero falló actualizar el resto del insumo');
      }
      setSaving(false);
      return;
    }

    await supabase.from('audit_logs').insert({
      user_id: user!.id,
      accion: 'actualizar_insumo',
      descripcion: `Insumo actualizado: ${pendingStockChange.payloadRestante.nombre}`,
      metadata: { insumo_id: pendingStockChange.insumoId, ...pendingStockChange.payloadRestante },
    });

    toast.success('Insumo actualizado y stock ajustado');
    setSaving(false);
    setStockMotivoOpen(false);
    setPendingStockChange(null);
    setStockMotivo('');
    setDialogOpen(false);
    fetchInsumos();
  };


  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('insumos').delete().eq('id', deleteTarget.id);
    if (error) { toast.error('Error al eliminar el insumo'); }
    else {
      toast.success('Insumo eliminado');
      fetchInsumos();
    }
    setDeleteTarget(null);
  };

  const handleDuplicate = (insumo: Insumo) => {
    setEditingId(null);
    setForm({
      nombre: `${insumo.nombre} (copia)`,
      unidad_medida: insumo.unidad_medida,
      stock_actual: '0',
      stock_minimo: String(insumo.stock_minimo),
      costo_presentacion: String(insumo.costo_presentacion),
      cantidad_por_presentacion: String(insumo.cantidad_por_presentacion),
      presentacion: insumo.presentacion,
      categoria: insumo.categoria,
    });
    setDialogOpen(true);
  };

  const lowStock = insumos.filter(i => i.stock_actual < i.stock_minimo);

  const insumosFiltrados = useMemo(() => {
    return insumos.filter(i => {
      const matchBusqueda = i.nombre.toLowerCase().includes(busqueda.toLowerCase());
      const matchCategoria = categoriaFiltro === 'Todas' || i.categoria === categoriaFiltro;
      const matchStock = !soloStockBajo || i.stock_actual < i.stock_minimo;
      return matchBusqueda && matchCategoria && matchStock;
    });
  }, [insumos, busqueda, categoriaFiltro, soloStockBajo]);

  const [paginaActual, setPaginaActual] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  useEffect(() => { setPaginaActual(1); }, [busqueda, categoriaFiltro, soloStockBajo, porPagina]);
  const totalPaginas = Math.max(1, Math.ceil(insumosFiltrados.length / porPagina));
  const paginaSegura = Math.min(paginaActual, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const insumosPagina = insumosFiltrados.slice(inicio, inicio + porPagina);

  return (
    <div className="space-y-4">
      {lowStock.length > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="pt-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive font-medium">
              {lowStock.length} insumo{lowStock.length > 1 ? 's' : ''} con stock bajo mínimo:{' '}
              {lowStock.map(i => i.nombre).join(', ')}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-heading font-semibold text-foreground">Materia Prima</h2>
        {isAdmin && (
          <Button onClick={openNew} size="sm" className="gap-2">
            <PackagePlus className="h-4 w-4" /> Nuevo Insumo
          </Button>
        )}
      </div>

      {/* Barra de búsqueda y filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar insumo por nombre..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Todas">Todas las categorías</SelectItem>
            {CATEGORIAS_INSUMO.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={soloStockBajo} onCheckedChange={setSoloStockBajo} id="stock-bajo" />
          <Label htmlFor="stock-bajo" className="text-sm cursor-pointer whitespace-nowrap">Ver Stock Bajo</Label>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Insumo</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Presentación</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead className="text-right">Stock Actual</TableHead>
                <TableHead className="text-right">Stock Mínimo</TableHead>
                {isAdmin && <TableHead className="text-right">Costo Unitario</TableHead>}
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Cargando...</TableCell></TableRow>
              ) : insumosFiltrados.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {insumos.length === 0 ? 'Sin insumos registrados' : 'No se encontraron insumos que coincidan con tu búsqueda'}
                </TableCell></TableRow>
              ) : insumosPagina.map(insumo => {
                const bajo = insumo.stock_actual < insumo.stock_minimo;
                return (
                  <TableRow key={insumo.id} className={bajo ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-medium">{insumo.nombre}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{insumo.categoria}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{insumo.presentacion}</TableCell>
                    <TableCell>{insumo.unidad_medida}</TableCell>
                    <TableCell className={`text-right font-mono ${bajo ? 'text-destructive font-bold' : ''}`}>
                      {insumo.stock_actual} {insumo.unidad_medida}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {insumo.stock_minimo} {insumo.unidad_medida}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right font-mono">
                        ${insumo.costo_unitario.toFixed(4)}/{insumo.unidad_medida}
                      </TableCell>
                    )}
                    <TableCell>
                      {bajo ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Stock bajo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" title="Acciones">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setSelectedInsumo(insumo); setMermaDialogOpen(true); }}>
                            <ShieldAlert className="h-4 w-4 mr-2 text-muted-foreground" />
                            Registrar merma
                          </DropdownMenuItem>
                          {isAdmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleDuplicate(insumo)}>
                                <Copy className="h-4 w-4 mr-2 text-muted-foreground" />
                                Duplicar insumo
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(insumo)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(insumo)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <DataPagination
        paginaActual={paginaSegura}
        totalItems={insumosFiltrados.length}
        porPagina={porPagina}
        onPaginaChange={setPaginaActual}
        onPorPaginaChange={setPorPagina}
        etiqueta="insumos"
      />



      {/* Dialog CRUD */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Insumo' : 'Nuevo Insumo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Nombre del insumo *</Label>
                <Input placeholder="ej. Cacao 70%" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Categoría</Label>
                <Select value={form.categoria} onValueChange={v => setForm(f => ({ ...f, categoria: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_INSUMO.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Unidad de medida</Label>
                <Select value={form.unidad_medida} onValueChange={v => setForm(f => ({ ...f, unidad_medida: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gr">Gramos (gr)</SelectItem>
                    <SelectItem value="ml">Mililitros (ml)</SelectItem>
                    <SelectItem value="kg">Kilogramos (kg)</SelectItem>
                    <SelectItem value="lt">Litros (lt)</SelectItem>
                    <SelectItem value="pza">Pieza (pza)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Presentación y costos */}
            <div className="rounded-md border border-border p-3 space-y-3 bg-muted/30">
              <p className="text-sm font-medium text-foreground">Compra por presentación</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Presentación</Label>
                  <Select value={form.presentacion} onValueChange={v => setForm(f => ({ ...f, presentacion: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRESENTACIONES.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Costo presentación ($)</Label>
                  <Input type="number" min="0" step="0.01" placeholder="200.00" value={form.costo_presentacion} onChange={e => setForm(f => ({ ...f, costo_presentacion: e.target.value }))} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Cantidad por presentación ({form.unidad_medida})</Label>
                  <Input type="number" min="0.01" step="0.01" placeholder="500" value={form.cantidad_por_presentacion} onChange={e => setForm(f => ({ ...f, cantidad_por_presentacion: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
                <span className="text-sm text-muted-foreground">Costo unitario calculado</span>
                <span className="font-mono font-semibold text-foreground">
                  ${costoUnitarioCalculado.toFixed(4)} / {form.unidad_medida}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Stock actual</Label>
                <Input type="number" min="0" step="0.01" value={form.stock_actual} onChange={e => setForm(f => ({ ...f, stock_actual: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Stock mínimo</Label>
                <Input type="number" min="0" step="0.01" value={form.stock_minimo} onChange={e => setForm(f => ({ ...f, stock_minimo: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merma Dialog */}
      {selectedInsumo && (
        <MermaDialog
          open={mermaDialogOpen}
          onOpenChange={setMermaDialogOpen}
          insumo={selectedInsumo}
          onSuccess={fetchInsumos}
        />
      )}

      {/* Motivo de ajuste manual de stock */}
      <AlertDialog open={stockMotivoOpen} onOpenChange={open => { if (!open && !saving) { setStockMotivoOpen(false); setPendingStockChange(null); setStockMotivo(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Ajuste manual de stock
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Vas a cambiar el stock de <span className="font-semibold text-foreground">{pendingStockChange?.nombre}</span> de{' '}
                  <span className="font-mono">{pendingStockChange?.stockPrev}</span> a{' '}
                  <span className="font-mono font-semibold text-foreground">{pendingStockChange?.stockNuevo}</span>.
                </p>
                <p className="text-xs">
                  Este movimiento queda registrado en la bitácora con tu nombre y el motivo capturado.
                </p>
                <div className="pt-2">
                  <Label htmlFor="stock-motivo" className="text-sm">Motivo <span className="text-destructive">*</span></Label>
                  <Input
                    id="stock-motivo"
                    autoFocus
                    value={stockMotivo}
                    onChange={e => setStockMotivo(e.target.value)}
                    placeholder="Ej. Conteo físico, corrección de error de captura..."
                    maxLength={200}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStockMotivo} disabled={saving || stockMotivo.trim().length < 3}>
              {saving ? 'Guardando...' : 'Confirmar ajuste'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar insumo</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar "{deleteTarget?.nombre}"? Se eliminarán también las recetas, mermas y compras asociadas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default InsumosTab;
