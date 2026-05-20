import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEEDS = [
  { username: "admin", password: "admin123", nombre: "Administrador", role: "administrador" },
  { username: "supervisor", password: "super123", nombre: "Supervisor", role: "supervisor" },
  { username: "caja", password: "caja1234", nombre: "Cajero", role: "caja" },
  { username: "barista", password: "barista1", nombre: "Barista", role: "barista" },
  { username: "recepcion", password: "recep123", nombre: "Recepción", role: "recepcion" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: any[] = [];

  for (const s of SEEDS) {
    const email = `${s.username}@cocoycacao.local`;
    try {
      // Skip if profile already exists for this username
      const { data: existing } = await supabase
        .from("profiles").select("id").eq("username", s.username).maybeSingle();
      if (existing) {
        results.push({ username: s.username, status: "skipped_exists", user_id: existing.id });
        continue;
      }

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password: s.password,
        email_confirm: true,
        user_metadata: { nombre: s.nombre, username: s.username },
      });
      if (createErr || !created.user) {
        results.push({ username: s.username, status: "error", error: createErr?.message });
        continue;
      }
      const uid = created.user.id;

      await supabase.rpc("encrypt_and_save_password", {
        p_user_id: uid, p_username: s.username, p_password: s.password,
      });

      await supabase.from("user_roles").insert({ user_id: uid, role: s.role });

      results.push({ username: s.username, status: "created", user_id: uid });
    } catch (err) {
      results.push({ username: s.username, status: "exception", error: String(err) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
