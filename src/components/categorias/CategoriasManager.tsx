import { useState, useEffect } from 'react';
import { DataPagination } from '@/components/ui/data-pagination';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Tag, FlaskConical, Package, Boxes } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

type Ambito = 'insumo' | 'producto' | 'paquete';

interface Categoria {
  id: string;
  nombre: string;
  descripcion: string | null;
  ambito: Ambito;
  uso_insumos?: number;
  uso_productos?: number;
}

interface Props {
  isAdmin: boolean;
  ambitos: Ambito[];
  titulo?: string;
  defaultAmbito?: Ambito;
}

const AMBITO_LABEL: Record<Ambito, string> = {
  insumo: 'Insumo',
  producto: 'Producto',
  paquete: 'Paquete',
};

const AMBITO_PLURAL: Record<Ambito, string> = {
  insumo: 'Insumos',
  producto: 'Productos',
  paquete: 'Paquetes',
};

const AmbitoBadge = ({ ambito }: { ambito: Ambito }) => {
  const map = {
    insumo: { variant: 'secondary' as const, Icon: FlaskConical },
    producto: { variant: 'default' as const, Icon: Package },
    paquete: { variant: 'outline' as const, Icon: Boxes },
  };
  const { variant, Icon } = map[ambito];
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {AMBITO_LABEL[ambito]}
    </Badge>
  );
};

const CategoriasManager = ({ isAdmin, ambitos, titulo, defaultAmbito }: Props) => {
  const { user } = useAuth();
  const singleAmbito = ambitos.length === 1;
  const baseAmbito: Ambito = defaultAmbito ?? ambitos[0];

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ nombre: string; descripcion: string; ambito: Ambito }>({
    nombre: '', descripcion: '', ambito: baseAmbito,
  });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Categoria | null>(null);
  const [filtro, setFiltro] = useState<Ambito>(baseAmbito);

  const fetchCategorias = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('categorias_maestras')
      .select('id, nombre, descripcion, ambito')
      .in('ambito', ambitos)
      .order('nombre');
    const cats = (data as Categoria[]) ?? [];

    const needInsumos = ambitos.includes('insumo');
    const needProductos = ambitos.includes('producto') || ambitos.includes('paquete');

    const [insumosRes, productosRes] = await Promise.all([
      needInsumos
        ? supabase.from('insumos').select('categoria')
        : Promise.resolve({ data: [] as any[] }),
      needProductos
        ? supabase.from('productos').select('categoria')
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const cuentaIns = new Map<string, number>();
    const cuentaProd = new Map<string, number>();
    (insumosRes.data ?? []).forEach((i: any) => cuentaIns.set(i.categoria, (cuentaIns.get(i.categoria) ?? 0) + 1));
    (productosRes.data ?? []).forEach((p: any) => cuentaProd.set(p.categoria, (cuentaProd.get(p.categoria) ?? 0) + 1));

    cats.forEach(c => {
      c.uso_insumos = cuentaIns.get(c.nombre) ?? 0;
      c.uso_productos = cuentaProd.get(c.nombre) ?? 0;
    });

    setCategorias(cats);
    setLoading(false);
  };

  useEffect(() => { fetchCategorias(); /* eslint-disable-next-line */ }, [ambitos.join(',')]);

  const openNew = () => {
    setEditingId(null);
    setForm({ nombre: '', descripcion: '', ambito: singleAmbito ? baseAmbito : (filtro ?? baseAmbito) });
    setDialogOpen(true);
  };

  const openEdit = (cat: Categoria) => {
    setEditingId(cat.id);
    setForm({ nombre: cat.nombre, descripcion: cat.descripcion ?? '', ambito: cat.ambito });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
    if (!form.ambito || !ambitos.includes(form.ambito)) {
      toast.error('Ámbito inválido'); return;
    }
    setSaving(true);
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      ambito: form.ambito,
    };

    if (editingId) {
      const prev = categorias.find(c => c.id === editingId);
      const { error } = await supabase.from('categorias_maestras').update(payload).eq('id', editingId);
      if (error) {
        toast.error(error.message.includes('unique') || error.code === '23505'
          ? `Ya existe una categoría "${payload.nombre}" en el ámbito ${AMBITO_LABEL[payload.ambito]}`
          : 'Error al actualizar');
      } else {
        toast.success('Categoría actualizada');
        if (user) {
          await supabase.from('audit_logs').insert({
            user_id: user.id,
            accion: 'actualizar_categoria',
            descripcion: `Categoría actualizada: "${prev?.nombre ?? ''}" → "${payload.nombre}" [${AMBITO_LABEL[payload.ambito]}]`,
            metadata: { categoria_id: editingId, nombre_anterior: prev?.nombre, ambito_anterior: prev?.ambito, ...payload },
          });
        }
      }
    } else {
      const { data, error } = await supabase.from('categorias_maestras').insert(payload).select('id').single();
      if (error) {
        toast.error(error.message.includes('unique') || error.code === '23505'
          ? `Ya existe una categoría "${payload.nombre}" en el ámbito ${AMBITO_LABEL[payload.ambito]}`
          : 'Error al crear');
      } else {
        toast.success('Categoría creada');
        if (user && data) {
          await supabase.from('audit_logs').insert({
            user_id: user.id,
            accion: 'crear_categoria',
            descripcion: `Categoría creada: ${payload.nombre} [${AMBITO_LABEL[payload.ambito]}]`,
            metadata: { categoria_id: data.id, ...payload },
          });
        }
      }
    }

    setSaving(false);
    setDialogOpen(false);
    fetchCategorias();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const usoActual = deleteTarget.ambito === 'insumo' ? (deleteTarget.uso_insumos ?? 0) : (deleteTarget.uso_productos ?? 0);
    if (usoActual > 0) {
      toast.error('No se puede eliminar: la categoría está en uso');
      setDeleteTarget(null);
      fetchCategorias();
      return;
    }
    const { error } = await supabase.from('categorias_maestras').delete().eq('id', deleteTarget.id);
    if (error) {
      toast.error('Error al eliminar categoría');
    } else {
      toast.success('Categoría eliminada');
      if (user) {
        await supabase.from('audit_logs').insert({
          user_id: user.id,
          accion: 'eliminar_categoria',
          descripcion: `Categoría eliminada: ${deleteTarget.nombre} [${AMBITO_LABEL[deleteTarget.ambito]}]`,
          metadata: {
            categoria_id: deleteTarget.id,
            nombre: deleteTarget.nombre,
            ambito: deleteTarget.ambito,
            uso_insumos: deleteTarget.uso_insumos ?? 0,
            uso_productos: deleteTarget.uso_productos ?? 0,
          },
        });
      }
      fetchCategorias();
    }
    setDeleteTarget(null);
  };

  const visibles = singleAmbito ? categorias : categorias.filter(c => c.ambito === filtro);
  const showAmbitoColumn = !singleAmbito;

  const [paginaActual, setPaginaActual] = useState(1);
  const [porPagina, setPorPagina] = useState(25);
  useEffect(() => { setPaginaActual(1); }, [filtro, porPagina]);
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const paginaSegura = Math.min(paginaActual, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  const visiblesPagina = visibles.slice(inicio, inicio + porPagina);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-heading font-semibold text-foreground">
          {titulo ?? 'Categorías'}
        </h2>
        <div className="flex items-center gap-2">
          {!singleAmbito && (
            <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Ambito)}>
              <TabsList>
                {ambitos.map(a => (
                  <TabsTrigger key={a} value={a}>{AMBITO_PLURAL[a]}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {isAdmin && (
            <Button onClick={openNew} size="sm" className="gap-2">
              <Plus className="h-4 w-4" /> Nueva Categoría
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <TooltipProvider delayDuration={150}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                {showAmbitoColumn && <TableHead>Ámbito</TableHead>}
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">En uso</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando...</TableCell>
                </TableRow>
              ) : visibles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Sin categorías.
                  </TableCell>
                </TableRow>
              ) : visiblesPagina.map(cat => {
                const usoIns = cat.uso_insumos ?? 0;
                const usoProd = cat.uso_productos ?? 0;
                const usoTotal = cat.ambito === 'insumo' ? usoIns : usoProd;
                return (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        {cat.nombre}
                      </div>
                    </TableCell>
                    {showAmbitoColumn && <TableCell><AmbitoBadge ambito={cat.ambito} /></TableCell>}
                    <TableCell className="text-muted-foreground">{cat.descripcion || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usoTotal === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              {cat.ambito === 'insumo'
                                ? <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                                : <Package className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="font-medium text-foreground">{usoTotal}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {usoTotal} {cat.ambito === 'insumo' ? 'insumo' : 'producto'}{usoTotal === 1 ? '' : 's'} usando esta categoría
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(cat)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {usoTotal > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0}>
                                  <Button variant="ghost" size="icon" disabled>
                                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs max-w-xs">
                                No se puede eliminar: hay {usoTotal} {cat.ambito === 'insumo' ? 'insumo' : 'producto'}{usoTotal === 1 ? '' : 's'} usando esta categoría. Renombra la categoría o reasigna los elementos primero.
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(cat)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </TooltipProvider>
        </CardContent>
      </Card>

      <DataPagination
        paginaActual={paginaSegura}
        totalItems={visibles.length}
        porPagina={porPagina}
        onPaginaChange={setPaginaActual}
        onPorPaginaChange={setPorPagina}
        etiqueta="categorías"
      />



      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Categoría' : 'Nueva Categoría'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input
                placeholder="ej. Café, Bebidas, Snacks..."
                value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              />
            </div>
            {!singleAmbito && (
              <div className="space-y-1">
                <Label>Ámbito de la categoría *</Label>
                <Select value={form.ambito} onValueChange={(v) => setForm(f => ({ ...f, ambito: v as Ambito }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un ámbito" />
                  </SelectTrigger>
                  <SelectContent>
                    {ambitos.map(a => (
                      <SelectItem key={a} value={a}>{AMBITO_LABEL[a]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Define dónde aparecerá esta categoría.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label>Descripción (opcional)</Label>
              <Input
                placeholder="Descripción breve de la categoría"
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar categoría</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar la categoría "{deleteTarget?.nombre}"? Esta acción no se puede deshacer.
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

export default CategoriasManager;
