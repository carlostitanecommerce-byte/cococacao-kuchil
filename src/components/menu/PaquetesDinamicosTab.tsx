import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCategorias } from '@/hooks/useCategorias';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import {
  Plus, Pencil, Trash2, Package, Search, X, ArrowUp, ArrowDown, Layers, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

interface ProductoSimple {
  id: string;
  nombre: string;
  categoria: string;
  costo_total: number;
  precio_venta: number;
  activo: boolean;
}

interface OpcionLine {
  id?: string;
  producto_id: string;
  precio_adicional: number;
  producto?: ProductoSimple;
}

interface GrupoLine {
  id?: string;
  nombre_grupo: string;
  cantidad_incluida: number;
  es_obligatorio: boolean;
  orden: number;
  opciones: OpcionLine[];
  _searchOpen?: boolean;
  _search?: string;
}

interface Paquete {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number;
  costo_total: number;
  margen: number;
  imagen_url: string | null;
  instrucciones_preparacion: string | null;
  activo: boolean;
  num_grupos?: number;
}

const emptyForm = { nombre: '', categoria: '', precio_venta: '', instrucciones_preparacion: '', activo: true };

interface Props { isAdmin: boolean }

const PaquetesDinamicosTab = ({ isAdmin }: Props) => {
  const { categorias } = useCategorias('paquete');
  const { user } = useAuth();

  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [productosSimples, setProductosSimples] = useState<ProductoSimple[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [grupos, setGrupos] = useState<GrupoLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Paquete | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<string | null>(null);

  const fetchPaquetes = useCallback(async () => {
    setLoading(true);
    const { data: paqs } = await supabase
      .from('productos')
      .select('*')
      .eq('tipo', 'paquete')
      .order('nombre');
    const list = (paqs as Paquete[]) ?? [];
    if (list.length > 0) {
      const { data: grps } = await supabase
        .from('paquete_grupos')
        .select('paquete_id')
        .in('paquete_id', list.map(p => p.id));
      const counts: Record<string, number> = {};
      (grps ?? []).forEach((g: any) => { counts[g.paquete_id] = (counts[g.paquete_id] ?? 0) + 1; });
      list.forEach(p => { p.num_grupos = counts[p.id] ?? 0; });
    }
    setPaquetes(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPaquetes();
    supabase.from('productos')
      .select('id, nombre, categoria, costo_total, precio_venta, activo')
      .eq('tipo', 'simple').eq('activo', true).order('nombre')
      .then(({ data }) => setProductosSimples((data as ProductoSimple[]) ?? []));
  }, [fetchPaquetes]);

  useEffect(() => {
    const ch = supabase.channel('menu-paquetes-din')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paquete_grupos' }, () => fetchPaquetes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paquete_opciones_grupo' }, () => fetchPaquetes())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchPaquetes]);

  // Cálculo de costo: por cada grupo, promedio de costos de opciones × cantidad_incluida
  const calcCosto = (gs: GrupoLine[]): number => {
    return gs.reduce((sum, g) => {
      if (g.opciones.length === 0) return sum;
      const promCostos = g.opciones.reduce((s, o) => {
        const prod = productosSimples.find(p => p.id === o.producto_id);
        return s + (prod ? prod.costo_total + (o.precio_adicional || 0) * 0 : 0);
      }, 0) / g.opciones.length;
      return sum + promCostos * g.cantidad_incluida;
    }, 0);
  };

  const calcMargen = (precio: number, costo: number) =>
    precio > 0 ? ((precio - costo) / precio) * 100 : 0;

  const margenColor = (m: number) =>
    m > 40 ? 'text-green-600' : m >= 20 ? 'text-yellow-600' : 'text-destructive';

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setGrupos([]);
    setDialogOpen(true);
  };

  const openEdit = async (p: Paquete) => {
    setEditingId(p.id);
    setForm({
      nombre: p.nombre,
      categoria: p.categoria,
      precio_venta: String(p.precio_venta),
      instrucciones_preparacion: p.instrucciones_preparacion ?? '',
      activo: p.activo,
    });
    const { data: gs } = await supabase
      .from('paquete_grupos')
      .select('id, nombre_grupo, cantidad_incluida, es_obligatorio, orden')
      .eq('paquete_id', p.id)
      .order('orden');
    const grupoIds = (gs ?? []).map((g: any) => g.id);
    let opcionesByGrupo: Record<string, OpcionLine[]> = {};
    if (grupoIds.length > 0) {
      const { data: ops } = await supabase
        .from('paquete_opciones_grupo')
        .select('id, grupo_id, producto_id, precio_adicional, productos:producto_id(id, nombre, categoria, costo_total, precio_venta, activo)')
        .in('grupo_id', grupoIds);
      (ops ?? []).forEach((o: any) => {
        if (!opcionesByGrupo[o.grupo_id]) opcionesByGrupo[o.grupo_id] = [];
        opcionesByGrupo[o.grupo_id].push({
          id: o.id,
          producto_id: o.producto_id,
          precio_adicional: Number(o.precio_adicional),
          producto: o.productos,
        });
      });
    }
    setGrupos((gs ?? []).map((g: any) => ({
      id: g.id,
      nombre_grupo: g.nombre_grupo,
      cantidad_incluida: g.cantidad_incluida,
      es_obligatorio: g.es_obligatorio,
      orden: g.orden,
      opciones: opcionesByGrupo[g.id] ?? [],
    })));
    setDialogOpen(true);
  };

  const addGrupo = () => {
    setGrupos(g => [...g, {
      nombre_grupo: '', cantidad_incluida: 1, es_obligatorio: true,
      orden: g.length, opciones: [],
    }]);
  };

  const updateGrupo = (idx: number, patch: Partial<GrupoLine>) => {
    setGrupos(g => g.map((x, i) => i === idx ? { ...x, ...patch } : x));
  };

  const removeGrupo = (idx: number) => {
    setGrupos(g => g.filter((_, i) => i !== idx).map((x, i) => ({ ...x, orden: i })));
  };

  const moveGrupo = (idx: number, dir: -1 | 1) => {
    setGrupos(g => {
      const ni = idx + dir;
      if (ni < 0 || ni >= g.length) return g;
      const copy = [...g];
      [copy[idx], copy[ni]] = [copy[ni], copy[idx]];
      return copy.map((x, i) => ({ ...x, orden: i }));
    });
  };

  const addOpcion = (gIdx: number, productoId: string) => {
    const prod = productosSimples.find(p => p.id === productoId);
    if (!prod) return;
    setGrupos(g => g.map((x, i) => {
      if (i !== gIdx) return x;
      if (x.opciones.some(o => o.producto_id === productoId)) {
        toast.error('Esta opción ya está en el grupo');
        return x;
      }
      return { ...x, opciones: [...x.opciones, { producto_id: productoId, precio_adicional: 0, producto: prod }], _search: '' };
    }));
  };

  const updateOpcion = (gIdx: number, oIdx: number, patch: Partial<OpcionLine>) => {
    setGrupos(g => g.map((x, i) => i === gIdx
      ? { ...x, opciones: x.opciones.map((o, j) => j === oIdx ? { ...o, ...patch } : o) }
      : x
    ));
  };

  const removeOpcion = (gIdx: number, oIdx: number) => {
    setGrupos(g => g.map((x, i) => i === gIdx
      ? { ...x, opciones: x.opciones.filter((_, j) => j !== oIdx) }
      : x
    ));
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
    if (grupos.length === 0) { toast.error('Agrega al menos un grupo'); return; }
    for (const [i, g] of grupos.entries()) {
      if (!g.nombre_grupo.trim()) { toast.error(`Grupo #${i + 1}: nombre obligatorio`); return; }
      if (g.cantidad_incluida < 1) { toast.error(`Grupo "${g.nombre_grupo}": cantidad debe ser ≥ 1`); return; }
      if (g.opciones.length === 0) { toast.error(`Grupo "${g.nombre_grupo}": agrega al menos una opción`); return; }
      if (g.cantidad_incluida > g.opciones.length) {
        toast.error(`Grupo "${g.nombre_grupo}": cantidad (${g.cantidad_incluida}) excede el número de opciones (${g.opciones.length})`);
        return;
      }
    }

    setSaving(true);
    const precio = parseFloat(form.precio_venta) || 0;
    const costo = calcCosto(grupos);
    const margen = calcMargen(precio, costo);

    const payload = {
      nombre: form.nombre.trim(),
      categoria: form.categoria || 'Paquetes',
      precio_venta: precio,
      costo_total: costo,
      margen,
      instrucciones_preparacion: form.instrucciones_preparacion.trim() || null,
      activo: form.activo,
      tipo: 'paquete',
    };

    let paqueteId = editingId;
    const isNew = !editingId;

    if (editingId) {
      const { error } = await supabase.from('productos').update(payload as any).eq('id', editingId);
      if (error) { toast.error('Error al actualizar paquete'); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('productos').insert(payload as any).select('id').single();
      if (error || !data) { toast.error('Error al crear paquete'); setSaving(false); return; }
      paqueteId = data.id;
    }

    // Borrar grupos existentes (cascade limpia opciones)
    await supabase.from('paquete_grupos').delete().eq('paquete_id', paqueteId!);

    // Insertar grupos uno por uno para capturar IDs y luego sus opciones
    for (const g of grupos) {
      const { data: gData, error: gErr } = await supabase
        .from('paquete_grupos')
        .insert({
          paquete_id: paqueteId!,
          nombre_grupo: g.nombre_grupo.trim(),
          cantidad_incluida: g.cantidad_incluida,
          es_obligatorio: g.es_obligatorio,
          orden: g.orden,
        })
        .select('id')
        .single();
      if (gErr || !gData) {
        toast.error('Error al guardar grupos');
        if (isNew && paqueteId) await supabase.from('productos').delete().eq('id', paqueteId);
        setSaving(false);
        return;
      }
      if (g.opciones.length > 0) {
        const { error: oErr } = await supabase.from('paquete_opciones_grupo').insert(
          g.opciones.map(o => ({
            grupo_id: gData.id,
            producto_id: o.producto_id,
            precio_adicional: o.precio_adicional || 0,
          }))
        );
        if (oErr) {
          toast.error('Error al guardar opciones');
          if (isNew && paqueteId) await supabase.from('productos').delete().eq('id', paqueteId);
          setSaving(false);
          return;
        }
      }
    }

    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: editingId ? 'actualizar_paquete_dinamico' : 'crear_paquete_dinamico',
        descripcion: `${editingId ? 'Actualización' : 'Creación'} de paquete dinámico: ${payload.nombre}`,
        metadata: {
          paquete_id: paqueteId,
          ...payload,
          num_grupos: grupos.length,
          num_opciones_total: grupos.reduce((s, g) => s + g.opciones.length, 0),
        },
      });
    }

    toast.success(`Paquete ${editingId ? 'actualizado' : 'creado'}`);
    setSaving(false);
    setDialogOpen(false);
    fetchPaquetes();
  };

  const checkAndPromptDelete = async (p: Paquete) => {
    setDeleteBlock(null);
    const ventasRes = await supabase
      .from('detalle_ventas')
      .select('id', { count: 'exact', head: true })
      .eq('paquete_id', p.id);
    const tieneVentas = (ventasRes.count ?? 0) > 0;
    if (tieneVentas) {
      setDeleteBlock(
        `"${p.nombre}" tiene historial de ventas (${ventasRes.count}). Para preservar trazabilidad no se puede eliminar; puedes desactivarlo.`
      );
    }
    setDeleteCandidate(p);
  };

  const handleSoftDelete = async (p: Paquete) => {
    const { error } = await supabase.from('productos').update({ activo: false }).eq('id', p.id);
    if (error) { toast.error('Error al desactivar paquete'); return; }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id, accion: 'desactivar_paquete_dinamico',
        descripcion: `Paquete desactivado: ${p.nombre}`,
        metadata: { paquete_id: p.id },
      });
    }
    toast.success('Paquete desactivado');
    setDeleteCandidate(null);
    fetchPaquetes();
  };

  const handleHardDelete = async (p: Paquete) => {
    // Cascade limpia paquete_grupos y paquete_opciones_grupo
    const { error } = await supabase.from('productos').delete().eq('id', p.id);
    if (error) { toast.error('Error al eliminar paquete'); return; }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id, accion: 'eliminar_paquete_dinamico',
        descripcion: `Eliminación de paquete: ${p.nombre}`,
        metadata: { paquete_id: p.id, paquete_nombre: p.nombre },
      });
    }
    toast.success('Paquete eliminado');
    setDeleteCandidate(null);
    fetchPaquetes();
  };

  const filtrados = useMemo(() => paquetes.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.categoria.toLowerCase().includes(busqueda.toLowerCase())
  ), [paquetes, busqueda]);

  useEffect(() => { setPaginaActual(1); }, [busqueda, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaSegura = Math.min(paginaActual, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const fin = inicio + porPagina;
  const paquetesPagina = filtrados.slice(inicio, fin);

  const numerosPagina = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    const total = totalPaginas;
    const cur = paginaSegura;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (cur > 3) pages.push('ellipsis');
      const start = Math.max(2, cur - 1);
      const end = Math.min(total - 1, cur + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (cur < total - 2) pages.push('ellipsis');
      pages.push(total);
    }
    return pages;
  }, [totalPaginas, paginaSegura]);

  const costoPreview = calcCosto(grupos);
  const precioPreview = parseFloat(form.precio_venta) || 0;
  const margenPreview = calcMargen(precioPreview, costoPreview);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-heading font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Paquetes / Combos
          </h2>
          <p className="text-xs text-muted-foreground">
            Configura paquetes con grupos de opciones (ej. "Elige tu bebida"). El cliente elegirá entre las opciones al venderlo.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Nuevo Paquete
          </Button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar paquete..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paquete</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-center">Grupos</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                {isAdmin && <TableHead className="text-right">Costo</TableHead>}
                {isAdmin && <TableHead className="text-right">Margen</TableHead>}
                <TableHead className="text-center">Estado</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Cargando...</TableCell></TableRow>
              ) : filtrados.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{busqueda ? 'Sin resultados' : 'Sin paquetes registrados'}</TableCell></TableRow>
              ) : paquetesPagina.map(p => (
                <TableRow key={p.id} className={!p.activo ? 'opacity-60' : ''}>
                  <TableCell className="font-medium">{p.nombre}</TableCell>
                  <TableCell>{p.categoria}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={p.num_grupos ? 'default' : 'outline'} className="gap-1">
                      <Layers className="h-3 w-3" />{p.num_grupos ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">${Number(p.precio_venta).toFixed(2)}</TableCell>
                  {isAdmin && <TableCell className="text-right text-muted-foreground">${Number(p.costo_total).toFixed(2)}</TableCell>}
                  {isAdmin && <TableCell className={`text-right font-semibold ${margenColor(Number(p.margen))}`}>{Number(p.margen).toFixed(1)}%</TableCell>}
                  <TableCell className="text-center">
                    {p.activo ? <Badge variant="secondary">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => checkAndPromptDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {filtrados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Mostrando {inicio + 1}–{Math.min(fin, filtrados.length)} de {filtrados.length} paquetes
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

      {/* Diálogo de edición */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Paquete' : 'Nuevo Paquete'}</DialogTitle>
          </DialogHeader>

          {/* Datos generales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Nombre</Label>
              <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Categoría</Label>
              <Select value={form.categoria} onValueChange={v => setForm(f => ({ ...f, categoria: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                <SelectContent>
                  {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Precio de venta</Label>
              <Input type="number" min={0} step={0.01} value={form.precio_venta} onChange={e => setForm(f => ({ ...f, precio_venta: e.target.value }))} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Instrucciones de preparación</Label>
              <Textarea rows={2} value={form.instrucciones_preparacion} onChange={e => setForm(f => ({ ...f, instrucciones_preparacion: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.activo} onCheckedChange={v => setForm(f => ({ ...f, activo: v }))} />
              <Label>Activo</Label>
            </div>
          </div>

          <Separator />

          {/* Constructor de grupos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4" /> Grupos de Opciones
              </h3>
              <Button size="sm" variant="outline" onClick={addGrupo} className="gap-1">
                <Plus className="h-3 w-3" /> Agregar Grupo
              </Button>
            </div>

            {grupos.length === 0 && (
              <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
                Sin grupos. Agrega uno para empezar (ej. "Elige tu bebida").
              </div>
            )}

            {grupos.map((g, gi) => {
              const search = (g._search ?? '').toLowerCase();
              const sugerencias = search.length > 0
                ? productosSimples.filter(p =>
                    p.nombre.toLowerCase().includes(search) &&
                    !g.opciones.some(o => o.producto_id === p.id)
                  ).slice(0, 8)
                : [];
              return (
                <Card key={gi} className="border-2">
                  <CardContent className="p-3 space-y-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex-1 min-w-[180px] space-y-1">
                        <Label className="text-xs">Nombre del grupo</Label>
                        <Input value={g.nombre_grupo} onChange={e => updateGrupo(gi, { nombre_grupo: e.target.value })} placeholder="Ej. Elige tu bebida" />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label className="text-xs">Cantidad</Label>
                        <Input type="number" min={1} value={g.cantidad_incluida} onChange={e => updateGrupo(gi, { cantidad_incluida: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div className="flex items-center gap-1 mb-2">
                        <Switch checked={g.es_obligatorio} onCheckedChange={v => updateGrupo(gi, { es_obligatorio: v })} />
                        <Label className="text-xs">Obligatorio</Label>
                      </div>
                      <div className="flex gap-1 mb-1">
                        <Button variant="ghost" size="icon" onClick={() => moveGrupo(gi, -1)} disabled={gi === 0}><ArrowUp className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => moveGrupo(gi, 1)} disabled={gi === grupos.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => removeGrupo(gi)}><X className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>

                    {/* Buscador de opciones */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar producto para agregar..."
                        value={g._search ?? ''}
                        onChange={e => updateGrupo(gi, { _search: e.target.value })}
                        className="pl-9"
                      />
                      {sugerencias.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-popover border rounded-md shadow-md max-h-56 overflow-y-auto">
                          {sugerencias.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => addOpcion(gi, p.id)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between"
                            >
                              <span>{p.nombre}</span>
                              <span className="text-xs text-muted-foreground">{p.categoria}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Lista de opciones */}
                    {g.opciones.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Sin opciones aún.</p>
                    ) : (
                      <div className="space-y-1">
                        {g.opciones.map((o, oi) => (
                          <div key={oi} className="flex items-center gap-2 text-sm border rounded-md p-2">
                            <span className="flex-1 truncate">{o.producto?.nombre ?? '—'}</span>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-muted-foreground">+ $</Label>
                              <Input
                                type="number" min={0} step={0.01}
                                value={o.precio_adicional}
                                onChange={e => updateOpcion(gi, oi, { precio_adicional: parseFloat(e.target.value) || 0 })}
                                className="h-7 w-20 text-sm"
                              />
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeOpcion(gi, oi)}>
                              <X className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {isAdmin && (
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Costo estimado:</span><span>${costoPreview.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Precio:</span><span>${precioPreview.toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold">
                <span>Margen:</span>
                <span className={margenColor(margenPreview)}>{margenPreview.toFixed(1)}%</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de eliminación */}
      <AlertDialog open={!!deleteCandidate} onOpenChange={(o) => { if (!o) { setDeleteCandidate(null); setDeleteBlock(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar paquete</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlock ?? `¿Eliminar permanentemente "${deleteCandidate?.nombre}"? Esta acción no se puede deshacer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {deleteBlock ? (
              <AlertDialogAction onClick={() => deleteCandidate && handleSoftDelete(deleteCandidate)}>
                Desactivar
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                onClick={() => deleteCandidate && handleHardDelete(deleteCandidate)}
              >
                Eliminar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PaquetesDinamicosTab;
