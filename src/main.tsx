import { createRoot } from "react-dom/client";
import "./index.css";

/**
 * Arranque defensivo:
 * Si el build publicado no recibió las variables de Lovable Cloud, importar App
 * (y por ende el cliente de backend) lanza "supabaseUrl is required" antes de
 * que React pueda renderizar, dejando pantalla blanca sin pistas.
 *
 * Validamos las variables ANTES de importar App y mostramos un mensaje claro.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const rootEl = document.getElementById("root")!;

function renderConfigError(missing: string[]) {
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;padding:24px;background:#faf8f5;color:#2d2d2d">
      <div style="max-width:520px;background:#fff;border:1px solid #e8e4dd;border-radius:12px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,0.05)">
        <h1 style="font-size:20px;margin:0 0 12px;color:#8b3a2a">Configuración incompleta</h1>
        <p style="margin:0 0 12px;line-height:1.5">
          El sistema no pudo iniciar porque faltan variables de configuración del backend en este despliegue:
        </p>
        <pre style="background:#f5f0e8;padding:12px;border-radius:8px;font-size:13px;margin:0 0 16px">${missing.join("\n")}</pre>
        <p style="margin:0;line-height:1.5;font-size:14px;color:#6b6b6b">
          Vuelve a publicar el app desde Lovable (Publish → Update). Si el problema persiste,
          refresca la conexión de Lovable Cloud y publica de nuevo.
        </p>
      </div>
    </div>
  `;
}

const missing: string[] = [];
if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
if (!SUPABASE_KEY) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");

if (missing.length > 0) {
  renderConfigError(missing);
} else {
  // Importación diferida: solo cargamos App (que arrastra el cliente Supabase)
  // cuando ya sabemos que el entorno está completo.
  import("./App.tsx").then(({ default: App }) => {
    createRoot(rootEl).render(<App />);
  });
}
