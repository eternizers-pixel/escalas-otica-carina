// ============================================================
// Edge Function: sync-tiquetaque
// Busca funcionárias e banco de horas da API oficial do TiqueTaque
// e grava no Supabase. O token fica como SEGREDO (TIQUETAQUE_TOKEN),
// nunca exposto ao navegador.
//
// Deploy: Supabase → Edge Functions → Deploy new function "sync-tiquetaque"
// Segredo: Supabase → Edge Functions → Secrets → TIQUETAQUE_TOKEN = <seu token>
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TT_BASE = "https://api.tiquetaque.com/v2.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Busca paginada e tolerante a formatos ({data:[...]}, [...] ou {items:[...]})
async function ttGet(path: string, token: string) {
  const auth = "Basic " + btoa("public:" + token);
  const out: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${TT_BASE}${path}${sep}page=${page}`, {
      headers: { Authorization: auth, Accept: "application/json" },
    });
    if (res.status === 401) throw { code: 401, msg: "Token inválido ou sem permissão." };
    if (res.status === 429) throw { code: 429, msg: "Limite de requisições do TiqueTaque atingido. Tente em 1 minuto." };
    if (!res.ok) throw { code: res.status, msg: `TiqueTaque respondeu ${res.status}.` };
    const body = await res.json();
    const arr = Array.isArray(body) ? body : (body.data || body.items || body.results || []);
    out.push(...arr);
    const meta = body.meta || body.pagination || {};
    const totalPages = meta.total_pages || meta.totalPages || meta.last_page;
    if (!arr.length || (totalPages && page >= totalPages) || (!totalPages && arr.length < 1)) break;
    if (!totalPages && arr.length === 0) break;
    if (!totalPages) break; // sem info de paginação: assume página única
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TT_TOKEN = Deno.env.get("TIQUETAQUE_TOKEN");
    if (!TT_TOKEN) return json({ error: "Segredo TIQUETAQUE_TOKEN não configurado.", hint: "Defina em Supabase → Edge Functions → Secrets." }, 200);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // ---- autenticação: só gestor ----
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Não autenticado." }, 401);
    const { data: prof } = await admin.from("esc_profiles").select("role").eq("id", user.id).maybeSingle();
    if (!prof || prof.role !== "gestor") return json({ error: "Apenas o gestor pode sincronizar." }, 403);

    const { start_date, end_date } = await req.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    const start = start_date || today.slice(0, 8) + "01";
    const end = end_date || today;

    // ---- 1) funcionárias (id -> nome) ----
    const employees = await ttGet("/employees", TT_TOKEN);
    const nameById: Record<string, string> = {};
    for (const e of employees) {
      const id = String(e.id ?? e._id ?? e.employee_id ?? "");
      const nm = e.name || e.full_name || e.nome || "";
      if (id) nameById[id] = nm;
    }

    // ---- 2) espelhos de ponto (totais: banco_horas) ----
    const sheets = await ttGet(`/timesheets?start_date=${start}&end_date=${end}`, TT_TOKEN);

    // registro de importação
    const { data: imp } = await admin.from("esc_time_bank_imports")
      .insert({ source: "api", file_name: "TiqueTaque API", period_start: start, period_end: end, row_count: 0, imported_by: user.id })
      .select().single();

    const items: any[] = [];
    let count = 0;
    const source = sheets.length ? sheets : employees.map((e: any) => ({ employee_id: e.id, totals: {} }));

    for (const sh of source) {
      const empId = String(sh.employee_id ?? sh.employee ?? sh.id ?? "");
      const name = nameById[empId] || sh.employee_name || sh.name || "(sem nome)";
      const totals = sh.totals || {};
      const balance = Number(totals.banco_horas ?? 0);
      const absences = Math.round(Number(totals.falta_injustificada ?? 0));
      const lates = Math.round(Number(totals.atraso ?? 0));
      if (!name || name === "(sem nome)") continue;

      // upsert funcionária: tenta por tt_employee_id, depois por nome
      let existing: any = null;
      if (empId) {
        const r = await admin.from("esc_employees").select("id").eq("is_simulation", false).eq("tt_employee_id", empId).maybeSingle();
        existing = r.data;
      }
      if (!existing) {
        const r = await admin.from("esc_employees").select("id").eq("is_simulation", false).ilike("name", name).maybeSingle();
        existing = r.data;
      }
      const matched = !!existing;
      if (existing) {
        await admin.from("esc_employees").update({ name, tt_employee_id: empId, time_bank_balance: balance, updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        const ins = await admin.from("esc_employees").insert({ name, tt_employee_id: empId, time_bank_balance: balance, is_simulation: false }).select().single();
        existing = ins.data;
      }
      await admin.from("esc_time_bank_balances").insert({
        import_id: imp?.id, employee_id: existing?.id, employee_name: name,
        balance_hours: balance, absences, lates, period_start: start, period_end: end,
      });
      items.push({ name, balance_hours: balance, absences, lates, matched });
      count++;
    }

    await admin.from("esc_time_bank_imports").update({ row_count: count }).eq("id", imp?.id);
    return json({ ok: true, employees: count, period: { start, end }, items });
  } catch (e: any) {
    const code = e?.code || 500;
    return json({ error: e?.msg || e?.message || "Erro inesperado na sincronização." }, typeof code === "number" ? 200 : 500);
  }
});
