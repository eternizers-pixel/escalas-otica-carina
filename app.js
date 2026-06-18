// ============================================================
// APP — Sistema de Escalas Ótica Carina  (navegação em cards)
// ============================================================
(function(){
"use strict";
const CFG = window.ESC_CONFIG||{};
let sb=null;
try{ sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); }catch(e){}
const S = { user:null, profile:null, role:'viewer', sim:false };

// ---------- helpers ----------
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(s)=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isGestor=()=>S.role==='gestor';
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
function gate(){ if(!isGestor()){ toast('Apenas o gestor pode alterar dados.'); return false;} return true; }
const todayStr=()=>new Date().toISOString().slice(0,10);
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const SHIFT_LABEL={manha:'Manhã',tarde:'Tarde',sabado_tarde:'Sábado tarde',dia_inteiro:'Dia inteiro'};
// formata horas decimais -> "2h10min" / "6h" / "-0h59min"
function fmtH(v){ v=+v||0; const neg=v<0; let m=Math.round(Math.abs(v)*60); const h=Math.floor(m/60); m=m%60; return (neg?'-':'')+h+'h'+(m?String(m).padStart(2,'0')+'min':''); }
// soma/subtrai horas a um horário "HH:MM"
function addHM(t,deltaH){ const [hh,mm]=(t||'00:00').split(':').map(Number); let m=hh*60+mm+Math.round((+deltaH||0)*60); m=((m%1440)+1440)%1440; return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }
// rótulo de horário da folga conforme tipo/período e horários da loja
function folgaTimeLabel(it,r){
  r=r||{}; const h=+it.hours||0;
  const cM=r.close_morning||'12:00', oM=r.open_morning||'09:00', cT=r.close_afternoon||'18:00', oT=r.open_afternoon||'14:00';
  if(it.type==='saida_antecipada') return 'Saída '+addHM(it.shift==='manha'?cM:cT, -h);
  if(it.type==='entrada_tarde')    return 'Entrada '+addHM(it.shift==='manha'?oM:oT, h);
  if(it.type==='integral')         return 'Folga o dia todo';
  if(it.type==='meio_turno')       return 'Meio turno '+(it.shift==='manha'?'manhã':'tarde');
  return TYPE_LABEL[it.type]||'Folga';
}
async function getOrCreateSchedule(year,month){
  let s=(await T('schedules').select('*').eq('is_simulation',S.sim).eq('year',year).eq('month',month).order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
  if(!s) s=(await T('schedules').insert({year,month,status:'aprovada',is_simulation:S.sim,created_by:S.user.id}).select().single()).data;
  return s;
}
const TYPE_LABEL={integral:'Folga integral',meio_turno:'Meio turno',entrada_tarde:'Entrada mais tarde',saida_antecipada:'Saída antecipada'};
function box(kind,msg){ return `<div class="alert ${kind}"><span>${kind==='err'?'⚠️':kind==='ok'?'✅':kind==='warn'?'🔔':'ℹ️'}</span><div>${msg}</div></div>`; }

// ---------- DB ----------
const T=(name)=>sb.from('esc_'+name);
async function getAll(name, q){ let b=T(name).select('*'); if(q) b=q(b); const {data,error}=await b; if(error){console.warn(name,error.message);} return data||[]; }

// Lembrete: quando o banco de horas foi atualizado pela última vez (via planilha)
async function bankFreshnessBanner(){
  const {data}=await T('time_bank_imports').select('imported_at,file_name').eq('source','planilha').order('imported_at',{ascending:false}).limit(1).maybeSingle();
  if(!data) return box('warn','<b>Banco de horas ainda não foi importado por planilha.</b> Antes de planejar folgas, importe a planilha (coluna <b>Total</b>) do TiqueTaque em <b>TiqueTaque → Banco de horas</b>.');
  const dt=new Date(data.imported_at);
  const days=Math.floor((Date.now()-dt.getTime())/86400000);
  const quando=dt.toLocaleDateString('pt-BR')+' às '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  if(days>=8) return box('warn',`<b>Banco de horas atualizado há ${days} dias</b> (${quando}). Antes de decidir folgas, vale reimportar a planilha (Total) do TiqueTaque.`);
  return box('ok',`<b>Banco de horas atualizado em ${quando}</b> ${days>0?`(há ${days} dia${days>1?'s':''})`:'(hoje)'} — dado fresco para planejar.`);
}

// Histórico real (justiça): folgas aprovadas + sábados trabalhados por funcionária
async function buildHistory(){
  const scheds=await getAll('schedules',b=>b.eq('is_simulation',S.sim));
  const schedIds=new Set(scheds.map(s=>s.id));
  const items=(await getAll('schedule_items',b=>b.eq('status','aprovado'))).filter(it=>schedIds.has(it.schedule_id));
  const rot=await getAll('saturday_rotation');
  const today=new Date();
  const h={};
  const get=(id)=> h[id]||(h[id]={dayoffs:0,fridaysOff:0,mondaysOff:0,saturdays:0,lastDayOffDays:null});
  for(const it of items){ if(!it.employee_id||!it.date) continue;
    const r=get(it.employee_id); r.dayoffs++;
    const d=new Date(it.date+'T00:00:00'); const dow=d.getDay();
    if(dow===5) r.fridaysOff++; if(dow===1) r.mondaysOff++;
    const days=Math.floor((today-d)/86400000);
    if(r.lastDayOffDays==null||days<r.lastDayOffDays) r.lastDayOffDays=days;
  }
  for(const s of rot){ if(s.employee_id && s.worked!==false) get(s.employee_id).saturdays++; }
  return h;
}

// ---------- Auth ----------
async function doLogin(){
  const email=$('#liEmail').value.trim(), pass=$('#liPass').value;
  $('#loginErr').innerHTML='';
  if(!email||!pass){ $('#loginErr').innerHTML=box('err','Informe e-mail e senha.'); return; }
  if(!sb||CFG.SUPABASE_URL==='COLE_AQUI_A_URL'){ $('#loginErr').innerHTML=box('err','Configuração do Supabase ausente em config.js.'); return; }
  const {error}=await sb.auth.signInWithPassword({email,password:pass});
  if(error){ $('#loginErr').innerHTML=box('err','Não foi possível entrar: '+error.message); return; }
  await boot();
}
async function doSignup(){
  const email=$('#liEmail').value.trim(), pass=$('#liPass').value;
  if(!email||pass.length<6){ $('#loginErr').innerHTML=box('warn','Para criar conta: e-mail válido e senha de 6+ caracteres.'); return; }
  const {error}=await sb.auth.signUp({email,password:pass});
  if(error){ $('#loginErr').innerHTML=box('err',error.message); return; }
  $('#loginErr').innerHTML=box('ok','Conta criada! O primeiro usuário vira Gestor. Já pode entrar.');
}
async function logout(){ await sb.auth.signOut(); location.reload(); }

// ---------- Boot ----------
async function boot(){
  // sessão local (rápido) — evita o flash da tela de login no refresh
  const {data:{session}}=await sb.auth.getSession();
  const user=session?.user;
  $('#boot') && ($('#boot').style.display='none');
  if(!user){ $('#login').style.display='flex'; $('#app').style.display='none'; return; }
  S.user=user;
  let {data:prof}=await T('profiles').select('*').eq('id',user.id).maybeSingle();
  if(!prof){ await T('profiles').upsert({id:user.id,email:user.email}).select(); ({data:prof}=await T('profiles').select('*').eq('id',user.id).maybeSingle()); }
  S.profile=prof||{role:'viewer',email:user.email};
  S.role=S.profile.role||'viewer';
  $('#login').style.display='none'; $('#app').style.display='block';
  const nm=(S.profile.full_name && S.profile.full_name!==user.email)?S.profile.full_name:user.email.split('@')[0];
  $('#uName').textContent=nm;
  $('#uRole').innerHTML=`<span class="badge ${S.role}">${S.role==='gestor'?'Gestor':'Visualização'}</span>`;
  if(!location.hash) location.hash='#home';
  route();
}

// ---------- Nav model ----------
const NAV=[
  ['dashboard','📊','b','Dashboard','Visão geral, alertas e resumo do mês'],
  ['folgas','🌴','t','Motor de folgas','Sugestões inteligentes e justas'],
  ['escala','📋','g','Folgas aprovadas','Ver, editar e lançar folgas'],
  ['sabados','📅','p','Rodízio de sábados','2 primeiros sábados, equilibrado'],
  ['calendario','🗓️','b','Calendário','Visão mensal de folgas e férias'],
  ['config','⚙️','p','Configurações','Funcionárias, regras, TiqueTaque e mais'],
  ['funcionarias','👥','g','Funcionárias','Cadastro, cargos e banco de horas'],
  ['ferias','✈️','a','Férias','Períodos e impacto na escala'],
  ['pedidos','📨','k','Pedidos & exceções','Folgas, faltas, atestados, trocas'],
  ['tiquetaque','🔄','t','TiqueTaque','Sincronizar banco de horas'],
  ['regras','🏪','p','Regras da loja','Horários, turnos e limites'],
  ['relatorios','📈','g','Relatórios','Resumo e índice de justiça'],
  ['simulacao','🧪','r','Simulação','Teste cenários sem risco'],
  ['relsemana','📋','t','Relatório da semana','Texto pronto para o grupo'],
];
const HOME_KEYS=['dashboard','folgas','escala','sabados','calendario','config'];
const CONFIG_KEYS=['funcionarias','ferias','pedidos','tiquetaque','regras','relatorios','simulacao'];

function updateSimBanner(){ $('#simBanner').innerHTML = S.sim ? `<div class="simbanner">🧪 MODO SIMULAÇÃO — dados fictícios. Nada aqui afeta os dados reais.</div>`:''; }

// ---------- Router ----------
const ROUTES={};
function route(){
  const k=(location.hash||'#home').slice(1);
  updateSimBanner();
  if(k==='home'){ $('#backBtn').classList.add('hidden'); $('#pageTitle').textContent=''; renderHome(); return; }
  const def=NAV.find(n=>n[0]===k);
  $('#pageTitle').textContent=def?def[3]:'';
  $('#backBtn').classList.remove('hidden');
  const inConfig=CONFIG_KEYS.includes(k);
  $('#backBtn').textContent = inConfig ? '← Configurações' : '← Início';
  $('#backBtn').onclick=()=>{ location.hash = inConfig ? '#config' : '#home'; };
  const fn=ROUTES[k]||renderHome;
  $('#view').innerHTML='<p class="muted">Carregando…</p>';
  fn();
}
window.addEventListener('hashchange',route);

// ---------- HOME ----------
function cardsFor(keys,cls=''){
  return `<div class="home-grid ${cls}">${keys.map(k=>{const n=NAV.find(x=>x[0]===k); return n?`<div class="hcard" data-go="${k}"><div class="ic ${n[2]}">${n[1]}</div><h3>${esc(n[3])}</h3><p>${esc(n[4])}</p></div>`:'';}).join('')}</div>`;
}
function renderHome(){
  $('#backBtn').classList.add('hidden'); $('#pageTitle').textContent='';
  $('#view').innerHTML=`
  <div class="hero">
    <div class="logo"><span class="em">👓</span> Ótica Carina</div>
    <div class="tag">Sistema de Escalas &amp; Banco de Horas</div>
    <div style="margin-top:12px;display:flex;gap:20px;justify-content:center;flex-wrap:wrap">
      <a href="#tiquetaque" style="color:var(--brand);font-weight:600;font-size:14px">🔄 Sincronizar banco de horas (TiqueTaque)</a>
      <a href="#relsemana" style="color:var(--brand);font-weight:600;font-size:14px">📋 Relatório da semana (grupo)</a>
    </div>
  </div>
  ${cardsFor(HOME_KEYS,'cols3')}`;
  $$('[data-go]').forEach(el=>el.onclick=()=>location.hash='#'+el.dataset.go);
}
ROUTES.config=function(){
  $('#view').innerHTML=`${box('info','Aqui ficam os ajustes e cadastros. As telas do dia a dia (folgas, sábados, calendário) estão na tela inicial.')}${cardsFor(CONFIG_KEYS)}`;
  $$('[data-go]').forEach(el=>el.onclick=()=>location.hash='#'+el.dataset.go);
};

// ---------- DASHBOARD ----------
ROUTES.dashboard=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1;
  const [emps,rules]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{})]);
  const active=emps.filter(e=>e.status==='ativa');
  const onVac=emps.filter(e=>e.status==='ferias');
  const cap=Engine.operationalCapacity(emps,rules);
  const highBank=emps.filter(e=>(e.time_bank_balance||0)>=(rules.max_time_bank||20));
  const totalBank=emps.reduce((s,e)=>s+(+e.time_bank_balance||0),0);
  let alerts='';
  if(cap.availableForShift<=cap.minPerShift) alerts+=box('err',`<b>Cobertura mínima em risco:</b> ${cap.availableForShift} ativa(s) para mínimo de ${cap.minPerShift} por turno.`);
  if(onVac.length>=1) alerts+=box('warn',`<b>Equipe reduzida:</b> ${onVac.length} em férias. ${cap.note}`);
  if(highBank.length) alerts+=box('warn',`<b>Banco de horas alto:</b> ${highBank.map(e=>e.name+' ('+fmtH(e.time_bank_balance)+')').join(', ')} acima de ${fmtH(rules.max_time_bank||20)}.`);
  if(!alerts) alerts=box('ok','Tudo sob controle: cobertura adequada e banco dentro do limite.');
  const fresh=await bankFreshnessBanner();
  $('#view').innerHTML=`
  ${fresh}
  <div class="cards">
    <div class="card"><h3>Funcionárias ativas</h3><div class="kpi">${active.length}<small> / ${emps.length}</small></div></div>
    <div class="card"><h3>Em férias</h3><div class="kpi">${onVac.length}</div></div>
    <div class="card"><h3>Banco de horas total</h3><div class="kpi">${fmtH(totalBank)}</div></div>
    <div class="card"><h3>Capacidade operacional</h3><div class="kpi" style="font-size:17px;text-transform:capitalize">${cap.level.replace('_',' ')}</div><div class="reason">${cap.note}</div></div>
  </div>
  <div class="section">${alerts}</div>
  <div class="toolbar">
    <button class="btn" onclick="location.hash='#folgas'">⚡ Gerar escala automática</button>
    <button class="btn sec" onclick="location.hash='#tiquetaque'">🔄 Sincronizar TiqueTaque</button>
    <div class="spacer"></div><span class="muted">${MONTHS[month-1]} de ${year}</span>
  </div>
  <div class="panel"><div class="ph"><h3>Banco de horas por funcionária</h3></div><div class="pb" style="padding:0">
    <table><thead><tr><th>Funcionária</th><th>Cargo</th><th>Banco</th><th>Status</th></tr></thead><tbody>
    ${emps.sort((a,b)=>(b.time_bank_balance||0)-(a.time_bank_balance||0)).map(e=>`<tr>
      <td><b>${esc(e.name)}</b></td><td class="muted">${esc(e.cargo||'—')}</td>
      <td><b>${fmtH(e.time_bank_balance)}</b></td><td><span class="pill ${e.status}">${e.status}</span></td></tr>`).join('')
      ||'<tr><td colspan=4 class="muted" style="padding:18px">Nenhuma funcionária. Sincronize o TiqueTaque ou cadastre manualmente.</td></tr>'}
    </tbody></table></div></div>`;
};

// ---------- FUNCIONÁRIAS ----------
ROUTES.funcionarias=async function(){
  const emps=await getAll('employees',b=>b.eq('is_simulation',S.sim).order('name'));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addEmp" ${isGestor()?'':'disabled'}>+ Nova funcionária</button>
    <div class="spacer"></div><span class="muted">${emps.length} cadastro(s)</span></div>
  <div class="panel"><div class="pb" style="padding:0"><table>
    <thead><tr><th>Nome</th><th>Cargo</th><th>Status</th><th>Carga</th><th>Banco</th><th>Prioridade</th><th></th></tr></thead>
    <tbody>${emps.map(e=>`<tr>
      <td><b>${esc(e.name)}</b>${e.is_expert?' <span title="Especialista em ótica">⭐</span>':''}<br><span class="muted" style="font-size:11.5px">${esc(e.preferences||'')}</span></td>
      <td>${esc(e.cargo||'—')}</td><td><span class="pill ${e.status}">${e.status}</span></td>
      <td>${e.weekly_hours||44}h</td><td><b>${fmtH(e.time_bank_balance)}</b></td><td>${e.manual_priority||0}</td>
      <td class="row-actions"><button class="btn ghost sm" data-edit="${e.id}">Editar</button>
        ${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-del="${e.id}">Excluir</button>`:''}</td></tr>`).join('')
      ||'<tr><td colspan=7 class="muted" style="padding:18px">Nenhuma funcionária. Clique em “Nova funcionária” ou sincronize o TiqueTaque.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addEmp')?.addEventListener('click',()=>empModal());
  $$('[data-edit]').forEach(b=>b.onclick=()=>empModal(emps.find(e=>e.id===b.dataset.edit)));
  $$('[data-del]').forEach(b=>b.onclick=async()=>{ if(!gate())return; if(!confirm('Excluir esta funcionária?'))return; await T('employees').delete().eq('id',b.dataset.del); toast('Excluída.'); route(); });
};
function empModal(e){
  e=e||{};
  openModal(e.id?'Editar funcionária':'Nova funcionária',`
    <div class="field"><label>Nome *</label><input id="f_name" value="${esc(e.name||'')}"/></div>
    <div class="grid2">
      <div class="field"><label>Cargo / função</label><input id="f_cargo" value="${esc(e.cargo||'')}" placeholder="Vendedora, Caixa, Óptica…"/></div>
      <div class="field"><label>Status</label><select id="f_status">${['ativa','ferias','licenca','afastada','desligada'].map(s=>`<option ${e.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>
    <div class="field"><label>Atendimento na ótica</label><select id="f_expert"><option value="false" ${!e.is_expert?'selected':''}>Sabe menos (precisa de apoio)</option><option value="true" ${e.is_expert?'selected':''}>⭐ Especialista (bem treinada)</option></select>
      <div class="reason">No rodízio de sábado, cada dia precisa de pelo menos 1 especialista junto com 1 que sabe menos.</div></div>
    <div class="field"><label>Preferências ao compensar folga (marque uma ou mais)</label>
      <div style="display:flex;flex-direction:column;gap:7px">
        ${[['manha_entrar','Entrar mais tarde (manhã)'],['manha_sair','Sair mais cedo (manhã)'],['tarde_entrar','Entrar mais tarde (tarde)'],['tarde_sair','Sair mais cedo (tarde)']].map(([v,l])=>`<label style="display:flex;align-items:center;gap:8px;font-weight:500;font-size:13.5px;margin:0;color:var(--ink)"><input type="checkbox" class="f_dpref" value="${v}" style="width:auto;margin:0" ${String(e.dayoff_pref||'').split(',').includes(v)?'checked':''}/> ${l}</label>`).join('')}
      </div>
      <div class="reason">Se não marcar nenhuma, o sistema alterna entre todas as opções.</div></div>
    <div class="grid3">
      <div class="field"><label>Carga semanal (h)</label><input id="f_wh" type="number" value="${e.weekly_hours||44}"/></div>
      <div class="field"><label>Banco de horas (h)</label><input id="f_bank" type="number" step="0.5" value="${e.time_bank_balance||0}"/></div>
      <div class="field"><label>Prioridade manual</label><input id="f_prio" type="number" value="${e.manual_priority||0}"/></div></div>
    <div class="field"><label>Preferências de folga</label><input id="f_pref" value="${esc(e.preferences||'')}"/></div>
    <div class="field"><label>Restrições pessoais</label><input id="f_restr" value="${esc(e.restrictions||'')}"/></div>
    <div class="field"><label>Observações internas</label><textarea id="f_notes" rows="2">${esc(e.notes||'')}</textarea></div>`,
  async()=>{
    if(!gate())return false;
    const name=$('#f_name').value.trim(); if(!name){toast('Informe o nome.');return false;}
    const payload={name,cargo:$('#f_cargo').value.trim(),status:$('#f_status').value,weekly_hours:+$('#f_wh').value||44,
      time_bank_balance:+$('#f_bank').value||0,manual_priority:+$('#f_prio').value||0,preferences:$('#f_pref').value.trim(),
      restrictions:$('#f_restr').value.trim(),notes:$('#f_notes').value.trim(),is_expert:$('#f_expert').value==='true',dayoff_pref:$$('.f_dpref').filter(c=>c.checked).map(c=>c.value).join(','),is_simulation:S.sim,updated_at:new Date().toISOString()};
    const r = e.id ? await T('employees').update(payload).eq('id',e.id) : await T('employees').insert(payload);
    if(r.error){toast('Erro: '+r.error.message);return false;}
    toast('Salvo.'); route(); return true;
  });
}

// ---------- REGRAS (com horários manhã/tarde) ----------
ROUTES.regras=async function(){
  const r=(await T('store_rules').select('*').eq('id',1).maybeSingle()).data||{};
  const blocked=await getAll('blocked_dates',b=>b.order('date'));
  const cy=new Date().getFullYear(), lead=r.high_traffic_lead_days??7, todayS=todayStr();
  const comm=[...Engine.commemorativeDates(cy),...Engine.commemorativeDates(cy+1)].filter(c=>c.date>=todayS).slice(0,8);
  const commRows=comm.map(c=>{ const d=new Date(c.date+'T00:00:00'); const ini=new Date(d); ini.setDate(ini.getDate()-lead);
    return `<tr><td><b>${esc(c.name)}</b></td><td>${c.date.split('-').reverse().join('/')}</td><td class="muted">${ini.toLocaleDateString('pt-BR')} → ${d.toLocaleDateString('pt-BR')}</td></tr>`; }).join('');
  $('#view').innerHTML=`
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Horário de funcionamento</h3></div><div class="pb">
      <p class="muted" style="margin-top:0">A loja fecha no intervalo do almoço — por isso há horários separados de manhã e de tarde.</p>
      <div class="grid2">
        <div class="field"><label>Manhã — abre</label><input id="r_om" type="time" value="${r.open_morning||'09:00'}"/></div>
        <div class="field"><label>Manhã — fecha</label><input id="r_cm" type="time" value="${r.close_morning||'12:00'}"/></div></div>
      <div class="grid2">
        <div class="field"><label>Tarde — abre</label><input id="r_oa" type="time" value="${r.open_afternoon||'14:00'}"/></div>
        <div class="field"><label>Tarde — fecha</label><input id="r_ca" type="time" value="${r.close_afternoon||'18:00'}"/></div></div>
    </div></div>
    <div class="panel"><div class="ph"><h3>Cobertura e banco de horas</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Mínimo por turno</label><input id="r_min" type="number" value="${r.min_per_shift||4}"/></div>
        <div class="field"><label>Limite recomendado de banco (h)</label><input id="r_maxbank" type="number" value="${r.max_time_bank||20}"/></div></div>
      <div class="grid2">
        <div class="field"><label>Mín. de banco p/ sugerir folga (h)</label><input id="r_minbank" type="number" value="${r.min_time_bank_for_dayoff||6}"/></div>
        <div class="field"><label>Folga: mín–máx (h)</label><div style="display:flex;gap:6px"><input id="r_dmin" type="number" value="${r.min_dayoff_hours||3}"/><input id="r_dmax" type="number" value="${r.max_dayoff_hours||8}"/></div></div></div>
      <div class="grid2">
        <div class="field"><label>Tipo de folga liberada</label><select id="r_mode"><option value="saida_antecipada" ${(r.dayoff_mode||'saida_antecipada')==='saida_antecipada'?'selected':''}>Só sair mais cedo (recomendado)</option><option value="completa" ${r.dayoff_mode==='completa'?'selected':''}>Permitir folga integral / meio turno</option></select></div>
        <div class="field"><label>Horas de saída antecipada</label><input id="r_early" type="number" value="${r.early_leave_hours??3}"/></div></div>
      <div class="reason">No modo recomendado, o sistema só sugere <b>sair mais cedo</b> (manhã ou tarde) — nunca o dia inteiro — evitando o incentivo de "acumular horas para ganhar o dia".</div>
    </div></div>
  </div>
  <div class="section grid2">
    <div class="panel"><div class="ph"><h3>Sábados &amp; escala 5x2</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Sábados abertos / mês</label><input id="r_satn" type="number" value="${r.saturday_open_count||2}"/></div>
        <div class="field"><label>Horário do sábado</label><div style="display:flex;gap:6px"><input id="r_sats" type="time" value="${r.saturday_start||'14:00'}"/><input id="r_sate" type="time" value="${r.saturday_end||'17:00'}"/></div></div></div>
      <div class="grid2">
        <div class="field"><label>Pessoas no 1º sábado</label><input id="r_sat1" type="number" value="${r.saturday_first_count??3}"/></div>
        <div class="field"><label>Pessoas no 2º sábado</label><input id="r_sat2" type="number" value="${r.saturday_second_count??2}"/></div></div>
      <div class="reason">1º sábado costuma ter mais movimento (pós-pagamento) → mais gente. Se uma data comemorativa cair perto do 2º sábado, o reforço <b>inverte automaticamente</b>.</div>
      <div class="field"><label>Escala 5x2 (futura)</label>
        <select id="r_5x2"><option value="false" ${!r.scale_5x2_enabled?'selected':''}>Desativada (modelo atual)</option><option value="true" ${r.scale_5x2_enabled?'selected':''}>Ativada</option></select>
        <div class="reason">Quando ativada: domingo fixo de folga + 1 dia rotativo, com rodízio justo. Arquitetura já preparada.</div></div>
      <button class="btn" id="saveRules" ${isGestor()?'':'disabled'}>Salvar regras</button>
    </div></div>
    <div class="panel"><div class="ph"><h3>Dias bloqueados / datas especiais</h3><button class="btn sm" id="addBlk" ${isGestor()?'':'disabled'}>+ Adicionar</button></div>
      <div class="pb" style="padding:0"><table><thead><tr><th>Data</th><th>Tipo</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${blocked.map(b=>`<tr><td>${b.date}</td><td>${b.type}</td><td>${esc(b.reason||'')}</td><td>${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-delblk="${b.id}">remover</button>`:''}</td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:16px">Nenhum dia bloqueado.</td></tr>'}
      </tbody></table></div></div>
  </div>
  <div class="section panel"><div class="ph"><h3>🎁 Datas comemorativas (alto movimento)</h3></div><div class="pb">
    <p class="muted" style="margin-top:0">Nessas datas <b>e na semana que as antecede</b>, o sistema <b>não sugere folga</b> — joga para depois da data. O sábado (manhã e tarde) também nunca recebe folga.</p>
    <div class="grid2">
      <div class="field"><label>Proteção de datas comemorativas</label><select id="r_comm"><option value="true" ${r.block_commemorative!==false?'selected':''}>Ativada</option><option value="false" ${r.block_commemorative===false?'selected':''}>Desativada</option></select></div>
      <div class="field"><label>Dias antes da data a proteger</label><input id="r_lead" type="number" value="${lead}"/></div>
    </div>
    <table><thead><tr><th>Data</th><th>Quando</th><th>Período sem folga</th></tr></thead><tbody>${commRows||'<tr><td colspan=3 class="muted">—</td></tr>'}</tbody></table>
    <p class="muted" style="margin-top:8px">Datas fixas de varejo (Mães, Namorados, Pais, Crianças, Black Friday, Natal). Precisa de uma data extra (liquidação, evento)? Adicione em “Dias bloqueados” acima com o tipo <i>Alto movimento</i>.</p>
    <button class="btn" id="saveComm" style="margin-top:10px" ${isGestor()?'':'disabled'}>Salvar datas comemorativas</button>
  </div></div>`;
  $('#saveComm')?.addEventListener('click',async()=>{ if(!gate())return;
    const res=await T('store_rules').update({block_commemorative:$('#r_comm').value==='true',high_traffic_lead_days:+$('#r_lead').value||7,updated_at:new Date().toISOString()}).eq('id',1);
    if(res.error){toast('Erro: '+res.error.message);return;} toast('Datas comemorativas salvas.'); route(); });
  $('#saveRules')?.addEventListener('click',async()=>{ if(!gate())return;
    const payload={id:1,open_morning:$('#r_om').value,close_morning:$('#r_cm').value,open_afternoon:$('#r_oa').value,close_afternoon:$('#r_ca').value,
      open_time:$('#r_om').value,close_time:$('#r_ca').value,
      min_per_shift:+$('#r_min').value,max_time_bank:+$('#r_maxbank').value,min_time_bank_for_dayoff:+$('#r_minbank').value,
      min_dayoff_hours:+$('#r_dmin').value,max_dayoff_hours:+$('#r_dmax').value,
      dayoff_mode:$('#r_mode').value,early_leave_hours:+$('#r_early').value||3,
      saturday_open_count:+$('#r_satn').value,saturday_start:$('#r_sats').value,saturday_end:$('#r_sate').value,
      saturday_first_count:+$('#r_sat1').value||3,saturday_second_count:+$('#r_sat2').value||2,
      scale_5x2_enabled:$('#r_5x2').value==='true',updated_at:new Date().toISOString()};
    const res=await T('store_rules').upsert(payload); if(res.error){toast('Erro: '+res.error.message);return;}
    toast('Regras salvas.'); });
  $('#addBlk')?.addEventListener('click',()=>{
    openModal('Bloquear data',`
      <div class="field"><label>Data</label><input id="b_date" type="date" value="${todayStr()}"/></div>
      <div class="field"><label>Tipo</label><select id="b_type"><option value="bloqueio">Bloqueio de folga</option><option value="especial">Data especial</option><option value="alto_movimento">Alto movimento</option></select></div>
      <div class="field"><label>Motivo</label><input id="b_reason"/></div>`,
      async()=>{ if(!gate())return false; const res=await T('blocked_dates').insert({date:$('#b_date').value,type:$('#b_type').value,reason:$('#b_reason').value});
        if(res.error){toast(res.error.message);return false;} toast('Adicionado.'); route(); return true; });
  });
  $$('[data-delblk]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('blocked_dates').delete().eq('id',b.dataset.delblk); route(); });
};

// ---------- TIQUETAQUE ----------
ROUTES.tiquetaque=async function(){
  const imports=await getAll('time_bank_imports',b=>b.order('imported_at',{ascending:false}).limit(10));
  const firstDay=new Date(); firstDay.setDate(1);
  $('#view').innerHTML=`
  ${box('info','<b>Duas fontes, sem conflito — cada uma cuida de uma coisa:</b><br>🧩 <b>API (cadastro):</b> mantém nomes e cargos atualizados. <u>Não mexe no banco de horas.</u><br>📊 <b>Planilha (banco de horas):</b> é a única dona do banco de horas — use a coluna <b>Total</b> da exportação do TiqueTaque, que é o saldo real disponível.')}
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>🧩 Cadastro (API)</h3></div><div class="pb">
      <p class="muted" style="margin-top:0">Puxa <b>nomes e cargos</b> direto do TiqueTaque. Rápido e sem digitação. Não altera o banco de horas.</p>
      <button class="btn" id="ttSync" ${isGestor()?'':'disabled'}>🧩 Sincronizar cadastro</button>
      <div id="ttOut" class="section"></div>
    </div></div>
    <div class="panel"><div class="ph"><h3>📊 Banco de horas (planilha)</h3></div><div class="pb">
      <p class="muted" style="margin-top:0">No TiqueTaque, em Banco de horas, clique em <b>Exportar</b> e importe aqui. O sistema usa a coluna <b>Total</b> (saldo real disponível); se não houver, usa Saldo. Aceita formatos como <i>11h07min</i> ou <i>11,12</i>.<br><b>Cada importação substitui</b> o banco de horas pelo valor atual da planilha — <u>não soma</u> com o relatório anterior (o Total já é o acumulado).</p>
      <div class="field"><label>Arquivo (.xlsx/.csv)</label><input id="imp_file" type="file" accept=".xlsx,.xls,.csv" ${isGestor()?'':'disabled'}/></div>
      <div id="impPreview"></div>
    </div></div>
  </div>
  <div class="section panel"><div class="ph"><h3>Histórico de sincronizações</h3></div><div class="pb" style="padding:0">
    <table><thead><tr><th>Quando</th><th>Origem</th><th>Linhas</th><th>Período</th></tr></thead>
    <tbody>${imports.map(i=>`<tr><td>${new Date(i.imported_at).toLocaleString('pt-BR')}</td><td>${esc(i.source||'—')}</td><td>${i.row_count}</td><td class="muted">${i.period_start||'—'} a ${i.period_end||'—'}</td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:16px">Nenhuma sincronização ainda.</td></tr>'}
    </tbody></table></div></div>`;
  // --- API sync ---
  $('#ttSync')?.addEventListener('click',async()=>{ if(!gate())return;
    const btn=$('#ttSync'); btn.disabled=true; btn.textContent='Sincronizando…';
    $('#ttOut').innerHTML='<p class="muted">Consultando o TiqueTaque…</p>';
    try{
      const {data,error}=await sb.functions.invoke('sync-tiquetaque',{body:{}});
      if(error) throw error;
      if(data && data.error){ $('#ttOut').innerHTML=box('err','TiqueTaque: '+esc(data.error)+(data.hint?'<br><span class="muted">'+esc(data.hint)+'</span>':'')); }
      else{
        const rows=(data.items||[]).map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.cargo||'—')}</td><td>${x.matched?'✅ atualizada':'➕ criada'}</td></tr>`).join('');
        $('#ttOut').innerHTML=box('ok',`Cadastro sincronizado: <b>${data.employees||0}</b> funcionária(s). O banco de horas não foi alterado (use a planilha ao lado).`)+
          `<table><thead><tr><th>Funcionária</th><th>Cargo</th><th>Status</th></tr></thead><tbody>${rows||''}</tbody></table>`;
        toast('Cadastro sincronizado.');
      }
    }catch(err){
      const msg=(err&&err.message)||'falha na sincronização';
      $('#ttOut').innerHTML=box('err','Não foi possível sincronizar: '+esc(msg)+'<br><span class="muted">Verifique se a Edge Function <b>sync-tiquetaque</b> está publicada e se o segredo <b>TIQUETAQUE_TOKEN</b> foi configurado no Supabase.</span>');
    }
    btn.disabled=false; btn.textContent='🧩 Sincronizar cadastro';
  });
  // --- planilha fallback ---
  let parsed=[];
  $('#imp_file')?.addEventListener('change',async(ev)=>{
    const f=ev.target.files[0]; if(!f)return;
    const buf=await f.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    const norm=(k)=>k.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
    // aceita "11h07min", "11h07", "11:07", "-00h59min", "11,12", "11.12", "11"
    const parseHoras=(v)=>{ if(v==null||v==='')return null; let s=v.toString().trim();
      const m=s.replace(',','.').match(/^(-?)\s*(\d+)\s*[h:]\s*(\d{1,2})/i);
      if(m){const sign=m[1]==='-'?-1:1; return sign*(parseInt(m[2])+parseInt(m[3])/60);}
      const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
    parsed=rows.map(r=>{const o={};for(const k in r)o[norm(k)]=r[k];
      // prioriza a coluna TOTAL (saldo real disponível); senão usa Saldo/Banco
      const bal = parseHoras(o.total) ?? parseHoras(o.saldo ?? o.bancodehoras ?? o.banco) ?? 0;
      return {name:(o.nome||o.funcionaria||o.colaborador||'').toString().trim(),
        balance: Math.round(bal*100)/100,
        positive:parseHoras(o.parcialmes ?? o.parcial ?? o.horaspositivas ?? o.positivas)||0,
        negative:parseHoras(o.horasnegativas ?? o.negativas)||0,
        absences:+o.faltas||0,lates:+o.atrasos||0,early:+o.saidasantecipadas||+o.saidas||0,missing:+o.batidasfaltantes||+o.batidas||0};
    }).filter(r=>r.name);
    const emps=await getAll('employees',b=>b.eq('is_simulation',false));
    const names=emps.map(e=>e.name.toLowerCase());
    $('#impPreview').innerHTML=`<div class="section"><table><thead><tr><th>Funcionária</th><th>Saldo</th></tr></thead>
      <tbody>${parsed.map(p=>`<tr><td>${names.includes(p.name.toLowerCase())?'✅':'➕'} ${esc(p.name)}</td><td>${fmtH(p.balance)}</td></tr>`).join('')}</tbody></table>
      <button class="btn" id="confirmImp" style="margin-top:10px">Confirmar importação (${parsed.length})</button></div>`;
    $('#confirmImp').onclick=async()=>{ if(!gate())return;
      const imp=await T('time_bank_imports').insert({source:'planilha',file_name:f.name,period_start:null,period_end:null,row_count:parsed.length,imported_by:S.user.id}).select().single();
      if(imp.error){toast(imp.error.message);return;}
      for(const p of parsed){ let e=emps.find(x=>x.name.toLowerCase()===p.name.toLowerCase());
        if(!e){ const ins=await T('employees').insert({name:p.name,time_bank_balance:p.balance,is_simulation:false}).select().single(); e=ins.data; }
        else await T('employees').update({time_bank_balance:p.balance,updated_at:new Date().toISOString()}).eq('id',e.id);
        await T('time_bank_balances').insert({import_id:imp.data.id,employee_id:e?e.id:null,employee_name:p.name,balance_hours:p.balance,positive_hours:p.positive,negative_hours:p.negative,absences:p.absences,lates:p.lates,early_leaves:p.early,missing_punches:p.missing});
      }
      toast('Importação concluída.'); route();
    };
  });
};

// ---------- FÉRIAS ----------
ROUTES.ferias=async function(){
  const [emps,vacs]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),getAll('vacation_periods',b=>b.order('start_date',{ascending:false}))]);
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addVac" ${isGestor()?'':'disabled'}>+ Cadastrar férias</button></div>
  ${box('info','Funcionárias em férias não recebem folga, não entram no rodízio nem em trocas — e o sistema reduz automaticamente o tamanho das folgas das demais.')}
  <div class="panel"><div class="pb" style="padding:0"><table>
    <thead><tr><th>Funcionária</th><th>Início</th><th>Fim</th><th>Observações</th><th></th></tr></thead>
    <tbody>${vacs.map(v=>`<tr><td><b>${esc(map[v.employee_id]||'—')}</b></td><td>${v.start_date}</td><td>${v.end_date}</td><td class="muted">${esc(v.notes||'')}</td><td>${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-delv="${v.id}">remover</button>`:''}</td></tr>`).join('')||'<tr><td colspan=5 class="muted" style="padding:16px">Nenhum período cadastrado.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addVac')?.addEventListener('click',()=>{
    openModal('Cadastrar férias',`
      <div class="field"><label>Funcionária</label><select id="v_emp">${emps.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label>Início</label><input id="v_start" type="date" value="${todayStr()}"/></div><div class="field"><label>Fim</label><input id="v_end" type="date" value="${todayStr()}"/></div></div>
      <div class="field"><label>Observações</label><input id="v_notes"/></div>`,
      async()=>{ if(!gate())return false; const emp=$('#v_emp').value;
        const res=await T('vacation_periods').insert({employee_id:emp,start_date:$('#v_start').value,end_date:$('#v_end').value,notes:$('#v_notes').value});
        if(res.error){toast(res.error.message);return false;}
        await T('employees').update({status:'ferias'}).eq('id',emp); toast('Férias cadastradas.'); route(); return true; });
  });
  $$('[data-delv]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('vacation_periods').delete().eq('id',b.dataset.delv); route(); });
};

// ---------- MOTOR DE FOLGAS ----------
ROUTES.folgas=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1;
  const [emps,rules,vacs,reqs,blk]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('vacation_periods'),getAll('dayoff_requests'),getAll('blocked_dates')]);
  const refusals=reqs.filter(r=>r.request_type==='recusa_folga');
  const history=await buildHistory();
  const fresh=await bankFreshnessBanner();
  $('#view').innerHTML=`
  ${fresh}
  <div class="toolbar"><button class="btn" id="gen" ${isGestor()?'':'disabled'}>⚡ Gerar sugestões (14 dias)</button>
    <button class="btn sec" id="regen">↻ Recalcular</button><div class="spacer"></div><span class="muted" id="capInfo"></span></div>
  <div id="folgaOut"><p class="muted">O sistema sugere — você aprova. Clique em “Gerar sugestões”.</p></div>`;
  async function run(){
    const out=Engine.suggestDayOffs({employees:emps,rules,vacations:vacs,requests:reqs,refusals,blockedDates:blk,year,month,horizonDays:14,startDate:todayStr(),history});
    $('#capInfo').textContent=`Capacidade: ${out.capacity.level.replace('_',' ')} · folga máx ${out.capacity.maxHours}h`;
    const sugRows=out.suggestions.map((s,i)=>`<tr><td><b>${esc(s.employee_name)}</b></td><td>${Engine.DOW[Engine.parse(s.date).getDay()]} ${s.date}</td><td>${SHIFT_LABEL[s.shift]||s.shift}</td><td>${TYPE_LABEL[s.type]}</td><td>${s.hours}h</td>
      <td class="row-actions" id="act${i}">${isGestor()?`<button class="btn sm" data-ap="${i}">Aprovar</button><button class="btn sec sm" data-rf="${i}">Recusar</button>`:'<span class="muted">—</span>'}</td></tr>
      <tr><td colspan="6"><div class="reason">${esc(s.reason)}</div></td></tr>`).join('');
    const logRows=out.logs.map(l=>`<div class="reason" style="border-left-color:${l.type==='bloqueio'?'var(--red)':l.type==='rodizio'?'var(--purple)':'var(--brand)'}">${l.type==='bloqueio'?'🚫':l.type==='rodizio'?'🔁':'✅'} ${esc(l.message)}</div>`).join('');
    $('#folgaOut').innerHTML=`${out.suggestions.length?'':box('warn','Nenhuma folga sugerida — verifique banco mínimo, cobertura ou capacidade (veja o log).')}
      <div class="panel"><div class="ph"><h3>Sugestões de folga</h3><span class="muted">${out.suggestions.length} sugestão(ões)</span></div>
        <div class="pb" style="padding:0"><table><thead><tr><th>Funcionária</th><th>Dia</th><th>Turno</th><th>Tipo</th><th>Horas</th><th>Ação</th></tr></thead><tbody>${sugRows||'<tr><td colspan=6 class="muted" style="padding:16px">Sem sugestões.</td></tr>'}</tbody></table></div></div>
      <div class="section panel"><div class="ph"><h3>🧠 Log de decisão</h3><span class="muted">por que cada decisão foi tomada</span></div><div class="pb">${logRows||'<span class="muted">Sem registros.</span>'}</div></div>`;
    $$('[data-ap]').forEach(b=>b.onclick=async()=>{ if(!gate())return; const i=+b.dataset.ap; b.disabled=true;
      await saveApproval(out.suggestions[i],year,month);
      $('#act'+i).innerHTML='<span class="pill ativa">✓ Aprovado</span>'; toast('Folga aprovada — veja em Folgas aprovadas.'); });
    $$('[data-rf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; const i=+b.dataset.rf; const s=out.suggestions[i]; const motivo=prompt('Motivo da recusa:','')||'';
      await T('dayoff_requests').insert({employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,shift:s.shift,type:s.type,request_type:'recusa_folga',reason:motivo,status:'recusado'});
      $('#act'+i).innerHTML='<span class="pill afastada">✗ Recusado</span>'; toast('Recusa registrada. Recalcule para nova sugestão.'); });
  }
  async function saveApproval(s,y,m){
    let sched=(await T('schedules').select('*').eq('is_simulation',S.sim).eq('year',y).eq('month',m).order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
    if(!sched) sched=(await T('schedules').insert({year:y,month:m,status:'sugerida',is_simulation:S.sim,created_by:S.user.id}).select().single()).data;
    await T('schedule_items').insert({schedule_id:sched.id,employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,shift:s.shift,type:s.type,hours:s.hours,status:'aprovado',reason:s.reason});
    await T('decision_logs').insert({schedule_id:sched.id,employee_id:s.employee_id,employee_name:s.employee_name,decision_type:'sugestao',message:s.reason,is_simulation:S.sim});
  }
  $('#gen')?.addEventListener('click',run); $('#regen').onclick=run;
};

// ---------- FOLGAS APROVADAS (ver / editar / lançar) ----------
ROUTES.escala=async function(){
  const ini=todayStr().slice(0,8)+'01';
  const [emps,rules,items]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('schedule_items',b=>b.gte('date',ini).order('date'))]);
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addFolga" ${isGestor()?'':'disabled'}>+ Lançar folga</button>
    <div class="spacer"></div><span class="muted">${items.length} folga(s) a partir deste mês</span></div>
  ${box('info','Todas as folgas aprovadas. <b>Editar</b> troca o dia/horário, <b>Remover</b> apaga — útil quando a funcionária pede um dia diferente do que o sistema sugeriu. Você também pode <b>lançar</b> uma folga do zero.')}
  <div class="panel"><div class="pb" style="padding:0"><table>
    <thead><tr><th>Data</th><th>Funcionária</th><th>Compensação</th><th>Status</th><th></th></tr></thead>
    <tbody>${items.map(it=>`<tr>
      <td><b>${(it.date||'').split('-').reverse().join('/')}</b><br><span class="muted" style="font-size:11.5px">${it.date?Engine.DOW[Engine.parse(it.date).getDay()]:''}</span></td>
      <td><b>${esc(it.employee_name||map[it.employee_id]||'')}</b></td>
      <td><b>${folgaTimeLabel(it,rules)}</b> <span class="muted">(${TYPE_LABEL[it.type]||it.type}${it.hours?' · '+it.hours+'h':''})</span></td>
      <td><span class="pill ${it.status==='aprovado'?'ativa':it.status==='recusado'?'afastada':'ferias'}">${it.status==='aprovado'?'Aprovado':it.status}</span></td>
      <td class="row-actions">${isGestor()?`<button class="btn ghost sm" data-edf="${it.id}">Editar</button><button class="btn ghost sm" style="color:var(--red)" data-delf="${it.id}">Remover</button>`:''}</td>
    </tr>`).join('')||'<tr><td colspan=5 class="muted" style="padding:18px">Nenhuma folga registrada. Aprove no Motor de folgas ou clique em “Lançar folga”.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addFolga')?.addEventListener('click',()=>folgaModal(null,emps,rules));
  $$('[data-edf]').forEach(b=>b.onclick=()=>folgaModal(items.find(x=>x.id===b.dataset.edf),emps,rules));
  $$('[data-delf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; if(!confirm('Remover esta folga?'))return; await T('schedule_items').delete().eq('id',b.dataset.delf); toast('Folga removida.'); route(); });
};
function folgaModal(it,emps,rules){
  it=it||{};
  openModal(it.id?'Editar folga':'Lançar folga',`
    <div class="field"><label>Funcionária</label><select id="ff_emp">${emps.map(e=>`<option value="${e.id}" ${it.employee_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
    <div class="grid2">
      <div class="field"><label>Data</label><input id="ff_date" type="date" value="${it.date||todayStr()}"/></div>
      <div class="field"><label>Horas</label><input id="ff_hours" type="number" step="0.5" value="${it.hours||3}"/></div></div>
    <div class="grid2">
      <div class="field"><label>Período</label><select id="ff_shift"><option value="tarde" ${(it.shift==='tarde'||!it.shift)?'selected':''}>Tarde</option><option value="manha" ${it.shift==='manha'?'selected':''}>Manhã</option></select></div>
      <div class="field"><label>Ação</label><select id="ff_type"><option value="saida_antecipada" ${it.type!=='entrada_tarde'?'selected':''}>Sair mais cedo</option><option value="entrada_tarde" ${it.type==='entrada_tarde'?'selected':''}>Entrar mais tarde</option></select></div></div>
    <div class="reason" id="ff_preview"></div>
  `,async()=>{
    if(!gate())return false;
    const emp=emps.find(e=>e.id===$('#ff_emp').value);
    const date=$('#ff_date').value; if(!date){toast('Informe a data.');return false;}
    const d=Engine.parse(date);
    const sched=await getOrCreateSchedule(d.getFullYear(), d.getMonth()+1);
    const payload={schedule_id:sched.id, employee_id:emp.id, employee_name:emp.name, date, shift:$('#ff_shift').value, type:$('#ff_type').value, hours:+$('#ff_hours').value||3, status:'aprovado', reason:'Lançada/editada manualmente'};
    const r = it.id ? await T('schedule_items').update(payload).eq('id',it.id) : await T('schedule_items').insert(payload);
    if(r.error){toast(r.error.message);return false;}
    toast('Folga salva.'); route(); return true;
  });
  const upd=()=>{ const prev={type:$('#ff_type').value,shift:$('#ff_shift').value,hours:+$('#ff_hours').value||3}; $('#ff_preview').textContent='Vai aparecer no calendário como: '+folgaTimeLabel(prev,rules); };
  ['ff_type','ff_shift','ff_hours'].forEach(id=>$('#'+id)?.addEventListener('change',upd)); upd();
}

// ---------- RELATÓRIO DA SEMANA (texto p/ o grupo) ----------
function weekReportText(monday, emps, items, rot, vacs, rules){
  const days=[...Array(7)].map((_,i)=>{ const d=new Date(monday); d.setDate(d.getDate()+i); return Engine.fmt(d); });
  const start=days[0], end=days[6];
  const br=(ds)=>ds.split('-').reverse().slice(0,2).join('/');
  const dshort=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const inWeek=(ds)=>ds&&ds>=start&&ds<=end;
  const ss=(rules.saturday_start||'14:00').slice(0,5), se=(rules.saturday_end||'17:00').slice(0,5);
  let out=`*Escala da semana — ${br(start)} a ${br(end)}*\n`;
  const active=emps.filter(e=>e.status!=='desligada').sort((a,b)=>a.name.localeCompare(b.name));
  for(const e of active){
    const lines=[];
    items.filter(it=>it.employee_id===e.id && inWeek(it.date)).sort((a,b)=>a.date<b.date?-1:1)
      .forEach(it=>{ const dow=Engine.parse(it.date).getDay(); lines.push(`${dshort[dow]} ${br(it.date)} — ${folgaTimeLabel(it,rules)}`); });
    rot.filter(r=>r.employee_id===e.id && inWeek(r.saturday_date))
      .forEach(r=>lines.push(`Sáb ${br(r.saturday_date)} — Trabalha ${ss}–${se}`));
    const vac=vacs.find(v=>v.employee_id===e.id && v.start_date<=end && v.end_date>=start);
    if(vac) lines.push(`Férias (${br(vac.start_date)} a ${br(vac.end_date)})`);
    out+=`\n*${(e.name.split(' ')[0]||e.name).toUpperCase()}*\n`;
    out+= lines.length ? lines.map(l=>'• '+l).join('\n') : '• Horário normal a semana toda';
    out+='\n';
  }
  return out.trim();
}
ROUTES.relsemana=async function(){
  const today=new Date(); const dow=(today.getDay()+6)%7; // 0=segunda
  let monday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-dow);
  async function draw(){
    const start=Engine.fmt(monday); const end=Engine.fmt(new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+6));
    const [emps,rules,items,rot,vacs]=await Promise.all([
      getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),
      T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
      getAll('schedule_items',b=>b.gte('date',start).lte('date',end)),
      getAll('saturday_rotation',b=>b.gte('saturday_date',start).lte('saturday_date',end)),
      getAll('vacation_periods')]);
    const text=weekReportText(monday,emps,items,rot,vacs,rules);
    const br=(ds)=>ds.split('-').reverse().slice(0,2).join('/');
    $('#view').innerHTML=`
    <div class="toolbar">
      <button class="btn sec sm" id="wkPrev">←</button>
      <b style="min-width:190px;text-align:center">Semana ${br(start)} a ${br(end)}</b>
      <button class="btn sec sm" id="wkNext">→</button>
      <div class="spacer"></div><button class="btn" id="wkCopy">📋 Copiar relatório</button>
    </div>
    ${box('info','Texto pronto para colar no grupo da empresa. Use ← → para trocar de semana. Aparecem só as alterações (folgas, sábados, férias) — dias normais não entram.')}
    <div class="panel"><div class="pb"><pre id="wkText" style="white-space:pre-wrap;font-family:inherit;font-size:14px;margin:0;line-height:1.5">${esc(text)}</pre></div></div>`;
    $('#wkPrev').onclick=()=>{ monday=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()-7); draw(); };
    $('#wkNext').onclick=()=>{ monday=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+7); draw(); };
    $('#wkCopy').onclick=async()=>{ try{ await navigator.clipboard.writeText(text); toast('Relatório copiado! É só colar no grupo.'); }catch(_){ const r=document.createRange(); r.selectNode($('#wkText')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Texto selecionado — aperte Ctrl+C.'); } };
  }
  draw();
};

// ---------- SÁBADOS (editável + navegação de mês) ----------
ROUTES.sabados=async function(){
  const today=new Date(); const todayISO=Engine.fmt(today);
  let year=today.getFullYear(), month=today.getMonth()+1;
  // se os sábados abertos do mês atual já passaram, abre no próximo mês
  const s0=Engine.saturdaysOfMonth(year,month).slice(0,2);
  if(s0.length && Engine.fmt(s0[s0.length-1]) < todayISO){ month++; if(month>12){month=1;year++;} }

  async function load(){
    const [emps,rules,saved,hist,recent]=await Promise.all([
      getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),
      T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
      getAll('saturday_rotation',b=>b.eq('year',year).eq('month',month).order('saturday_number')),
      buildHistory(),
      getAll('saturday_rotation',b=>b.order('saturday_date',{ascending:false}).limit(12))]);
    const active=emps.filter(e=>e.status==='ativa');
    const empName=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const expert=new Set(emps.filter(e=>e.is_expert).map(e=>e.id));
    const sats=Engine.saturdaysOfMonth(year,month).slice(0,rules.saturday_open_count||2).map(Engine.fmt);
    const meta=Engine.saturdayRotation(active,rules,year,month,hist);
    const targets=meta.counts||[rules.saturday_first_count??3, rules.saturday_second_count??2];
    let state=saved.map(r=>({saturday_number:r.saturday_number, saturday_date:r.saturday_date||sats[r.saturday_number-1], employee_id:r.employee_id, employee_name:r.employee_name||empName[r.employee_id]}));
    const invNote=meta.inverted?`<div class="reason" style="border-left-color:var(--purple)">🔁 Inversão automática: <b>${esc(meta.commName)}</b> perto do 2º sábado → reforço no 2º sábado (mais gente lá).</div>`:'';
    const passed = sats.length && sats[sats.length-1] < todayISO;

    function renderEditor(){
      const cards=sats.map((d,idx)=>{
        const n=idx+1, tgt=targets[idx]||0;
        const assigned=state.filter(a=>a.saturday_number===n);
        const avail=active.filter(e=>!assigned.some(a=>a.employee_id===e.id));
        const ok=assigned.length===tgt;
        const noExp=assigned.length>0 && !assigned.some(a=>expert.has(a.employee_id));
        return `<div class="panel" style="margin-bottom:12px"><div class="ph">
          <h3>${n}º sábado · ${d.split('-').reverse().join('/')}</h3>
          <span class="pill ${ok?'ativa':'ferias'}">${assigned.length}/${tgt} pessoas</span></div>
          <div class="pb">
            ${assigned.map(a=>`<span class="pill ativa" style="margin:0 8px 8px 0;display:inline-flex;align-items:center;gap:7px;font-size:13px">${esc(a.employee_name)}${expert.has(a.employee_id)?' ⭐':''} ${isGestor()?`<button class="x" style="font-size:15px;line-height:1;padding:0" data-rm="${n}|${a.employee_id}" title="remover">×</button>`:''}</span>`).join('')||'<span class="muted">Ninguém escalado ainda.</span>'}
            ${noExp?`<div class="alert warn" style="margin-top:8px">⚠️ Este sábado está <b>sem especialista</b> (⭐). Adicione pelo menos uma.</div>`:''}
            ${isGestor()?`<div style="margin-top:10px;max-width:300px"><select data-add="${n}"><option value="">+ adicionar funcionária…</option>${avail.map(e=>`<option value="${e.id}">${esc(e.name)}${e.is_expert?' ⭐':''}</option>`).join('')}</select></div>`:''}
          </div></div>`;
      }).join('');
      $('#satEditor').innerHTML=cards+(invNote?`<div class="section">${invNote}</div>`:'');
      $$('[data-rm]').forEach(b=>b.onclick=()=>{ const [n,id]=b.dataset.rm.split('|'); state=state.filter(a=>!(String(a.saturday_number)===n&&a.employee_id===id)); renderEditor(); });
      $$('[data-add]').forEach(s=>s.onchange=()=>{ const n=+s.dataset.add, id=s.value; if(!id)return; const e=emps.find(x=>x.id===id); state.push({saturday_number:n,saturday_date:sats[n-1],employee_id:id,employee_name:e.name}); renderEditor(); });
    }

    $('#view').innerHTML=`
    <div class="toolbar">
      <button class="btn sec sm" id="satPrev">←</button>
      <b style="min-width:150px;text-align:center">${MONTHS[month-1]} ${year}</b>
      <button class="btn sec sm" id="satNext">→</button>
      <button class="btn" id="genSat" ${isGestor()?'':'disabled'}>⚡ Gerar sugestão</button>
      <button class="btn sec" id="saveSat" ${isGestor()?'':'disabled'}>💾 Salvar rodízio</button>
      <div class="spacer"></div><span class="muted">${rules.saturday_start||'14:00'}–${rules.saturday_end||'17:00'}</span>
    </div>
    ${passed?box('warn','Estes sábados <b>já passaram</b>. Você pode registrar quem trabalhou (alimenta o histórico) ou ir para um mês futuro no <b>→</b>.'):box('info','O sistema sugere e <b>equilibra pelo histórico</b>. Ajuste na mão: remova no × e adicione pela lista — útil quando alguém pede para trocar um sábado. Depois <b>Salvar rodízio</b>.')}
    <div id="satEditor"></div>
    <div class="section panel"><div class="ph"><h3>Histórico de sábados</h3></div><div class="pb" style="padding:0">
      <table><thead><tr><th>Data</th><th>Sábado</th><th>Funcionária</th></tr></thead>
      <tbody>${recent.map(r=>`<tr><td>${r.saturday_date||'—'}</td><td>${r.saturday_number}º</td><td><b>${esc(r.employee_name||empName[r.employee_id]||'')}</b></td></tr>`).join('')||'<tr><td colspan=3 class="muted" style="padding:16px">Sem histórico ainda.</td></tr>'}
      </tbody></table></div></div>`;
    renderEditor();
    $('#satPrev').onclick=()=>{ month--; if(month<1){month=12;year--;} load(); };
    $('#satNext').onclick=()=>{ month++; if(month>12){month=1;year++;} load(); };
    $('#genSat')?.addEventListener('click',()=>{ if(!gate())return; state=meta.assignments.map(a=>({...a})); renderEditor(); toast('Sugestão gerada — ajuste se precisar e salve.'); });
    $('#saveSat')?.addEventListener('click',async()=>{ if(!gate())return;
      if(!state.length){ toast('Nada para salvar. Gere a sugestão ou adicione funcionárias.'); return; }
      await T('saturday_rotation').delete().eq('year',year).eq('month',month);
      const payload=state.map(a=>({month,year,saturday_number:a.saturday_number,saturday_date:a.saturday_date,employee_id:a.employee_id,employee_name:a.employee_name,worked:true,status:'aprovado',reason:'Rodízio'}));
      const res=await T('saturday_rotation').insert(payload); if(res.error){toast(res.error.message);return;}
      toast('Rodízio salvo! O histórico vai equilibrar os próximos meses.'); load(); });
  }
  load();
};

// ---------- CALENDÁRIO ----------
ROUTES.calendario=async function(){
  const now=new Date(); let year=now.getFullYear(), month=now.getMonth()+1;
  async function draw(){
    const first=new Date(year,month-1,1), startDow=first.getDay(), dim=Engine.daysInMonth(year,month);
    const mm=String(month).padStart(2,'0');
    const [items,vacs,rules,blk,emps,rot]=await Promise.all([
      getAll('schedule_items',b=>b.gte('date',`${year}-${mm}-01`).lte('date',`${year}-${mm}-${dim}`)),
      getAll('vacation_periods'),T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),getAll('blocked_dates'),
      getAll('employees',b=>b.eq('is_simulation',S.sim)),
      getAll('saturday_rotation',b=>b.eq('year',year).eq('month',month))]);
    const nm=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const sats=Engine.saturdaysOfMonth(year,month).slice(0,rules.saturday_open_count||2).map(Engine.fmt);
    const dowFull=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const dayEv=[];
    for(let d=1;d<=dim;d++){
      const ds=`${year}-${mm}-${String(d).padStart(2,'0')}`; const dow=new Date(year,month-1,d).getDay();
      let ev='';
      items.filter(x=>x.date===ds).forEach(x=>{ const fn=(x.employee_name||'').split(' ')[0]; const t=folgaTimeLabel(x,rules); ev+=`<span class="ev folga" title="${esc(x.employee_name||'')} — ${esc(t)}">${esc(fn)}<span class="evt">${esc(t)}</span></span>`; });
      vacs.filter(v=>ds>=v.start_date&&ds<=v.end_date).forEach(v=>{ const fn=(nm[v.employee_id]||'').split(' ')[0]; ev+=`<span class="ev fer">${esc(fn)}<span class="evt">Férias</span></span>`; });
      rot.filter(r=>r.saturday_date===ds).forEach(r=>{ const fn=(r.employee_name||nm[r.employee_id]||'').split(' ')[0]; ev+=`<span class="ev sab" title="${esc(r.employee_name||'')}">${esc(fn)}</span>`; });
      if(sats.includes(ds) && !rot.some(r=>r.saturday_date===ds)) ev+=`<span class="ev sab">Sábado (definir)</span>`;
      if(blk.some(b=>b.date===ds)) ev+=`<span class="ev blk">Bloqueio</span>`;
      dayEv[d]={ev,dow};
    }
    const mobile = window.innerWidth < 720;
    let body;
    if(mobile){
      let rows='';
      for(let d=1;d<=dim;d++){ const x=dayEv[d]; if(!x.ev) continue;
        rows+=`<div style="display:flex;gap:12px;padding:11px 2px;border-bottom:1px solid var(--line)"><div style="min-width:54px;text-align:center"><div style="font-size:21px;font-weight:800;line-height:1">${d}</div><div class="muted" style="font-size:11px">${dowFull[x.dow].slice(0,3)}</div></div><div style="flex:1;min-width:0">${x.ev}</div></div>`; }
      body=`<div class="panel"><div class="pb">${rows||'<p class="muted" style="margin:0">Nada agendado neste mês.</p>'}</div></div>`;
    } else {
      let cells='';
      for(let i=0;i<startDow;i++) cells+=`<div class="day out"></div>`;
      for(let d=1;d<=dim;d++){ const x=dayEv[d]; cells+=`<div class="day ${x.dow===6?'sat':''}"><span class="dn">${d}</span>${x.ev}</div>`; }
      body=`<div class="panel"><div class="pb"><div class="cal">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<div class="dow">${d}</div>`).join('')}${cells}</div></div></div>`;
    }
    $('#view').innerHTML=`
    <div class="toolbar"><button class="btn sec sm" id="prev">←</button><b style="min-width:140px;text-align:center">${MONTHS[month-1]} ${year}</b><button class="btn sec sm" id="next">→</button><div class="spacer"></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Folga</span><span><i class="dot" style="background:var(--amber)"></i>Férias</span><span><i class="dot" style="background:var(--purple)"></i>Sábado</span><span><i class="dot" style="background:var(--red)"></i>Bloqueio</span></div></div>
    ${body}`;
    $('#prev').onclick=()=>{month--;if(month<1){month=12;year--;}draw();};
    $('#next').onclick=()=>{month++;if(month>12){month=1;year++;}draw();};
  }
  draw();
};

// ---------- PEDIDOS ----------
ROUTES.pedidos=async function(){
  const [emps,reqs]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),getAll('dayoff_requests',b=>b.order('created_at',{ascending:false}).limit(50))]);
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addReq" ${isGestor()?'':'disabled'}>+ Registrar pedido / exceção</button></div>
  <div class="panel"><div class="pb" style="padding:0"><table>
    <thead><tr><th>Funcionária</th><th>Data</th><th>Tipo</th><th>Motivo</th><th>Status</th><th></th></tr></thead>
    <tbody>${reqs.map(r=>`<tr><td><b>${esc(r.employee_name||map[r.employee_id]||'—')}</b></td><td>${r.date||'—'}</td><td>${reqTypeLabel(r.request_type)}</td><td class="muted">${esc(r.reason||'')}</td>
      <td><span class="pill ${r.status==='aprovado'?'ativa':r.status==='recusado'?'afastada':'ferias'}">${r.status}</span></td>
      <td class="row-actions">${isGestor()&&r.status==='pendente'?`<button class="btn sm" data-ap="${r.id}">Aprovar</button><button class="btn sec sm" data-rf="${r.id}">Recusar</button>`:''}</td></tr>`).join('')||'<tr><td colspan=6 class="muted" style="padding:16px">Nenhum pedido registrado.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addReq')?.addEventListener('click',()=>{
    openModal('Registrar pedido / exceção',`
      <div class="field"><label>Funcionária</label><select id="q_emp">${emps.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label>Data</label><input id="q_date" type="date" value="${todayStr()}"/></div>
        <div class="field"><label>Tipo</label><select id="q_type"><option value="pedido_folga">Pedido de folga</option><option value="troca_folga">Troca de folga</option><option value="falta">Falta</option><option value="atestado">Atestado</option><option value="saida_antecipada">Saída antecipada</option><option value="atraso">Atraso</option></select></div></div>
      <div class="field"><label>Motivo</label><input id="q_reason"/></div>`,
      async()=>{ if(!gate())return false; const emp=emps.find(e=>e.id===$('#q_emp').value);
        const res=await T('dayoff_requests').insert({employee_id:emp.id,employee_name:emp.name,date:$('#q_date').value,request_type:$('#q_type').value,reason:$('#q_reason').value,status:'pendente'});
        if(res.error){toast(res.error.message);return false;} toast('Registrado.'); route(); return true; });
  });
  $$('[data-ap]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('dayoff_requests').update({status:'aprovado'}).eq('id',b.dataset.ap); toast('Aprovado.'); route(); });
  $$('[data-rf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('dayoff_requests').update({status:'recusado'}).eq('id',b.dataset.rf); toast('Recusado.'); route(); });
};
function reqTypeLabel(t){return {pedido_folga:'Pedido de folga',recusa_folga:'Recusa de folga',falta:'Falta',atestado:'Atestado',saida_antecipada:'Saída antecipada',atraso:'Atraso',troca_folga:'Troca de folga'}[t]||t;}

// ---------- RELATÓRIOS ----------
ROUTES.relatorios=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1;
  const [emps,items,reqs,rot]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim)),getAll('schedule_items'),getAll('dayoff_requests'),getAll('saturday_rotation')]);
  const history=await buildHistory();
  const fair=Engine.fairnessIndex(emps,history);
  const ballColor={justo:'var(--green)',aceitavel:'var(--brand)',atencao:'var(--amber)',desequilibrado:'var(--red)'}[fair.status];
  const perEmp=emps.map(e=>({e,folgas:items.filter(i=>i.employee_id===e.id&&i.status==='aprovado').length,sabados:rot.filter(r=>r.employee_id===e.id).length,faltas:reqs.filter(r=>r.employee_id===e.id&&r.request_type==='falta').length,recusas:reqs.filter(r=>r.employee_id===e.id&&r.request_type==='recusa_folga').length}));
  $('#view').innerHTML=`
  <div class="cards">
    <div class="card"><h3>Índice de justiça</h3><div class="fair" style="font-size:20px"><span class="ball" style="background:${ballColor}"></span>${fair.status} · ${fair.score}</div><div class="reason">${esc(fair.reason)}</div></div>
    <div class="card"><h3>Folgas aprovadas</h3><div class="kpi">${items.filter(i=>i.status==='aprovado').length}</div></div>
    <div class="card"><h3>Sábados trabalhados</h3><div class="kpi">${rot.length}</div></div>
    <div class="card"><h3>Em férias</h3><div class="kpi">${emps.filter(e=>e.status==='ferias').length}</div></div>
  </div>
  <div class="section panel"><div class="ph"><h3>Resumo por funcionária — ${MONTHS[month-1]} ${year}</h3></div><div class="pb" style="padding:0">
    <table><thead><tr><th>Funcionária</th><th>Banco atual</th><th>Folgas</th><th>Sábados</th><th>Faltas</th><th>Recusas</th></tr></thead>
    <tbody>${perEmp.map(p=>`<tr><td><b>${esc(p.e.name)}</b></td><td>${fmtH(p.e.time_bank_balance)}</td><td>${p.folgas}</td><td>${p.sabados}</td><td>${p.faltas}</td><td>${p.recusas}</td></tr>`).join('')||'<tr><td colspan=6 class="muted" style="padding:16px">Sem dados.</td></tr>'}
    </tbody></table></div></div>`;
};

// ---------- SIMULAÇÃO ----------
ROUTES.simulacao=async function(){
  $('#view').innerHTML=`
  ${box('info','<b>Modo simulação.</b> Crie funcionárias fictícias e teste cenários sem tocar nos dados reais. Com o modo ativo, todo o sistema passa a mostrar os dados fictícios (uma faixa roxa avisa no topo).')}
  <div class="toolbar">
    <button class="btn ${S.sim?'':'sec'}" id="simToggle">${S.sim?'🧪 Modo simulação ATIVO — clique para sair':'🧪 Ativar modo simulação'}</button></div>
  <div class="toolbar"><button class="btn" id="seedSim" ${isGestor()?'':'disabled'}>🌱 Criar/Resetar funcionárias fictícias</button>
    <button class="btn sec" id="clearSim" ${isGestor()?'':'disabled'}>🗑️ Limpar dados de simulação</button></div>
  <p id="simToggleNote"></p>
  <div class="section panel"><div class="ph"><h3>Cenários prontos</h3></div><div class="pb">
    <div class="cards">${Engine.SCENARIOS.map((s,i)=>`<div class="card"><h3 style="text-transform:none;color:var(--ink);font-size:14px">${esc(s.name)}</h3><button class="btn sm" data-scn="${i}" style="margin-top:6px" ${isGestor()?'':'disabled'}>Aplicar</button></div>`).join('')}</div>
    <div id="scnOut" class="section"></div></div></div>`;
  $('#simToggle').onclick=()=>{ S.sim=!S.sim; route(); };
  $('#seedSim')?.addEventListener('click',async()=>{ if(!gate())return;
    await T('employees').delete().eq('is_simulation',true);
    const res=await T('employees').insert(Engine.simEmployees().map(e=>({...e,is_simulation:true}))); if(res.error){toast(res.error.message);return;}
    S.sim=true; toast('6 fictícias criadas e modo simulação ativado.'); route(); });
  $('#clearSim')?.addEventListener('click',async()=>{ if(!gate())return; if(!confirm('Apagar dados de simulação?'))return;
    await T('employees').delete().eq('is_simulation',true); await T('schedules').delete().eq('is_simulation',true); S.sim=false; toast('Dados de simulação removidos.'); route(); });
  $$('[data-scn]').forEach(b=>b.onclick=async()=>{
    const scn=Engine.SCENARIOS[+b.dataset.scn];
    let emps=await getAll('employees',q=>q.eq('is_simulation',true));
    if(!emps.length){ toast('Crie as funcionárias fictícias primeiro.'); return; }
    emps=scn.apply(JSON.parse(JSON.stringify(emps)));
    const rules=(await T('store_rules').select('*').eq('id',1).maybeSingle()).data||{min_per_shift:4,min_time_bank_for_dayoff:6,max_dayoff_hours:8};
    const out=Engine.suggestDayOffs({employees:emps,rules,vacations:[],requests:[],refusals:[],blockedDates:[],year:2026,month:6,horizonDays:10,startDate:todayStr(),history:{}});
    const fair=Engine.fairnessIndex(emps,{});
    $('#scnOut').innerHTML=`<div class="panel"><div class="ph"><h3>Resultado — ${esc(scn.name)}</h3>
      <span class="fair"><span class="ball" style="width:12px;height:12px;border-radius:50%;background:${({justo:'var(--green)',aceitavel:'var(--brand)',atencao:'var(--amber)',desequilibrado:'var(--red)'})[fair.status]}"></span>${fair.status} (${fair.score})</span></div>
      <div class="pb"><p class="muted">Capacidade: <b>${out.capacity.level.replace('_',' ')}</b> — ${esc(out.capacity.note)}</p>
      <table><thead><tr><th>Funcionária</th><th>Dia</th><th>Tipo</th><th>Horas</th></tr></thead>
      <tbody>${out.suggestions.map(s=>`<tr><td><b>${esc(s.employee_name)}</b></td><td>${Engine.DOW[Engine.parse(s.date).getDay()]} ${s.date}</td><td>${TYPE_LABEL[s.type]}</td><td>${s.hours}h</td></tr>`).join('')||'<tr><td colspan=4 class="muted">Nenhuma folga liberada neste cenário.</td></tr>'}</tbody></table>
      <div class="section"><b>🧠 Log de decisão</b>${out.logs.map(l=>`<div class="reason" style="border-left-color:${l.type==='bloqueio'?'var(--red)':'var(--brand)'}">${l.type==='bloqueio'?'🚫':'✅'} ${esc(l.message)}</div>`).join('')}</div></div></div>`;
  });
};

// ---------- Modal ----------
function openModal(title,body,onSave){
  const root=$('#modalRoot');
  root.innerHTML=`<div class="modal-bg"><div class="modal"><div class="mh"><h3>${esc(title)}</h3><button class="x" id="mClose">×</button></div><div class="mb">${body}</div><div class="mf"><button class="btn sec" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div></div></div>`;
  const close=()=>root.innerHTML='';
  $('#mClose').onclick=close; $('#mCancel').onclick=close;
  $('.modal-bg').onclick=(e)=>{ if(e.target.classList.contains('modal-bg')) close(); };
  $('#mSave').onclick=async()=>{ const ok=await onSave(); if(ok!==false) close(); };
}

// ---------- start ----------
$('#liBtn').onclick=doLogin;
$('#liSignup').onclick=(e)=>{e.preventDefault();doSignup();};
$('#liPass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
$('#logoutBtn').onclick=logout;
$('#backBtn').onclick=()=>{ location.hash='#home'; };
if(sb) boot(); else { $('#boot') && ($('#boot').style.display='none'); $('#login').style.display='flex'; $('#loginErr').innerHTML=box('err','config.js não configurado.'); }
})();
