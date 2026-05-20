import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Aviso (no bloqueante) si faltan variables críticas de Lovable Cloud en build de producción.
  // No bloqueamos el build porque las variables pueden inyectarse en runtime/edge del hosting;
  // la pantalla controlada de src/main.tsx avisa al usuario si realmente faltan.
  if (mode === "production") {
    const required = [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PROJECT_ID",
    ];
    const missing = required.filter((k) => !env[k] && !process.env[k]);
    if (missing.length > 0) {
      console.warn(
        `[build] Aviso: faltan variables de Lovable Cloud en el entorno de build: ${missing.join(", ")}.`
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
