import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/DashboardLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import PosPage from "@/pages/PosPage";
import CajaPage from "@/pages/CajaPage";
import UsersPage from "@/pages/UsersPage";
import ReportesPage from "@/pages/ReportesPage";
import CoworkingPage from "@/pages/CoworkingPage";
import InventariosPage from "@/pages/InventariosPage";
import MenuPage from "@/pages/MenuPage";
import CocinaPage from "@/pages/CocinaPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * En "/" decide a dónde aterriza el usuario según su rol:
 * - barista (sin rol de gestión) → /cocina
 * - resto → Dashboard estándar
 *
 * En ambos casos el layout (sidebar) es el mismo, así que no hay destello
 * visual aunque pase un instante por aquí.
 */
function HomeRedirect() {
  const { roles, loading } = useAuth();
  if (loading) return null; // ProtectedRoute ya muestra "Cargando..."
  const isBaristaOnly =
    roles.includes('barista') &&
    !roles.some((r) => ['administrador', 'supervisor', 'caja', 'recepcion'].includes(r));
  if (isBaristaOnly) return <Navigate to="/cocina" replace />;
  return <DashboardPage />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <HomeRedirect />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pos"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor', 'caja', 'recepcion']}>
                  <DashboardLayout>
                    <PosPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/caja"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor', 'caja', 'recepcion']}>
                  <DashboardLayout>
                    <CajaPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/cocina"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor', 'barista']}>
                  <DashboardLayout>
                    <CocinaPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/coworking"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor', 'caja', 'recepcion']}>
                  <DashboardLayout>
                    <CoworkingPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/inventarios"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor']}>
                  <DashboardLayout>
                    <InventariosPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/menu"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor']}>
                  <DashboardLayout>
                    <MenuPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/usuarios"
              element={
                <ProtectedRoute allowedRoles={['administrador']}>
                  <DashboardLayout>
                    <UsersPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reportes"
              element={
                <ProtectedRoute allowedRoles={['administrador', 'supervisor']}>
                  <DashboardLayout>
                    <ReportesPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
