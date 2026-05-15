import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { UserPlus, Shield, Trash2, Lock, LockOpen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Navigate } from 'react-router-dom';

interface UserWithRole {
  id: string;
  nombre: string;
  username: string | null;
  email: string;
  created_at: string;
  roles: string[];
}

const ROLE_OPTIONS = [
  { value: 'administrador', label: 'Administrador' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'caja', label: 'Caja' },
  { value: 'barista', label: 'Barista' },
  { value: 'recepcion', label: 'Recepción' },
];

const UsersPage = () => {
  const { roles: currentUserRoles, user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Form state
  const [nombre, setNombre] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete state
  const [userToDelete, setUserToDelete] = useState<UserWithRole | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Password visibility state
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, string | null>>({});

  const isAdmin = currentUserRoles.includes('administrador');

  const fetchUsers = async () => {
    setLoadingUsers(true);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, nombre, username, email, created_at');

    const { data: allRoles } = await supabase
      .from('user_roles')
      .select('user_id, role');

    const merged: UserWithRole[] = (profiles ?? []).map((p) => ({
      ...p,
      roles: (allRoles ?? [])
        .filter((r) => r.user_id === p.id)
        .map((r) => r.role),
    }));

    setUsers(merged);
    setLoadingUsers(false);
  };

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin]);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await supabase.functions.invoke('create-user', {
        body: { nombre, username, password, role },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (res.error) {
        toast({ variant: 'destructive', title: 'Error', description: res.error.message || 'No se pudo crear el usuario' });
      } else if (res.data?.error) {
        toast({ variant: 'destructive', title: 'Error', description: res.data.error });
      } else {
        toast({ title: 'Usuario creado exitosamente' });
        setNombre('');
        setUsername('');
        setPassword('');
        setRole('');
        fetchUsers();
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Error de conexión' });
    }

    setCreating(false);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingId(userToDelete.id);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await supabase.functions.invoke('delete-user', {
        body: { user_id: userToDelete.id },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (res.error || res.data?.error) {
        toast({ variant: 'destructive', title: 'Error', description: res.data?.error || res.error?.message || 'No se pudo eliminar' });
      } else {
        toast({ title: `Usuario "${userToDelete.nombre}" eliminado` });
        fetchUsers();
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Error de conexión' });
    }

    setDeletingId(null);
    setUserToDelete(null);
  };

  const togglePassword = async (userId: string) => {
    if (visiblePasswords[userId] !== undefined) {
      // Toggle off
      setVisiblePasswords((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      return;
    }

    // Fetch decrypted password via RPC (admin only)
    const { data } = await supabase.rpc('get_decrypted_password', { p_user_id: userId });

    setVisiblePasswords((prev) => ({
      ...prev,
      [userId]: (data as string) ?? null,
    }));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          Gestión de Usuarios
        </h1>
        <p className="text-muted-foreground mt-1">
          Crea y administra los colaboradores del sistema
        </p>
      </div>

      {/* Create user form */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Nuevo Colaborador
          </CardTitle>
          <CardDescription>
            Ingresa los datos del nuevo usuario. Se le asignará un nombre de usuario para iniciar sesión.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre Completo</Label>
              <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Carlos Pérez" required maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-username">Nombre de Usuario</Label>
              <Input id="new-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="carlos123" required maxLength={30} autoComplete="off" />
              <p className="text-xs text-muted-foreground">Solo letras, números, puntos y guiones</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Contraseña Inicial</Label>
              <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={role} onValueChange={setRole} required>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating || !role}>
                {creating ? 'Creando...' : 'Crear Usuario'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Users list */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Colaboradores Registrados</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <p className="text-muted-foreground text-sm">Cargando...</p>
          ) : users.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay usuarios registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Contraseña</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Fecha Registro</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.nombre}</TableCell>
                      <TableCell>{u.username || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => togglePassword(u.id)}
                          >
                            {visiblePasswords[u.id] !== undefined ? (
                              <LockOpen className="h-4 w-4 text-primary" />
                            ) : (
                              <Lock className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                          {visiblePasswords[u.id] !== undefined && (
                            <span className="text-sm font-mono">
                              {visiblePasswords[u.id] ?? 'No disponible'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {u.roles.length > 0
                            ? u.roles.map((r) => (
                                <Badge key={r} variant="secondary" className="text-xs">
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </Badge>
                              ))
                            : <span className="text-muted-foreground text-xs">Sin rol</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(u.created_at).toLocaleDateString('es-MX')}
                      </TableCell>
                      <TableCell>
                        {u.id !== currentUser?.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={deletingId === u.id}
                            onClick={() => setUserToDelete(u)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de eliminar al usuario <strong>{userToDelete?.nombre}</strong> ({userToDelete?.username})? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UsersPage;
