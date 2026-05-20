import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CategoriasManager from '@/components/categorias/CategoriasManager';
import ProductosTab from '@/components/inventarios/ProductosTab';
import PaquetesDinamicosTab from '@/components/menu/PaquetesDinamicosTab';
import PreciosDeliveryTab from '@/components/menu/PreciosDeliveryTab';
import { useAuth } from '@/hooks/useAuth';

const MenuPage = () => {
  const { roles } = useAuth();
  const isAdmin = roles.includes('administrador');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold text-foreground">Menú</h1>
        <p className="text-muted-foreground mt-1">
          Categorías, productos, paquetes y precios para venta y delivery
        </p>
      </div>

      <Tabs defaultValue="categorias">
        <TabsList>
          <TabsTrigger value="categorias">Categorías</TabsTrigger>
          <TabsTrigger value="productos">Productos Individuales</TabsTrigger>
          <TabsTrigger value="paquetes">Paquetes / Combos</TabsTrigger>
          <TabsTrigger value="delivery">Precios Delivery</TabsTrigger>
        </TabsList>

        <TabsContent value="categorias" className="mt-4">
          <CategoriasManager
            isAdmin={isAdmin}
            ambitos={['producto', 'paquete']}
            defaultAmbito="producto"
            titulo="Categorías de menú"
          />
        </TabsContent>

        <TabsContent value="productos" className="mt-4">
          <ProductosTab isAdmin={isAdmin} roles={roles} />
        </TabsContent>

        <TabsContent value="paquetes" className="mt-4">
          <PaquetesDinamicosTab isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="delivery" className="mt-4">
          <PreciosDeliveryTab isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MenuPage;
