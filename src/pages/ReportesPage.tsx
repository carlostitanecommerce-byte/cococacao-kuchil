import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import GeneralTab from '@/components/reportes/GeneralTab';
import VentasTab from '@/components/reportes/VentasTab';
import MenuTab from '@/components/reportes/MenuTab';
import CajaTab from '@/components/reportes/CajaTab';
import InventarioTab from '@/components/reportes/InventarioTab';
import BitacoraTab from '@/components/reportes/BitacoraTab';

const ReportesPage = () => {
  const { roles } = useAuth();
  const isAdmin = roles.includes('administrador');
  const isSupervisor = roles.includes('supervisor');

  if (!isAdmin && !isSupervisor) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary" />
          Reportes
        </h1>
        <p className="text-muted-foreground mt-1">Análisis y registros del sistema</p>
      </div>

      <Tabs defaultValue="ventas">
        <TabsList>
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="menu">Menú</TabsTrigger>
          <TabsTrigger value="caja">Caja</TabsTrigger>
          <TabsTrigger value="inventario">Inventario</TabsTrigger>
          {isAdmin && <TabsTrigger value="general">Exportación Contable</TabsTrigger>}
          {isAdmin && <TabsTrigger value="bitacora">Bitácora de Actividad</TabsTrigger>}
        </TabsList>

        <TabsContent value="ventas" className="mt-6">
          <VentasTab />
        </TabsContent>

        <TabsContent value="menu" className="mt-6">
          <MenuTab />
        </TabsContent>

        <TabsContent value="caja" className="mt-6">
          <CajaTab />
        </TabsContent>

        <TabsContent value="inventario" className="mt-6">
          <InventarioTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="general" className="mt-6">
            <GeneralTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="bitacora" className="mt-6">
            <BitacoraTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default ReportesPage;
