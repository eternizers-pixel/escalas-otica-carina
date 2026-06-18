// ============================================================
// Edge Function: sync-tiquetaque  (versão publicada)
// Busca funcionárias e banco de horas da API oficial do TiqueTaque
// (formato Eve: _items / full_name / _id) e grava no Supabase.
// O token fica como SEGREDO (TIQUETAQUE_TOKEN), nunca no navegador.
//
// Saldo de banco de horas: usa hours_bank_summary.final_balance do
// espelho de ponto. Como esse total só vem em mês fechado, se o período
// pedido estiver aberto a função faz fallback para o último mês fechado.
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
    const res = await fetch(`${TT_BASE}${path}${sep}page=${page}&max_results=200`, {
      headers: { Authorization: authHeader(token), Accept: "application/json" },
    });
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

async function ttOne(path, token) {
  const res = await fetch(`${TT_BASE}${path}`, { headers: { Authorization: authHeader(token), Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function pickBalance(ts) {
  const hb = ts?.hours_bank_summary;
  if (hb && hb.final_balance != null && hb.final_balance !== "") return num(hb.final_balance);
  if (ts?.totals && ts.totals.banco_horas != null) return num(ts.totals.banco_horas);
  return null;
}
function prevMonthRange(refStr) {
  const d = new Date((refStr || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const first = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1));
  const last = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0));
  return { f: first.toISOString().slice(0, 10), l: last.toISOString().slice(0, 10) };
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

    const { start_date, end_date } = await req.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    const start = start_date || today.slice(0, 8) + "01";
    const end = end_date || today;
    const pm = prevMonthRange(end);

    const employees = await ttList("/employees", TT_TOKEN);
    if (!employees.length) return json({ error: "Nenhuma funcionaria ativa retornada pela API." }, 200);

    const { data: imp } = await admin.from("esc_time_bank_imports")
      .insert({ source: "api", file_name: "TiqueTaque API", period_start: start, period_end: end, row_count: 0, imported_by: user.id })
      .select().single();

    const items = [];
    let count = 0;
    for (const e of employees) {
      const empId = String(e._id || e.id || "");
      const name = (e.full_name || e.name || "(sem nome)").trim();
      const cargo = e?.contract_data?.job_role || null;
      if (name === "(sem nome)") continue;

      let totals = {};
      let balance = null;
      const ts = await ttOne(`/timesheets?employee_id=${empId}&start_date=${start}&end_date=${end}`, TT_TOKEN);
      if (ts.ok) { totals = ts.body.totals || {}; balance = pickBalance(ts.body); }

      let usedPeriod = "atual";
      if (balance == null) {
        const tsp = await ttOne(`/timesheets?employee_id=${empId}&start_date=${pm.f}&end_date=${pm.l}`, TT_TOKEN);
        if (tsp.ok) { balance = pickBalance(tsp.body); if (!Object.keys(totals).length) totals = tsp.body.totals || {}; usedPeriod = pm.f + " a " + pm.l; }
      }

      const absences = Math.round(num(totals.falta_injustificada));
      const lates = Math.round(num(totals.atraso));

      let existing = null;
      if (empId) {
        const r = await admin.from("esc_employees").select("id").eq("is_simulation", false).eq("tt_employee_id", empId).maybeSingle();
        existing = r.data;
      }
      if (!existing) {
        const r = await admin.from("esc_employees").select("id").eq("is_simulation", false).ilike("name", name).maybeSingle();
        existing = r.data;
      }
      const matched = !!existing;
      const upd = { name, tt_employee_id: empId, updated_at: new Date().toISOString() };
      if (cargo) upd.cargo = cargo;
      if (balance != null) upd.time_bank_balance = balance;
      if (existing) {
        await admin.from("esc_employees").update(upd).eq("id", existing.id);
      } else {
        const ins = await admin.from("esc_employees").insert({ ...upd, time_bank_balance: balance ?? 0, is_simulation: false }).select().single();
        existing = ins.data;
      }
      await admin.from("esc_time_bank_balances").insert({
        import_id: imp?.id, employee_id: existing?.id, employee_name: name,
        balance_hours: balance ?? 0, absences, lates, period_start: start, period_end: end,
      });
      items.push({ name, balance_hours: balance, absences, lates, matched, period: usedPeriod });
      count++;
    }
    await admin.from("esc_time_bank_imports").update({ row_count: count }).eq("id", imp?.id);
    return json({ ok: true, employees: count, period: { start, end }, items });
  } catch (e) {
    const code = e?.code || 500;
    return json({ error: e?.msg || e?.message || "Erro inesperado." }, typeof code === "number" && code < 500 ? 200 : 500);
  }
});
