import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * Fallbacks públicos del proyecto de Lovable Cloud.
 *
 * Estos valores son PUBLICABLES (la anon key se entrega al navegador en cada request
 * y la URL es el endpoint público del backend). La seguridad real está en las políticas
 * RLS del backend, no en ocultar estos strings.
 *
 * Se embeben como respaldo para que el bundle publicado SIEMPRE pueda crear el cliente
 * de backend, incluso si el pipeline de publicación no entrega el archivo .env
 * (que está en .gitignore). Si .env existe, esos valores tienen prioridad.
 */
const LOVABLE_CLOUD_FALLBACKS = {
  VITE_SUPABASE_URL: "https://zidlmhqzyffrrsqhdfib.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppZGxtaHF6eWZmcnJzcWhkZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3OTk4MTMsImV4cCI6MjA5NDM3NTgxM30.xDnLeQYeEI7QANXOlXuba8UJLoDM4m6HGlT14DATrtU",
  VITE_SUPABASE_PROJECT_ID: "zidlmhqzyffrrsqhdfib",
} as const;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const resolve = (key: keyof typeof LOVABLE_CLOUD_FALLBACKS) =>
    process.env[key] || env[key] || LOVABLE_CLOUD_FALLBACKS[key];

  const define = {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolve("VITE_SUPABASE_URL")),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      resolve("VITE_SUPABASE_PUBLISHABLE_KEY")
    ),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(
      resolve("VITE_SUPABASE_PROJECT_ID")
    ),
  };

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define,
  };
});
