import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ChevronsUpDown, Loader2, Plus, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Cliente } from './types';
import { clienteRequiredSchema } from './clienteSchema';

interface ClienteSelectorProps {
  value: { id: string; nombre_completo: string } | null;
  onChange: (cliente: Cliente | null) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function ClienteSelector({
  value,
  onChange,
  disabled,
  placeholder = 'Buscar o crear cliente...',
  autoFocus,
}: ClienteSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(false);

  // Mini-diálogo de creación rápida (vive FUERA del Popover)
  const [miniDialogOpen, setMiniDialogOpen] = useState(false);
  const [form, setForm] = useState({ nombre_completo: '', telefono: '', email: '' });
  const [creating, setCreating] = useState(false);

  // Búsqueda debounced
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      let q = supabase
        .from('clientes')
        .select('id, nombre_completo, email, telefono')
        .order('nombre_completo', { ascending: true })
        .limit(20);
      if (query.trim()) q = q.ilike('nombre_completo', `%${query.trim()}%`);
      const { data, error } = await q;
      if (myReq !== reqIdRef.current) return;
      if (error) {
        toast.error('Error al buscar clientes', { description: error.message });
        setResults([]);
      } else {
        setResults((data ?? []) as Cliente[]);
      }
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  // Realtime refresh mientras está abierto
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel('clientes-selector')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clientes' },
        () => {
          reqIdRef.current++;
          setQuery((q) => q);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open]);

  /**
   * Cierra el Popover primero y abre el mini-diálogo en el siguiente tick
   * para evitar conflictos de focus trap entre Radix Popover y Dialog.
   */
  const openMiniDialogWithName = (rawNombre: string) => {
    const nombre = rawNombre.trim();
    setForm({ nombre_completo: nombre, telefono: '', email: '' });
    setOpen(false);
    requestAnimationFrame(() => {
      setMiniDialogOpen(true);
    });
  };

  const handleCreateCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (creating) return;

    const parsed = clienteRequiredSchema.safeParse(form);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? 'Datos inválidos';
      toast.error(firstError);
      return;
    }

    setCreating(true);
    const { data, error } = await supabase
      .from('clientes')
      .insert({
        nombre_completo: parsed.data.nombre_completo,
        telefono: parsed.data.telefono,
        email: parsed.data.email,
      })
      .select('id, nombre_completo, email, telefono')
      .single();
    setCreating(false);

    if (error || !data) {
      toast.error('No se pudo crear el cliente', { description: error?.message });
      return;
    }

    toast.success(`Cliente "${data.nombre_completo}" creado`);
    onChange(data as Cliente);
    setMiniDialogOpen(false);
    setForm({ nombre_completo: '', telefono: '', email: '' });
    setQuery('');
  };

  const canCreateFromQuery = !!query.trim() && !loading && results.length === 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            autoFocus={autoFocus}
            className={cn(
              'w-full justify-between font-normal',
              !value && 'text-muted-foreground',
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <User className="h-4 w-4 shrink-0 opacity-60" />
              <span className="truncate">{value?.nombre_completo ?? placeholder}</span>
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {value && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onChange(null);
                    }
                  }}
                  className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                  aria-label="Limpiar cliente"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por nombre... (Enter para crear)"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreateFromQuery) {
                  e.preventDefault();
                  e.stopPropagation();
                  openMiniDialogWithName(query);
                }
              }}
            />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Buscando...
                </div>
              )}
              {!loading && results.length === 0 && (
                <CommandEmpty className="py-4">
                  <div className="px-3 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {query.trim()
                        ? 'No se encontraron clientes.'
                        : 'Escribe para buscar o crear.'}
                    </p>
                    {query.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        className="w-full"
                        onClick={() => openMiniDialogWithName(query)}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Crear "{query.trim()}"
                      </Button>
                    )}
                  </div>
                </CommandEmpty>
              )}
              {!loading && results.length > 0 && (
                <CommandGroup heading="Clientes">
                  {results.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => {
                        onChange(c);
                        setOpen(false);
                        setQuery('');
                      }}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="font-medium">{c.nombre_completo}</span>
                      {(c.telefono || c.email) && (
                        <span className="text-xs text-muted-foreground truncate w-full">
                          {[c.telefono, c.email].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Mini-diálogo de creación rápida — hermano del Popover */}
      <Dialog
        open={miniDialogOpen}
        onOpenChange={(o) => {
          if (creating) return;
          setMiniDialogOpen(o);
          if (!o) setForm({ nombre_completo: '', telefono: '', email: '' });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crear nuevo cliente</DialogTitle>
            <DialogDescription>
              Completa los datos para registrarlo en el directorio y seleccionarlo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCliente} onClick={(e) => e.stopPropagation()} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-nombre">Nombre completo</Label>
              <Input
                id="quick-nombre"
                value={form.nombre_completo}
                onChange={(e) => setForm((f) => ({ ...f, nombre_completo: e.target.value }))}
                placeholder="Nombre y apellidos"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-telefono">
                Teléfono <span className="text-xs text-muted-foreground">(10 dígitos)</span>
              </Label>
              <Input
                id="quick-telefono"
                inputMode="tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                placeholder="5512345678"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-email">
                Email <span className="text-xs text-muted-foreground">(debe incluir @)</span>
              </Label>
              <Input
                id="quick-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="cliente@correo.com"
                required
              />
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setMiniDialogOpen(false);
                }}
                disabled={creating}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creando...
                  </>
                ) : (
                  'Crear y seleccionar'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
