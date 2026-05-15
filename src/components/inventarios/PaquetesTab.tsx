import { useState, useEffect, useCallback, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCategorias } from '@/hooks/useCategorias';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, Package, Copy, Search, X, AlertTriangle, Upload, Loader2, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface ProductoSimple {
  id: string;
  nombre: string;
  categoria: string;
  costo_total: number;
  precio_venta: number;
  activo: boolean;
}

interface ComponenteLine {
  id?: string;
  producto_id: string;
  cantidad: number;
  producto?: ProductoSimple;
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
}

const emptyForm = { nombre: '', categoria: '', precio_venta: '', imagen_url: '', instrucciones_preparacion: '' };

interface Props { isAdmin: boolean }

const PaquetesTab = ({ isAdmin }: Props) => {
  const { categorias: CATEGORIAS } = useCategorias('paquete');
  const { user } = useAuth();

  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [productosSimples, setProductosSimples] = useState<ProductoSimple[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [componentes, setComponentes] = useState<ComponenteLine[]>([]);
  const [newLine, setNewLine] = useState({ producto_id: '', cantidad: '1' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedComponentes, setExpandedComponentes] = useState<Record<string, ComponenteLine[]>>({});
  const [saving, setSaving] = useState(false);
  // M3: subida de imagen al bucket "productos" (mismo patrón que ProductosTab)
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagenesPendientesEliminar, setImagenesPendientesEliminar] = useState<string[]>([]);

  const extraerPathProducto = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const marker = '/storage/v1/object/public/productos/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return url.substring(idx + marker.length).split('?')[0];
  };

  const eliminarImagenesStorage = async (urls: string[]) => {
    const paths = urls.map(extraerPathProducto).filter((p): p is string => !!p);
    if (paths.length === 0) return;
    await supabase.storage.from('productos').remove(paths);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) { toast.error('Formato no válido. Usa PNG, JPG o WEBP.'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('La imagen excede el límite de 2 MB.'); return; }
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `paquete-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('productos').upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('productos').getPublicUrl(path);
      const previa = form.imagen_url;
      if (previa && extraerPathProducto(previa)) {
        setImagenesPendientesEliminar(prev => [...prev, previa]);
      }
      setForm(f => ({ ...f, imagen_url: data.publicUrl }));
      toast.success('Imagen subida');
    } catch (err: any) {
      toast.error(err?.message || 'Error al subir imagen');
    } finally {
      setUploadingImage(false);
    }
  };

  const fetchPaquetes = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('productos').select('*').eq('tipo', 'paquete').order('nombre');
    setPaquetes((data as Paquete[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPaquetes();
    supabase.from('productos').select('id, nombre, categoria, costo_total, precio_venta, activo')
      .eq('tipo', 'simple').eq('activo', true).order('nombre')
      .then(({ data }) => setProductosSimples((data as ProductoSimple[]) ?? []));
  }, [fetchPaquetes]);

  const calcCosto = (lines: ComponenteLine[]) =>
    lines.reduce((sum, l) => {
      const prod = productosSimples.find(p => p.id === l.producto_id);
      return sum + (prod ? prod.costo_total * l.cantidad : 0);
    }, 0);

  const calcMargen = (precio: number, costo: number) =>
    precio > 0 ? ((precio - costo) / precio) * 100 : 0;

  const margenColor = (m: number) =>
    m > 40 ? 'text-green-600' : m >= 20 ? 'text-yellow-600' : 'text-destructive';

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setComponentes([]);
    setNewLine({ producto_id: '', cantidad: '1' });
    setImagenesPendientesEliminar([]);
    setDialogOpen(true);
  };

  const loadComponentes = async (paqueteId: string): Promise<ComponenteLine[]> => {
    const { data } = await supabase
      .from('paquete_componentes')
      .select('id, producto_id, cantidad, productos:producto_id(id, nombre, categoria, costo_total, precio_venta, activo)')
      .eq('paquete_id', paqueteId);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      producto_id: r.producto_id,
      cantidad: Number(r.cantidad),
      producto: r.productos,
    }));
  };

  const openEdit = async (p: Paquete) => {
    setEditingId(p.id);
    setImagenesPendientesEliminar([]);
    setForm({
      nombre: p.nombre,
      categoria: p.categoria,
      precio_venta: String(p.precio_venta),
      imagen_url: p.imagen_url ?? '',
      instrucciones_preparacion: p.instrucciones_preparacion ?? '',
    });
    setComponentes(await loadComponentes(p.id));
    setNewLine({ producto_id: '', cantidad: '1' });
    setDialogOpen(true);
  };

  const handleDuplicate = async (p: Paquete) => {
    const lines = await loadComponentes(p.id);
    setEditingId(null);
    setForm({
      nombre: `Copia de ${p.nombre}`,
      categoria: p.categoria,
      precio_venta: String(p.precio_venta),
      imagen_url: p.imagen_url ?? '',
      instrucciones_preparacion: p.instrucciones_preparacion ?? '',
    });
    setComponentes(lines.map(l => ({ producto_id: l.producto_id, cantidad: l.cantidad, producto: l.producto })));
    setNewLine({ producto_id: '', cantidad: '1' });
    setDialogOpen(true);

    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'duplicar_paquete',
        descripcion: `Duplicación iniciada desde paquete: ${p.nombre}`,
        metadata: { paquete_base_id: p.id, paquete_base_nombre: p.nombre },
      });
    }
  };

  const addLine = () => {
    if (!newLine.producto_id || !newLine.cantidad) {
      toast.error('Selecciona producto y cantidad');
      return;
    }
    const cantidad = parseInt(newLine.cantidad, 10);
    if (isNaN(cantidad) || cantidad <= 0) { toast.error('La cantidad debe ser un entero mayor a 0'); return; }
    const prod = productosSimples.find(p => p.id === newLine.producto_id)!;

    setComponentes(c => {
      const existing = c.find(l => l.producto_id === newLine.producto_id);
      if (existing) {
        return c.map(l => l.producto_id === newLine.producto_id
          ? { ...l, cantidad: l.cantidad + cantidad }
          : l);
      }
      return [...c, { producto_id: newLine.producto_id, cantidad, producto: prod }];
    });
    setNewLine({ producto_id: '', cantidad: '1' });
  };

  const removeLine = (idx: number) => setComponentes(c => c.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
    if (componentes.length === 0) { toast.error('Agrega al menos un producto al paquete'); return; }
    // Validar enteros y componentes activos
    for (const c of componentes) {
      if (!Number.isInteger(c.cantidad) || c.cantidad <= 0) {
        toast.error(`Cantidad inválida en componente: ${c.producto?.nombre ?? c.producto_id}`);
        return;
      }
      const prod = productosSimples.find(p => p.id === c.producto_id);
      if (!prod || !prod.activo) {
        toast.error(`El componente "${c.producto?.nombre ?? '—'}" está inactivo o eliminado. Elimínalo del paquete.`);
        return;
      }
    }

    setSaving(true);
    const precio = parseFloat(form.precio_venta) || 0;
    const costo = calcCosto(componentes);
    const margen = calcMargen(precio, costo);

    const payload = {
      nombre: form.nombre.trim(),
      categoria: form.categoria || 'Paquetes',
      precio_venta: precio,
      costo_total: costo,
      margen,
      imagen_url: form.imagen_url || null,
      instrucciones_preparacion: form.instrucciones_preparacion.trim() || null,
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

    await supabase.from('paquete_componentes').delete().eq('paquete_id', paqueteId!);
    const { error: compErr } = await supabase.from('paquete_componentes').insert(
      componentes.map(c => ({
        paquete_id: paqueteId!,
        producto_id: c.producto_id,
        cantidad: c.cantidad,
      }))
    );
    if (compErr) {
      toast.error('Error al guardar componentes del paquete');
      // Rollback: si era un paquete nuevo, eliminar el producto huérfano
      if (isNew && paqueteId) {
        await supabase.from('productos').delete().eq('id', paqueteId);
      }
      setSaving(false);
      return;
    }

    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: editingId ? 'actualizar_paquete' : 'crear_paquete',
        descripcion: `${editingId ? 'Actualización' : 'Creación'} de paquete: ${payload.nombre}`,
        metadata: { paquete_id: paqueteId, ...payload, num_componentes: componentes.length },
      });
    }

    // M3: limpiar imágenes huérfanas en storage tras guardar correctamente
    if (imagenesPendientesEliminar.length > 0) {
      await eliminarImagenesStorage(imagenesPendientesEliminar);
      setImagenesPendientesEliminar([]);
    }

    toast.success(`Paquete ${editingId ? 'actualizado' : 'creado'}`);
    setSaving(false);
    setDialogOpen(false);
    fetchPaquetes();
  };

  const [deleteCandidate, setDeleteCandidate] = useState<Paquete | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<string | null>(null);
  const [hasSalesHistory, setHasSalesHistory] = useState(false);

  const checkAndPromptDelete = async (p: Paquete) => {
    setDeleteBlock(null);
    setHasSalesHistory(false);

    const ventasRes = await supabase
      .from('detalle_ventas')
      .select('id', { count: 'exact', head: true })
      .eq('paquete_id', p.id);

    const tieneVentas = (ventasRes.count ?? 0) > 0;

    if (tieneVentas) {
      setHasSalesHistory(true);
      setDeleteBlock(
        `"${p.nombre}" tiene historial transaccional (${ventasRes.count} venta(s)). Para preservar la trazabilidad de reportes, no se puede eliminar físicamente. Puedes desactivarlo: dejará de aparecer en POS, pero conservará su historial.`
      );
      setDeleteCandidate(p);
      return;
    }

    setDeleteCandidate(p);
  };

  const handleSoftDelete = async (p: Paquete) => {
    const { error } = await supabase.from('productos').update({ activo: false }).eq('id', p.id);
    if (error) {
      toast.error('Error al desactivar paquete');
      return;
    }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'desactivar_paquete',
        descripcion: `Paquete desactivado (soft delete): ${p.nombre}`,
        metadata: { paquete_id: p.id, paquete_nombre: p.nombre, motivo: 'tiene_historial_transaccional' },
      });
    }
    toast.success('Paquete desactivado');
    fetchPaquetes();
  };

  const handleDelete = async (p: Paquete) => {
    const imagenPrevia = p.imagen_url ?? null;
    await supabase.from('paquete_componentes').delete().eq('paquete_id', p.id);
    const { error } = await supabase.from('productos').delete().eq('id', p.id);
    if (error) {
      toast.error('Error al eliminar paquete');
      return;
    }
    // M3: si tenía imagen propia en el bucket, eliminarla
    if (imagenPrevia && extraerPathProducto(imagenPrevia)) {
      await eliminarImagenesStorage([imagenPrevia]);
    }
    if (user) {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        accion: 'eliminar_paquete',
        descripcion: `Eliminación de paquete: ${p.nombre}`,
        metadata: { paquete_id: p.id, paquete_nombre: p.nombre },
      });
    }
    toast.success('Paquete eliminado');
    fetchPaquetes();
  };

  const toggleComponentes = async (paqueteId: string) => {
    if (expandedId === paqueteId) { setExpandedId(null); return; }
    const lines = await loadComponentes(paqueteId);
    setExpandedComponentes(prev => ({ ...prev, [paqueteId]: lines }));
    setExpandedId(paqueteId);
  };

  const costoPreview = calcCosto(componentes);
  const precioPreview = parseFloat(form.precio_venta) || 0;
  const margenPreview = calcMargen(precioPreview, costoPreview);

  const filtrados = paquetes.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.categoria.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-heading font-semibold text-foreground flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Paquetes (Combos)
          </h2>
          <p className="text-xs text-muted-foreground">Combina productos existentes en un combo. Al venderse descuenta automáticamente el inventario de cada componente.</p>
        </div>
        {isAdmin && (
          <Button onClick={openNew} size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> Nuevo Paquete
          </Button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar paquete..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paquete</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                {isAdmin && <TableHead className="text-right">Costo</TableHead>}
                {isAdmin && <TableHead className="text-right">Margen</TableHead>}
                <TableHead>Componentes</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Cargando...</TableCell></TableRow>
              ) : filtrados.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{busqueda ? 'Sin resultados' : 'Sin paquetes registrados'}</TableCell></TableRow>
              ) : filtrados.map(p => {
                const compsExp = expandedComponentes[p.id];
                const hasInactive = compsExp?.some(c => !c.producto || c.producto.activo === false);
                return (
                <Fragment key={p.id}>
                  <TableRow>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {p.nombre}
                        {hasInactive && (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <AlertTriangle className="h-3 w-3" /> Componente inactivo
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{p.categoria}</Badge></TableCell>
                    <TableCell className="text-right font-mono">${p.precio_venta.toFixed(2)}</TableCell>
                    {isAdmin && <TableCell className="text-right font-mono text-muted-foreground">${p.costo_total.toFixed(2)}</TableCell>}
                    {isAdmin && (
                      <TableCell className="text-right">
                        <span className={`font-mono font-semibold ${margenColor(p.margen)}`}>{p.margen.toFixed(1)}%</span>
                      </TableCell>
                    )}
                    <TableCell>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 text-xs" onClick={() => toggleComponentes(p.id)}>
                        <Package className="h-3 w-3" />
                        {expandedId === p.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleDuplicate(p)} title="Duplicar">
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => checkAndPromptDelete(p)} title="Eliminar">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  {expandedId === p.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/30 py-3 px-6">
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Componentes del paquete:</p>
                        {(expandedComponentes[p.id] ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">Sin componentes</p>
                        ) : (
                          <ul className="space-y-1">
                            {(expandedComponentes[p.id] ?? []).map((c, i) => {
                              const isInactive = !c.producto || c.producto.activo === false;
                              return (
                                <li key={i} className="text-sm flex items-center gap-2">
                                  <Badge variant="outline" className="font-mono text-[10px]">{c.cantidad}x</Badge>
                                  <span className={isInactive ? 'text-destructive' : ''}>{c.producto?.nombre ?? '— (eliminado)'}</span>
                                  {isInactive && <Badge variant="destructive" className="text-[10px]">Inactivo</Badge>}
                                  {isAdmin && c.producto && (
                                    <span className="text-xs text-muted-foreground ml-auto font-mono">
                                      Costo: ${(c.producto.costo_total * c.cantidad).toFixed(2)}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Paquete' : 'Nuevo Paquete'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Combo Desayuno" />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={form.categoria} onValueChange={v => setForm(f => ({ ...f, categoria: v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Precio de venta *</Label>
                <Input type="number" min={0} step={0.01} value={form.precio_venta}
                  onChange={e => setForm(f => ({ ...f, precio_venta: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Imagen del paquete (opcional)</Label>
                <div className="flex items-center gap-3">
                  <div className="h-20 w-20 shrink-0 rounded-md border bg-muted overflow-hidden flex items-center justify-center">
                    {form.imagen_url ? (
                      <img src={form.imagen_url} alt="Vista previa" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground opacity-50" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleImageUpload}
                        disabled={uploadingImage}
                      />
                      <Button type="button" variant="outline" size="sm" disabled={uploadingImage} asChild>
                        <span className="cursor-pointer">
                          {uploadingImage ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Subiendo…</>
                          ) : (
                            <><Upload className="h-4 w-4 mr-2" />{form.imagen_url ? 'Cambiar imagen' : 'Subir imagen'}</>
                          )}
                        </span>
                      </Button>
                    </label>
                    {form.imagen_url && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const previa = form.imagen_url;
                          if (previa && extraerPathProducto(previa)) {
                            setImagenesPendientesEliminar(prev => [...prev, previa]);
                          }
                          setForm(f => ({ ...f, imagen_url: '' }));
                        }}
                        disabled={uploadingImage}
                      >
                        <X className="h-4 w-4 mr-2" />Quitar
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">PNG, JPG o WEBP · máx. 2 MB</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notas / instrucciones (opcional)</Label>
              <Textarea rows={2} value={form.instrucciones_preparacion}
                onChange={e => setForm(f => ({ ...f, instrucciones_preparacion: e.target.value }))} />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-base">Productos del paquete</Label>
              <div className="grid grid-cols-[1fr_100px_auto] gap-2 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Producto</Label>
                  <Select value={newLine.producto_id} onValueChange={v => setNewLine(l => ({ ...l, producto_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecciona un producto..." /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {productosSimples.map(prod => (
                        <SelectItem key={prod.id} value={prod.id}>
                          {prod.nombre} <span className="text-xs text-muted-foreground">— {prod.categoria}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cantidad</Label>
                  <Input type="number" min={1} step={1} value={newLine.cantidad}
                    onChange={e => setNewLine(l => ({ ...l, cantidad: e.target.value }))} />
                </div>
                <Button type="button" onClick={addLine} className="gap-1">
                  <Plus className="h-4 w-4" /> Añadir
                </Button>
              </div>

              {componentes.length > 0 && (
                <div className="border border-border rounded-md mt-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right w-24">Cantidad</TableHead>
                        {isAdmin && <TableHead className="text-right w-28">Costo línea</TableHead>}
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentes.map((c, i) => {
                        const prod = c.producto ?? productosSimples.find(p => p.id === c.producto_id);
                        const costoLinea = (prod?.costo_total ?? 0) * c.cantidad;
                        return (
                          <TableRow key={i}>
                            <TableCell>{prod?.nombre ?? '—'}</TableCell>
                            <TableCell className="text-right font-mono">{c.cantidad}</TableCell>
                            {isAdmin && <TableCell className="text-right font-mono text-muted-foreground">${costoLinea.toFixed(2)}</TableCell>}
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(i)}>
                                <X className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="grid grid-cols-3 gap-3 p-3 rounded-md border border-border bg-muted/30">
                <div>
                  <p className="text-xs text-muted-foreground">Costo total</p>
                  <p className="font-mono font-semibold">${costoPreview.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Precio venta</p>
                  <p className="font-mono font-semibold">${precioPreview.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Margen</p>
                  <p className={`font-mono font-semibold ${margenColor(margenPreview)}`}>{margenPreview.toFixed(1)}%</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar Paquete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteCandidate} onOpenChange={(o) => { if (!o) { setDeleteCandidate(null); setDeleteBlock(null); setHasSalesHistory(false); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasSalesHistory ? `Desactivar "${deleteCandidate?.nombre}"` : 'Eliminar paquete'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlock ?? `¿Eliminar el paquete "${deleteCandidate?.nombre}"? Esta acción no se puede deshacer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {hasSalesHistory ? (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  if (deleteCandidate) await handleSoftDelete(deleteCandidate);
                  setDeleteCandidate(null);
                  setDeleteBlock(null);
                  setHasSalesHistory(false);
                }}
              >
                Desactivar paquete
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  if (deleteCandidate) await handleDelete(deleteCandidate);
                  setDeleteCandidate(null);
                }}
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

export default PaquetesTab;
