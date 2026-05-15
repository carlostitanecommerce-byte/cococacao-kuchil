import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/hooks/useAuth';
import {
  ShoppingCart,
  Building2,
  Package,
  BookOpen,
  Users,
  BarChart3,
  LogOut,
  Coffee,
  ChefHat,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const allMenuItems = [
  { title: 'POS', url: '/pos', icon: ShoppingCart, allowedRoles: ['administrador', 'supervisor', 'caja', 'recepcion'] },
  { title: 'Caja', url: '/caja', icon: Wallet, allowedRoles: ['administrador', 'supervisor', 'caja', 'recepcion'] },
  { title: 'Cocina', url: '/cocina', icon: ChefHat, allowedRoles: ['administrador', 'supervisor', 'barista'] },
  { title: 'Coworking', url: '/coworking', icon: Building2, allowedRoles: ['administrador', 'supervisor', 'caja', 'recepcion'] },
  { title: 'Inventarios', url: '/inventarios', icon: Package, allowedRoles: ['administrador', 'supervisor'] },
  { title: 'Menú', url: '/menu', icon: BookOpen, allowedRoles: ['administrador', 'supervisor'] },
  { title: 'Usuarios', url: '/usuarios', icon: Users, allowedRoles: ['administrador'] },
  { title: 'Reportes', url: '/reportes', icon: BarChart3, allowedRoles: ['administrador', 'supervisor'] },
];

export function AppSidebar() {
  const { profile, roles, signOut } = useAuth();

  const rolLabel = roles.length > 0
    ? roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ')
    : 'Sin rol asignado';

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="p-2 border-b border-sidebar-border">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <SidebarTrigger className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
          <div className="flex items-center gap-2 min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
              <Coffee className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">Coco & Cacao</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">Kúuchil Meyaj</p>
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
            Menú principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {allMenuItems
                .filter((item) => !item.allowedRoles || item.allowedRoles.some(r => roles.includes(r)))
                .map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title} className="hover:bg-sidebar-accent">
                    <NavLink
                      to={item.url}
                      end
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="space-y-2">
          <div className="px-2 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {profile?.nombre || 'Usuario'}
            </p>
            <p className="text-xs text-sidebar-foreground/60 truncate">{rolLabel}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            title="Cerrar sesión"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <LogOut className="h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2" />
            <span className="group-data-[collapsible=icon]:hidden">Cerrar sesión</span>
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
