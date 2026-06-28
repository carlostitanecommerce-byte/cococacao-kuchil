import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronsUpDown, Loader2, Plus, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Cliente } from './types';

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

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ nombre_completo: '', telefono: '', email: '' });

  // Debounced search
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

  // Realtime refresh while open
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel('clientes-selector')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clientes' },
        () => {
          // Trigger re-fetch by bumping query state without changing the value
          reqIdRef.current++;
          setQuery((q) => q);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open]);

  const openCreate = () => {
    setForm({ nombre_completo: query.trim(), telefono: '', email: '' });
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const nombre = form.nombre_completo.trim();
    if (!nombre) {
      toast.error('El nombre es obligatorio');
      return;
    }
    setCreating(true);
    const { data, error } = await supabase
      .from('clientes')
      .insert({
        nombre_completo: nombre,
        telefono: form.telefono.trim() || null,
        email: form.email.trim() || null,
      })
      .select('id, nombre_completo, email, telefono')
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error('No se pudo crear el cliente', { description: error?.message });
      return;
    }
    toast.success('Cliente creado');
    onChange(data as Cliente);
    setCreateOpen(false);
    setOpen(false);
    setQuery('');
  };

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
              placeholder="Buscar por nombre..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Buscando...
                </div>
              )}
              {!loading && results.length === 0 && (
                <CommandEmpty className="py-4">
                  <div className="px-3 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {query.trim()
                        ? 'No se encontraron clientes.'
                        : 'Escribe para buscar.'}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      onClick={openCreate}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {query.trim()
                        ? `Crear "${query.trim()}"`
                        : 'Crear nuevo cliente'}
                    </Button>
                  </div>
                </CommandEmpty>
              )}
              {!loading && results.length > 0 && (
                <>
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
                  <div className="border-t p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={openCreate}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Crear nuevo cliente
                    </Button>
                  </div>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>
              Registra un cliente nuevo. Solo el nombre es obligatorio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cli-nombre">Nombre completo *</Label>
              <Input
                id="cli-nombre"
                value={form.nombre_completo}
                onChange={(e) => setForm((f) => ({ ...f, nombre_completo: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cli-tel">Teléfono</Label>
              <Input
                id="cli-tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cli-email">Email</Label>
              <Input
                id="cli-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating || !form.nombre_completo.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Crear cliente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
