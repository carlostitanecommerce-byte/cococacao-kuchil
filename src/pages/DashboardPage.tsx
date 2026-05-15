import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Building2, Package, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const DashboardPage = () => {
  const { profile, roles } = useAuth();
  const navigate = useNavigate();

  const rolLabel = roles.length > 0
    ? roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ')
    : 'Sin rol asignado';

  const quickStats = [
    { title: 'POS', description: 'Punto de venta', icon: ShoppingCart, path: '/pos' },
    { title: 'Coworking', description: 'Espacios activos', icon: Building2, path: '/coworking' },
    { title: 'Inventarios', description: 'Control de stock', icon: Package, path: '/inventarios' },
    { title: 'Reportes', description: 'Análisis y métricas', icon: BarChart3, path: '/reportes' },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-3xl font-heading font-bold text-foreground">
          Bienvenido, {profile?.nombre || 'Usuario'}
        </h1>
        <p className="text-muted-foreground mt-1">
          Rol: <span className="font-medium text-foreground">{rolLabel}</span> · Sistema POS Coco & Cacao
        </p>
      </div>

      {/* Quick access cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickStats.map((stat) => (
          <Card key={stat.title} onClick={() => navigate(stat.path)} className="hover:shadow-md transition-shadow cursor-pointer border-border/60">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-5 w-5 text-accent" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
