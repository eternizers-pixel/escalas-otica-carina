// ============================================================
// Edge Function: sync-tiquetaque  (versão publicada)
// Sincroniza APENAS o CADASTRO (nomes e cargos) da API oficial
// do TiqueTaque (formato Eve: _items / full_name / _id / contract_data.job_role).
//
// IMPORTANTE: esta função NÃO toca no banco de horas. Esse campo é
// alimentado exclusivamente pela planilha (coluna Total) — assim a API
// e a planilha nunca se contradizem: cada uma cuida de um dado diferente.
//
// Segredo necessário: TIQUETAQUE_TOKEN (Edge Functions → Secrets).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TT_BASE = "https://api.tiquetaque.com/v2.1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function authHeader(token) { return "Basic " + btoa("public:" + token); }

async function ttList(path, token) {
  const out = [];
  let page = 1, total = null;
  while (page <= 20) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${TT_BASE}${path}${sep}page=${page}&max_results=200`, { headers: { Authorization: authHeader(token), Accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw { code: 401, msg: "Token invalido ou sem permissao." };
    if (res.status === 429) throw { code: 429, msg: "Limite do TiqueTaque atingido. Tente em 1 minuto." };
    if (!res.ok) throw { code: res.status, msg: body?._error?._ui_message || `TiqueTaque respondeu ${res.status}.` };
    const arr = body._items || [];
    out.push(...arr);
    total = body?._meta?.total ?? out.length;
    if (arr.length === 0 || out.length >= total) break;
    page++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const TT_TOKEN = Deno.env.get("TIQUETAQUE_TOKEN");
    if (!TT_TOKEN) return json({ error: "Segredo TIQUETAQUE_TOKEN nao configurado." }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Nao autenticado." }, 401);
    const { data: prof } = await admin.from("esc_profiles").select("role").eq("id", user.id).maybeSingle();
    if (!prof || prof.role !== "gestor") return json({ error: "Apenas o gestor pode sincronizar." }, 403);

    const employees = await ttList("/employees", TT_TOKEN);
    if (!employees.length) return json({ error: "Nenhuma funcionaria ativa retornada pela API." }, 200);

    const { data: imp } = await admin.from("esc_time_bank_imports")
      .insert({ source: "api", file_name: "Cadastro TiqueTaque (nomes/cargos)", row_count: 0, imported_by: user.id })
      .select().single();

    const items = [];
    let count = 0;
    for (const e of employees) {
      const empId = String(e._id || e.id || "");
      const name = (e.full_name || e.name || "(sem nome)").trim();
      const cargo = e?.contract_data?.job_role || null;
      if (name === "(sem nome)") continue;

      let existing = null;
      if (empId) { const r = await admin.from("esc_employees").select("id").eq("is_simulation", false).eq("tt_employee_id", empId).maybeSingle(); existing = r.data; }
      if (!existing) { const r = await admin.from("esc_employees").select("id").eq("is_simulation", false).ilike("name", name).maybeSingle(); existing = r.data; }
      const matched = !!existing;

      // SOMENTE cadastro — banco de horas NÃO é tocado aqui
      const upd = { name, tt_employee_id: empId, updated_at: new Date().toISOString() };
      if (cargo) upd.cargo = cargo;
      if (existing) await admin.from("esc_employees").update(upd).eq("id", existing.id);
      else await admin.from("esc_employees").insert({ ...upd, is_simulation: false }).select().single();

      items.push({ name, cargo, matched });
      count++;
    }
    await admin.from("esc_time_bank_imports").update({ row_count: count }).eq("id", imp?.id);
    return json({ ok: true, employees: count, items });
  } catch (e) {
    const code = e?.code || 500;
    return json({ error: e?.msg || e?.message || "Erro inesperado." }, typeof code === "number" && code < 500 ? 200 : 500);
  }
});
