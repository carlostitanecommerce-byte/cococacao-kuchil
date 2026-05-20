import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Fail-fast en builds de producción si faltan variables críticas de Lovable Cloud.
  // Esto evita publicar un bundle que arranque con "supabaseUrl is required" y deje pantalla blanca.
  if (mode === "production") {
    const required = [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PROJECT_ID",
    ];
    const missing = required.filter((k) => !env[k] && !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[build] Missing Lovable Cloud build environment variables: ${missing.join(
          ", "
        )}. Refresca la conexión de Lovable Cloud y vuelve a publicar.`
      );
    }
  }

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
  };
});
