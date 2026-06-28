import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataPagination } from '@/components/ui/data-pagination';
import { Loader2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import type { Cliente } from './types';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

interface ClienteRow extends Cliente {
  created_at: string;
}

const clienteSchema = z.object({
  nombre_completo: z.string().trim().min(1, 'El nombre es obligatorio').max(120, 'Máximo 120 caracteres'),
  telefono: z
    .string()
    .trim()
    .max(20, 'Máximo 20 caracteres')
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || v.replace(/\D/g, '').length === 10,
      'El teléfono debe tener 10 dígitos',
    ),
  email: z
    .string()
    .trim()
    .max(255, 'Máximo 255 caracteres')
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'El email debe incluir una @ válida',
    ),
});

const PAGE_SIZE_DEFAULT = 20;

export function DirectorioClientesTab() {
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  // Edit/create dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ClienteRow | null>(null);
  const [form, setForm] = useState({ nombre_completo: '', telefono: '', email: '' });
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [toDelete, setToDelete] = useState<ClienteRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchClientes = async () => {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre_completo, email, telefono, created_at')
      .order('nombre_completo', { ascending: true });
    if (error) {
      toast.error('Error al cargar clientes', { description: error.message });
      setClientes([]);
    } else {
      setClientes((data ?? []) as ClienteRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchClientes();
    const channel = supabase
      .channel('directorio-clientes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clientes' },
        () => fetchClientes(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      [c.nombre_completo, c.telefono ?? '', c.email ?? '']
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [clientes, query]);

  useEffect(() => { setPage(1); }, [query, pageSize]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const openCreate = () => {
    setEditing(null);
    setForm({ nombre_completo: '', telefono: '', email: '' });
    setEditOpen(true);
  };

  const openEdit = (c: ClienteRow) => {
    setEditing(c);
    setForm({
      nombre_completo: c.nombre_completo,
      telefono: c.telefono ?? '',
      email: c.email ?? '',
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    const parsed = clienteSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    const payload = {
      nombre_completo: parsed.data.nombre_completo,
      telefono: parsed.data.telefono ? parsed.data.telefono : null,
      email: parsed.data.email ? parsed.data.email : null,
    };
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from('clientes')
        .update(payload)
        .eq('id', editing.id);
      setSaving(false);
      if (error) {
        toast.error('No se pudo actualizar', { description: error.message });
        return;
      }
      toast.success('Cliente actualizado');
    } else {
      const { error } = await supabase.from('clientes').insert(payload);
      setSaving(false);
      if (error) {
        toast.error('No se pudo crear', { description: error.message });
        return;
      }
      toast.success('Cliente creado');
    }
    setEditOpen(false);
    fetchClientes();
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await supabase.from('clientes').delete().eq('id', toDelete.id);
    setDeleting(false);
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message });
      return;
    }
    toast.success('Cliente eliminado');
    setToDelete(null);
    fetchClientes();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-heading font-bold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Directorio de clientes
          </h2>
          <p className="text-sm text-muted-foreground">
            Administra el catálogo de clientes recurrentes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, teléfono o email"
              className="pl-8 w-64"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo cliente
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead className="w-24 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando...
                </TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {query.trim()
                    ? `Sin resultados para "${query.trim()}"`
                    : 'Sin clientes registrados'}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nombre_completo}</TableCell>
                  <TableCell className="text-muted-foreground">{c.telefono ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {c.created_at ? formatDate(c.created_at) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(c)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setToDelete(c)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
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
        etiqueta="clientes"
        opcionesPorPagina={[10, 20, 50, 100]}
      />

      {/* Create / Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Actualiza los datos de contacto del cliente.'
                : 'Registra un cliente nuevo. Solo el nombre es obligatorio.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dir-nombre">Nombre completo *</Label>
              <Input
                id="dir-nombre"
                value={form.nombre_completo}
                onChange={(e) => setForm((f) => ({ ...f, nombre_completo: e.target.value }))}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dir-tel">Teléfono</Label>
              <Input
                id="dir-tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                inputMode="tel"
                maxLength={30}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dir-email">Email</Label>
              <Input
                id="dir-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.nombre_completo.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editing ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cliente</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que quieres eliminar a <strong>{toDelete?.nombre_completo}</strong>? Esta
              acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
