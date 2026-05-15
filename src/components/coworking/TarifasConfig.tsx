import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Package, Copy } from 'lucide-react';
import type { Area } from './types';

interface Tarifa {
  id: string;
  nombre: string;
  tipo_cobro: string;
  precio_base: number;
  areas_aplicables: string[];
  activo: boolean;
  metodo_fraccion: string;
  minutos_tolerancia: number;
}

const METODO_FRACCION_LABELS: Record<string, string> = {
  sin_cobro: 'Sin cobrar fracción extra',
  hora_cerrada: 'Hora Cerrada',
  '30_min': 'Bloques de 30 min',
  '15_min': 'Bloques de 15 min',
  minuto_exacto: 'Minuto Exacto',
};

interface Amenity {
  id?: string;
  producto_id: string;
  cantidad_incluida: number;
}

interface Upsell {
  id?: string;
  producto_id: string;
  precio_especial: number;
}

interface Producto {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number;
  precio_upsell_coworking: number | null;
}

const TIPO_COBRO_LABELS: Record<string, string> = {
  hora: 'Por Hora',
  dia: 'Por Día',
  mes: 'Mensual',
  paquete_horas: 'Paquete de Horas',
};

export function TarifasConfig({ areas }: { areas: Area[] }) {
  const { toast } = useToast();
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [allProductos, setAllProductos] = useState<Producto[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [nombre, setNombre] = useState('');
  const [tipoCobro, setTipoCobro] = useState('hora');
  const [precioBase, setPrecioBase] = useState('');
  const [areasSeleccionadas, setAreasSeleccionadas] = useState<string[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [upsells, setUpsells] = useState<Upsell[]>([]);
  const [metodoFraccion, setMetodoFraccion] = useState<string>('15_min');
  const [minutosTolerancia, setMinutosTolerancia] = useState<string>('5');

  const fetchData = useCallback(async () => {
    const [tarifasRes, productosRes] = await Promise.all([
      supabase.from('tarifas_coworking').select('*').order('nombre'),
      supabase.from('productos').select('id, nombre, categoria, precio_venta, precio_upsell_coworking').eq('activo', true).eq('tipo', 'simple').order('nombre'),
    ]);
    const allProds = (productosRes.data as Producto[]) ?? [];
    setAllProductos(allProds);
    setProductos(allProds);
    setTarifas((tarifasRes.data as Tarifa[]) ?? []);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetForm = () => {
    setNombre('');
    setTipoCobro('hora');
    setPrecioBase('');
    setAreasSeleccionadas([]);
    setAmenities([]);
    setUpsells([]);
    setMetodoFraccion('15_min');
    setMinutosTolerancia('5');
    setEditingId(null);
  };

  const openNew = () => { resetForm(); setDialogOpen(true); };

  const openEdit = async (tarifa: Tarifa) => {
    setEditingId(tarifa.id);
    setNombre(tarifa.nombre);
    setTipoCobro(tarifa.tipo_cobro);
    setPrecioBase(String(tarifa.precio_base));
    setAreasSeleccionadas(tarifa.areas_aplicables ?? []);
    setMetodoFraccion(tarifa.metodo_fraccion ?? '15_min');
    setMinutosTolerancia(String(tarifa.minutos_tolerancia ?? 5));

    const [amenitiesRes, upsellsRes] = await Promise.all([
      supabase.from('tarifa_amenities_incluidos').select('id, producto_id, cantidad_incluida').eq('tarifa_id', tarifa.id),
      supabase.from('tarifa_upsells').select('id, producto_id, precio_especial').eq('tarifa_id', tarifa.id),
    ]);
    setAmenities((amenitiesRes.data as Amenity[]) ?? []);
    setUpsells((upsellsRes.data as Upsell[]) ?? []);
    setDialogOpen(true);
  };

  const toggleArea = (areaId: string) => {
    setAreasSeleccionadas(prev =>
      prev.includes(areaId) ? prev.filter(id => id !== areaId) : [...prev, areaId]
    );
  };

  const addAmenity = () => setAmenities(prev => [...prev, { producto_id: '', cantidad_incluida: 1 }]);
  const removeAmenity = (idx: number) => setAmenities(prev => prev.filter((_, i) => i !== idx));

  const addUpsell = () => setUpsells(prev => [...prev, { producto_id: '', precio_especial: 0 }]);
  const removeUpsell = (idx: number) => setUpsells(prev => prev.filter((_, i) => i !== idx));

  // Products already used as amenities (to exclude from upsell selection and vice-versa)
  const amenityProductIds = new Set(amenities.map(a => a.producto_id).filter(Boolean));
  const upsellProductIds = new Set(upsells.map(u => u.producto_id).filter(Boolean));
  // Only products with a defined upsell price are eligible for upsell selection
  const upsellEligibleProducts = allProductos.filter(p => p.precio_upsell_coworking != null && p.precio_upsell_coworking > 0);

  const handleSave = async () => {
    if (!nombre.trim() || !precioBase) {
      toast({ variant: 'destructive', title: 'Completa nombre y precio base' });
      return;
    }
    setSaving(true);

    const payload = {
      nombre: nombre.trim(),
      tipo_cobro: tipoCobro as 'hora' | 'dia' | 'mes' | 'paquete_horas',
      precio_base: parseFloat(precioBase) || 0,
      areas_aplicables: areasSeleccionadas,
      metodo_fraccion: metodoFraccion,
      minutos_tolerancia: Math.max(0, parseInt(minutosTolerancia) || 0),
    };

    let tarifaId = editingId;

    if (editingId) {
      const { error } = await supabase.from('tarifas_coworking').update(payload).eq('id', editingId);
      if (error) { toast({ variant: 'destructive', title: 'Error al actualizar tarifa', description: error.message }); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('tarifas_coworking').insert(payload).select('id').single();
      if (error || !data) { toast({ variant: 'destructive', title: 'Error al crear tarifa', description: error?.message }); setSaving(false); return; }
      tarifaId = data.id;
    }

    // Sync amenities
    await supabase.from('tarifa_amenities_incluidos').delete().eq('tarifa_id', tarifaId!);
    const validAmenities = amenities.filter(a => a.producto_id);
    if (validAmenities.length > 0) {
      await supabase.from('tarifa_amenities_incluidos').insert(
        validAmenities.map(a => ({ tarifa_id: tarifaId!, producto_id: a.producto_id, cantidad_incluida: a.cantidad_incluida }))
      );
    }

    // Sync upsells — always use current precio_upsell_coworking from productos
    await supabase.from('tarifa_upsells').delete().eq('tarifa_id', tarifaId!);
    const validUpsells = upsells.filter(u => u.producto_id);
    if (validUpsells.length > 0) {
      const syncedUpsells = validUpsells.map(u => {
        const prod = allProductos.find(p => p.id === u.producto_id);
        return {
          tarifa_id: tarifaId!,
          producto_id: u.producto_id,
          precio_especial: prod?.precio_upsell_coworking ?? u.precio_especial,
        };
      });
      await supabase.from('tarifa_upsells').insert(syncedUpsells);
    }

    toast({ title: editingId ? 'Tarifa actualizada' : 'Tarifa creada' });
    setDialogOpen(false);
    resetForm();
    fetchData();
    setSaving(false);
  };

  const handleDuplicate = async (tarifa: Tarifa) => {
    setEditingId(null);
    setNombre(`${tarifa.nombre} (copia)`);
    setTipoCobro(tarifa.tipo_cobro);
    setPrecioBase(String(tarifa.precio_base));
    setAreasSeleccionadas(tarifa.areas_aplicables ?? []);
    setMetodoFraccion(tarifa.metodo_fraccion ?? '15_min');
    setMinutosTolerancia(String(tarifa.minutos_tolerancia ?? 5));

    const [amenitiesRes, upsellsRes] = await Promise.all([
      supabase.from('tarifa_amenities_incluidos').select('id, producto_id, cantidad_incluida').eq('tarifa_id', tarifa.id),
      supabase.from('tarifa_upsells').select('id, producto_id, precio_especial').eq('tarifa_id', tarifa.id),
    ]);
    setAmenities((amenitiesRes.data as Amenity[]) ?? []);
    setUpsells((upsellsRes.data as Upsell[]) ?? []);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('tarifas_coworking').delete().eq('id', id);
    if (error) toast({ variant: 'destructive', title: 'Error al eliminar tarifa' });
    else { toast({ title: 'Tarifa eliminada' }); fetchData(); }
  };

  const getAreaName = (id: string) => areas.find(a => a.id === id)?.nombre_area ?? id;
  const getProductName = (id: string) => productos.find(p => p.id === id)?.nombre ?? id;

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Package className="h-5 w-5" />Tarifas y Paquetes
        </CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nueva Tarifa</Button>
      </CardHeader>
      <CardContent>
        {tarifas.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">No hay tarifas configuradas aún.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Precio Base</TableHead>
                <TableHead>Áreas</TableHead>
                <TableHead className="w-24">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tarifas.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.nombre}</TableCell>
                  <TableCell>{TIPO_COBRO_LABELS[t.tipo_cobro] ?? t.tipo_cobro}</TableCell>
                  <TableCell>${t.precio_base.toFixed(2)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(t.areas_aplicables ?? []).map(aId => (
                        <Badge key={aId} variant="secondary" className="text-xs">{getAreaName(aId)}</Badge>
                      ))}
                      {(!t.areas_aplicables || t.areas_aplicables.length === 0) && (
                        <span className="text-muted-foreground text-xs">Todas</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" title="Duplicar tarifa" onClick={() => handleDuplicate(t)}><Copy className="h-4 w-4 text-muted-foreground" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl lg:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60 shrink-0">
            <DialogTitle>{editingId ? 'Editar Tarifa' : 'Nueva Tarifa'}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {/* === Columna Izquierda: Configuración base === */}
              <div className="space-y-5">
            {/* Nombre */}
            <div>
              <Label>Nombre de la Tarifa</Label>
              <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej. Cowork Básico, Consultorio Privado" />
            </div>

            {/* Tipo + Precio */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Precio por Tiempo</Label>
                <Select value={tipoCobro} onValueChange={setTipoCobro}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIPO_COBRO_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Precio Base ($)</Label>
                <Input type="number" min={0} step={5} value={precioBase} onChange={e => setPrecioBase(e.target.value)} />
              </div>
            </div>

            {/* Fracción extra + Tolerancia */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Modo de Fracción Extra</Label>
                <Select value={metodoFraccion} onValueChange={setMetodoFraccion}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(METODO_FRACCION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Minutos de Tolerancia (Gracia)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={minutosTolerancia}
                  onChange={e => setMinutosTolerancia(e.target.value)}
                />
              </div>
            </div>

            {/* Áreas */}
            <div>
              <Label className="mb-2 block">Áreas Aplicables</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {areas.map(area => (
                  <label key={area.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={areasSeleccionadas.includes(area.id)}
                      onCheckedChange={() => toggleArea(area.id)}
                    />
                    {area.nombre_area}
                  </label>
                ))}
              </div>
            </div>
              </div>

              {/* === Columna Derecha: Amenities + Upsells === */}
              <div className="space-y-5">
            {/* Amenities */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Amenities Incluidos (Costo $0)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addAmenity}>
                  <Plus className="mr-1 h-3 w-3" />Agregar
                </Button>
              </div>
              {amenities.length === 0 && (
                <p className="text-muted-foreground text-xs">Sin amenities incluidos en esta tarifa.</p>
              )}
              {amenities.map((a, idx) => (
                <div key={idx} className="flex items-center gap-2 mb-2">
                  <Select value={a.producto_id} onValueChange={v => setAmenities(prev => prev.map((x, i) => i === idx ? { ...x, producto_id: v } : x))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Seleccionar producto" /></SelectTrigger>
                    <SelectContent>
                      {productos.filter(p => !upsellProductIds.has(p.id) || p.id === a.producto_id).map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    className="w-16"
                    value={a.cantidad_incluida}
                    onChange={e => setAmenities(prev => prev.map((x, i) => i === idx ? { ...x, cantidad_incluida: parseInt(e.target.value) || 1 } : x))}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeAmenity(idx)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Upsells */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Productos con Precio Especial (Upsells)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addUpsell}>
                  <Plus className="mr-1 h-3 w-3" />Agregar
                </Button>
              </div>
              <p className="text-muted-foreground text-xs mb-2">
                Productos que cambian a un precio preferencial cuando el cliente usa esta tarifa.
              </p>
              {upsells.length === 0 && (
                <p className="text-muted-foreground text-xs">Sin productos con precio especial en esta tarifa.</p>
              )}
              {upsellEligibleProducts.length === 0 && upsells.length === 0 && (
                <p className="text-muted-foreground text-xs italic">No hay productos con Precio Especial configurado en Inventarios.</p>
              )}
              {upsells.map((u, idx) => {
                const prod = allProductos.find(p => p.id === u.producto_id);
                return (
                  <div key={idx} className="flex items-center gap-2 mb-2">
                    <Select value={u.producto_id} onValueChange={v => {
                      const selected = allProductos.find(p => p.id === v);
                      const autoPrice = selected?.precio_upsell_coworking ?? 0;
                      setUpsells(prev => prev.map((x, i) => i === idx ? { ...x, producto_id: v, precio_especial: autoPrice } : x));
                    }}>
                      <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder="Seleccionar producto" /></SelectTrigger>
                      <SelectContent>
                        {upsellEligibleProducts.filter(p => !amenityProductIds.has(p.id) || p.id === u.producto_id).map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="truncate">{p.nombre}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs font-medium whitespace-nowrap">${u.precio_especial.toFixed(2)}</span>
                    </div>
                    {prod && (
                      <span className="text-xs text-muted-foreground line-through whitespace-nowrap">${prod.precio_venta.toFixed(2)}</span>
                    )}
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeUpsell(idx)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border/60 shrink-0 bg-background">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
