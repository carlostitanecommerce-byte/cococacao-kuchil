import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCategorias } from '@/hooks/useCategorias';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Truck, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface Plataforma {
  id: string;
  nombre: string;
  comision_porcentaje: number;
  activo: boolean;
}

interface ProductoRow {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number;
  costo_total: number;
  tipo: string;
  activo: boolean;
}

interface PrecioRow {
  id: string;
  producto_id: string;
  plataforma_id: string;
  precio_venta: number;
}

interface Props { isAdmin: boolean }

const PreciosDeliveryTab = ({ isAdmin }: Props) => {
  const { user } = useAuth();
  const { categorias } = useCategorias(['producto', 'paquete']);

  const [plataformas, setPlataformas] = useState<Plataforma[]>([]);
  const [productos, setProductos] = useState<ProductoRow[]>([]);
  const [precios, setPrecios] = useState<PrecioRow[]>([]);
  const [loading, setLoading] = useState(true);

  // CRUD plataformas
  const [pDialog, setPDialog] = useState(false);
  const [pEditing, setPEditing] = useState<Plataforma | null>(null);
  const [pForm, setPForm] = useState({ nombre: '', comision_porcentaje: '0', activo: true });
  const [pDelete, setPDelete] = useState<Plataforma | null>(null);

  // Filtros matriz
  const [busqueda, setBusqueda] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<string>('__all__');
  const [catFiltro, setCatFiltro] = useState<string>('__all__');
  const [soloActivos, setSoloActivos] = useState(true);

  // Paginación
  const [paginaActual, setPaginaActual] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  // Borrador local de precios { "<prodId>:<plataId>": stringValue }
  const [borrador, setBorrador] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [platRes, prodRes, precRes] = await Promise.all([
      supabase.from('plataformas_delivery').select('*').order('nombre'),
      supabase.from('productos').select('id, nombre, categoria, precio_venta, costo_total, tipo, activo').order('nombre'),
      supabase.from('producto_precios_delivery').select('id, producto_id, plataforma_id, precio_venta'),
    ]);
    setPlataformas((platRes.data as Plataforma[]) ?? []);
    setProductos((prodRes.data as ProductoRow[]) ?? []);
    setPrecios((precRes.data as PrecioRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const ch = supabase.channel('menu-precios-delivery')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plataformas_delivery' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'producto_precios_delivery' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  const plataformasActivas = useMemo(() => plataformas.filter(p => p.activo), [plataformas]);

  const precioOf = (productoId: string, plataformaId: string): PrecioRow | undefined =>
    precios.find(p => p.producto_id === productoId && p.plataforma_id === plataformaId);

  const productosFiltrados = useMemo(() => {
    return productos.filter(p => {
      if (soloActivos && !p.activo) return false;
      if (tipoFiltro !== '__all__' && p.tipo !== tipoFiltro) return false;
      if (catFiltro !== '__all__' && p.categoria !== catFiltro) return false;
      if (busqueda && !p.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
      return true;
    });
  }, [productos, busqueda, tipoFiltro, catFiltro, soloActivos]);

  // Reset página al cambiar filtros o tamaño
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, tipoFiltro, catFiltro, soloActivos, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / porPagina));
  const paginaSegura = Math.min(paginaActual, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const fin = inicio + porPagina;
  const productosPagina = productosFiltrados.slice(inicio, fin);

  const numerosPagina = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    const total = totalPaginas;
    const cur = paginaSegura;
    const push = (n: number | 'ellipsis') => pages.push(n);
    if (total <= 7) {
      for (let i = 1; i <= total; i++) push(i);
    } else {
      push(1);
      if (cur > 3) push('ellipsis');
      const start = Math.max(2, cur - 1);
      const end = Math.min(total - 1, cur + 1);
      for (let i = start; i <= end; i++) push(i);
      if (cur < total - 2) push('ellipsis');
      push(total);
    }
    return pages;
  }, [totalPaginas, paginaSegura]);

  // ============ CRUD Plataformas ============
  const openNewPlat = () => {
    setPEditing(null);
    setPForm({ nombre: '', comision_porcentaje: '0', activo: true });
    setPDialog(true);
  };
  const openEditPlat = (p: Plataforma) => {
    setPEditing(p);
    setPForm({ nombre: p.nombre, comision_porcentaje: String(p.comision_porcentaje), activo: p.activo });
    setPDialog(true);
  };

  const savePlat = async () => {
    if (!pForm.nombre.trim()) { toast.error('Nombre obligatorio'); return; }
    const comision = parseFloat(pForm.comision_porcentaje) || 0;
    if (comision < 0 || comision > 100) { toast.error('Comisión debe estar entre 0 y 100'); return; }
    const payload = { nombre: pForm.nombre.trim(), comision_porcentaje: comision, activo: pForm.activo };
    const { error } = pEditing
      ? await supabase.from('plataformas_delivery').update(payload).eq('id', pEditing.id)
      : await supabase.from('plataformas_delivery').insert(payload);
    if (error) { toast.error(error.message); return; }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: pEditing ? 'editar_plataforma_delivery' : 'crear_plataforma_delivery',
        descripcion: `${pEditing ? 'Editada' : 'Creada'} plataforma: ${payload.nombre}`,
        metadata: { ...payload, plataforma_id: pEditing?.id },
      });
    }
    toast.success(`Plataforma ${pEditing ? 'actualizada' : 'creada'}`);
    setPDialog(false);
    fetchAll();
  };

  const deletePlat = async (p: Plataforma) => {
    const { error } = await supabase.from('plataformas_delivery').delete().eq('id', p.id);
    if (error) { toast.error(error.message); return; }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id, accion: 'eliminar_plataforma_delivery',
        descripcion: `Eliminada plataforma: ${p.nombre}`,
        metadata: { plataforma_id: p.id, nombre: p.nombre },
      });
    }
    toast.success('Plataforma eliminada');
    setPDelete(null);
    fetchAll();
  };

  // ============ Matriz: guardado por celda ============
  const cellKey = (prodId: string, platId: string) => `${prodId}:${platId}`;

  const handlePrecioBlur = async (prodId: string, platId: string) => {
    const key = cellKey(prodId, platId);
    if (!(key in borrador)) return;
    const raw = borrador[key].trim();
    const existing = precioOf(prodId, platId);
    setBorrador(b => { const c = { ...b }; delete c[key]; return c; });

    // vacío → delete
    if (raw === '') {
      if (existing) {
        const { error } = await supabase.from('producto_precios_delivery').delete().eq('id', existing.id);
        if (error) { toast.error(error.message); return; }
        fetchAll();
      }
      return;
    }
    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) { toast.error('Precio inválido'); return; }
    if (existing && existing.precio_venta === val) return;

    if (existing) {
      const { error } = await supabase.from('producto_precios_delivery').update({ precio_venta: val }).eq('id', existing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('producto_precios_delivery').insert({
        producto_id: prodId, plataforma_id: platId, precio_venta: val,
      });
      if (error) { toast.error(error.message); return; }
    }
    fetchAll();
  };

  const margenColor = (pct: number) =>
    pct > 30 ? 'text-green-600' : pct >= 10 ? 'text-yellow-600' : 'text-destructive';

  return (
    <div className="space-y-6">
      {/* === Sección 1: CRUD Plataformas === */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" /> Plataformas de delivery
          </CardTitle>
          {isAdmin && (
            <Button size="sm" onClick={openNewPlat} className="gap-1">
              <Plus className="h-4 w-4" /> Agregar plataforma
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plataforma</TableHead>
                <TableHead className="text-right">Comisión %</TableHead>
                <TableHead className="text-center">Estado</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plataformas.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground text-sm">Sin plataformas registradas</TableCell></TableRow>
              ) : plataformas.map(p => (
                <TableRow key={p.id} className={!p.activo ? 'opacity-60' : ''}>
                  <TableCell className="font-medium">{p.nombre}</TableCell>
                  <TableCell className="text-right">{Number(p.comision_porcentaje).toFixed(2)}%</TableCell>
                  <TableCell className="text-center">
                    {p.activo ? <Badge variant="secondary">Activa</Badge> : <Badge variant="outline">Inactiva</Badge>}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditPlat(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setPDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* === Sección 2: Matriz de precios === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Matriz de precios por plataforma</CardTitle>
          <p className="text-xs text-muted-foreground">
            Edita el precio de cada producto/paquete por plataforma. Margen Neto = (Precio − Comisión) − Costo de receta.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar producto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="pl-9" />
            </div>
            <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos los tipos</SelectItem>
                <SelectItem value="producto">Producto individual</SelectItem>
                <SelectItem value="paquete">Paquete / Combo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFiltro} onValueChange={setCatFiltro}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Categoría" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las categorías</SelectItem>
                {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch checked={soloActivos} onCheckedChange={setSoloActivos} id="solo-act" />
              <Label htmlFor="solo-act" className="text-sm">Solo activos</Label>
            </div>
          </div>

          {plataformasActivas.length === 0 ? (
            <div className="border border-dashed rounded-md p-8 text-center text-sm text-muted-foreground">
              Activa al menos una plataforma para gestionar precios.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Producto</TableHead>
                    <TableHead>Categoría</TableHead>
                    {isAdmin && <TableHead className="text-right">Costo</TableHead>}
                    <TableHead className="text-right">Precio base</TableHead>
                    {plataformasActivas.map(pl => (
                      <TableHead key={pl.id} colSpan={2} className="text-center border-l">
                        {pl.nombre}
                        <div className="text-[10px] font-normal text-muted-foreground">comisión {Number(pl.comision_porcentaje).toFixed(1)}%</div>
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableHead colSpan={isAdmin ? 4 : 3} />
                    {plataformasActivas.map(pl => (
                      <>
                        <TableHead key={`${pl.id}-p`} className="text-center text-[11px] border-l">Precio</TableHead>
                        <TableHead key={`${pl.id}-m`} className="text-center text-[11px]">Margen Neto</TableHead>
                      </>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={4 + plataformasActivas.length * 2} className="text-center py-8 text-muted-foreground">Cargando...</TableCell></TableRow>
                  ) : productosFiltrados.length === 0 ? (
                    <TableRow><TableCell colSpan={4 + plataformasActivas.length * 2} className="text-center py-8 text-muted-foreground">Sin resultados</TableCell></TableRow>
                  ) : productosPagina.map(prod => (
                    <TableRow key={prod.id} className={!prod.activo ? 'opacity-60' : ''}>
                      <TableCell className="font-medium">
                        {prod.nombre}
                        {prod.tipo === 'paquete' && <Badge variant="outline" className="ml-2 text-[10px]">Paquete</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{prod.categoria}</TableCell>
                      {isAdmin && <TableCell className="text-right text-muted-foreground">${Number(prod.costo_total).toFixed(2)}</TableCell>}
                      <TableCell className="text-right">${Number(prod.precio_venta).toFixed(2)}</TableCell>
                      {plataformasActivas.map(pl => {
                        const key = cellKey(prod.id, pl.id);
                        const existing = precioOf(prod.id, pl.id);
                        const value = key in borrador ? borrador[key] : (existing ? String(existing.precio_venta) : '');
                        const numeric = parseFloat(value) || 0;
                        const neto = numeric - (numeric * Number(pl.comision_porcentaje) / 100) - Number(prod.costo_total);
                        const netoPct = numeric > 0 ? (neto / numeric) * 100 : 0;
                        return (
                          <Fragment key={pl.id}>
                            <TableCell className="border-l p-1">
                              <Input
                                type="number" min={0} step={0.01}
                                value={value}
                                onChange={e => setBorrador(b => ({ ...b, [key]: e.target.value }))}
                                onBlur={() => handlePrecioBlur(prod.id, pl.id)}
                                placeholder="—"
                                className="h-8 text-sm text-right"
                                disabled={!isAdmin}
                              />
                            </TableCell>
                            <TableCell className={`text-right text-sm font-semibold ${value ? margenColor(netoPct) : 'text-muted-foreground'}`}>
                              {value ? `$${neto.toFixed(2)}` : '—'}
                              {value && <div className="text-[10px] font-normal">{netoPct.toFixed(1)}%</div>}
                            </TableCell>
                          </Fragment>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {plataformasActivas.length > 0 && productosFiltrados.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <div className="text-xs text-muted-foreground">
                Mostrando {inicio + 1}–{Math.min(fin, productosFiltrados.length)} de {productosFiltrados.length} productos
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Por página</Label>
                  <Select value={String(porPagina)} onValueChange={v => setPorPagina(Number(v))}>
                    <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={paginaSegura === 1} onClick={() => setPaginaActual(p => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {numerosPagina.map((n, idx) =>
                    n === 'ellipsis' ? (
                      <span key={`e-${idx}`} className="px-2 text-muted-foreground text-sm">…</span>
                    ) : (
                      <Button
                        key={n}
                        variant={n === paginaSegura ? 'default' : 'outline'}
                        size="icon"
                        className="h-8 w-8 text-xs"
                        onClick={() => setPaginaActual(n)}
                      >
                        {n}
                      </Button>
                    )
                  )}
                  <Button variant="outline" size="icon" className="h-8 w-8" disabled={paginaSegura === totalPaginas} onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog plataforma */}
      <Dialog open={pDialog} onOpenChange={setPDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pEditing ? 'Editar plataforma' : 'Nueva plataforma'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input value={pForm.nombre} onChange={e => setPForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Uber Eats, Rappi, DiDi Food..." />
            </div>
            <div className="space-y-1">
              <Label>Comisión (%)</Label>
              <Input type="number" min={0} max={100} step={0.01} value={pForm.comision_porcentaje} onChange={e => setPForm(f => ({ ...f, comision_porcentaje: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={pForm.activo} onCheckedChange={v => setPForm(f => ({ ...f, activo: v }))} />
              <Label>Activa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPDialog(false)}>Cancelar</Button>
            <Button onClick={savePlat}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación eliminar plataforma */}
      <AlertDialog open={!!pDelete} onOpenChange={(o) => { if (!o) setPDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar plataforma</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la plataforma "{pDelete?.nombre}" y todos sus precios asociados. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => pDelete && deletePlat(pDelete)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PreciosDeliveryTab;
