// ============================================================
// APP — Sistema de Escalas Ótica Carina  (navegação em cards) — v41 (ausências só em Pedidos & exceções; enum esc_request_type ganhou afastamento)
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
  if(['falta','atestado','afastamento'].includes(it.type)) return 'Dia inteiro fora';
  return TYPE_LABEL[it.type]||'Folga';
}
// chave de ordenação por horário: manhã antes da tarde (integral primeiro)
function folgaSortKey(it,r){
  r=r||{}; const toMin=s=>{const[h,m]=String(s||'').split(':').map(Number);return (h||0)*60+(m||0);};
  const lab=folgaTimeLabel(it,r); const m=lab.match(/(\d{2}):(\d{2})/);
  if(m) return (+m[1])*60+(+m[2]);
  if(it.shift==='manha') return toMin(r.open_morning||'09:00');
  if(it.shift==='tarde') return toMin(r.open_afternoon||'14:00');
  return 0; // integral / dia inteiro
}
async function getOrCreateSchedule(year,month){
  let s=(await T('schedules').select('*').eq('is_simulation',S.sim).eq('year',year).eq('month',month).order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
  if(!s) s=(await T('schedules').insert({year,month,status:'aprovada',is_simulation:S.sim,created_by:S.user.id}).select().single()).data;
  return s;
}
const TYPE_LABEL={integral:'Folga integral',meio_turno:'Meio turno',entrada_tarde:'Entrada mais tarde',saida_antecipada:'Saída antecipada',falta:'Falta',atestado:'Atestado',afastamento:'Afastamento'};
const ABSENCE_TYPES=['falta','atestado','afastamento']; // ausências de dia inteiro que NÃO usam banco de horas
function box(kind,msg){ return `<div class="alert ${kind}"><span>${kind==='err'?'⚠️':kind==='ok'?'✅':kind==='warn'?'🔔':'ℹ️'}</span><div>${msg}</div></div>`; }

// ---------- DB ----------
const T=(name)=>sb.from('esc_'+name);
async function getAll(name, q){ let b=T(name).select('*'); if(q) b=q(b); const {data,error}=await b; if(error){console.warn(name,error.message);} return data||[]; }

// Lembrete: quando o banco de horas foi atualizado pela última vez (via planilha)
async function bankFreshnessBanner(){
  const {data}=await T('time_bank_imports').select('imported_at,file_name').eq('source','planilha').order('imported_at',{ascending:false}).limit(1).maybeSingle();
  if(!data) return box('warn','<b>Banco de horas ainda não foi importado por planilha.</b> Antes de planejar folgas, importe a planilha (coluna <b>Total</b>) do TiqueTaque em <b>TiqueTaque → Banco de horas</b>.');
  const dt=new Date(data.imported_at);
  const startOfDay=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x.getTime();};
  const days=Math.round((startOfDay(Date.now())-startOfDay(dt))/86400000);
  const quando=dt.toLocaleDateString('pt-BR')+' às '+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  if(days>=8) return box('warn',`<b>Banco de horas atualizado há ${days} dias</b> (${quando}). Antes de decidir folgas, vale reimportar a planilha (Total) do TiqueTaque.`);
  return box('ok',`<b>Banco de horas atualizado em ${quando}</b> ${days>0?`(há ${days} dia${days>1?'s':''})`:'(hoje)'} — dado fresco para planejar.`);
}

// Histórico real (justiça): folgas aprovadas + sábados trabalhados por funcionária.
// refISO = data de referência (Monday da semana sendo planejada). Só contam folgas ANTES dessa data,
// então a recência ("há quanto tempo sem folgar") fica correta inclusive ao simular semanas futuras.
async function buildHistory(refISO){
  const scheds=await getAll('schedules',b=>b.eq('is_simulation',S.sim));
  const schedIds=new Set(scheds.map(s=>s.id));
  const items=(await getAll('schedule_items',b=>b.eq('status','aprovado'))).filter(it=>schedIds.has(it.schedule_id));
  const rot=await getAll('saturday_rotation');
  const ref=refISO ? new Date(refISO+'T00:00:00') : new Date();
  const h={};
  const get=(id)=> h[id]||(h[id]={dayoffs:0,fridaysOff:0,mondaysOff:0,saturdays:0,integral:0,meioTurno:0,lastDayOffDays:null,lastFridayISO:null,lastMondayISO:null});
  for(const it of items){ if(!it.employee_id||!it.date) continue;
    const d=new Date(it.date+'T00:00:00'); const dow=d.getDay();
    const days=Math.floor((ref-d)/86400000);
    if(days<=0) continue; // só folgas ANTES da semana de referência contam para a justiça/recência
    if(ABSENCE_TYPES.includes(it.type)) continue; // falta/atestado/afastamento não são folgas — não entram na justiça
    const r=get(it.employee_id); r.dayoffs++;
    if(dow===5){ r.fridaysOff++; if(!r.lastFridayISO||it.date>r.lastFridayISO) r.lastFridayISO=it.date; }
    if(dow===1){ r.mondaysOff++; if(!r.lastMondayISO||it.date>r.lastMondayISO) r.lastMondayISO=it.date; }
    if(it.type==='integral') r.integral++; if(it.type==='meio_turno') r.meioTurno++; // folgas "boas" para a justiça histórica
    if(r.lastDayOffDays==null||days<r.lastDayOffDays) r.lastDayOffDays=days;
  }
  for(const s of rot){ if(s.employee_id && s.worked!==false) get(s.employee_id).saturdays++; }
  return h;
}

// Reconciliação automática do banco: compara as 2 últimas importações de planilha.
// Se o banco de alguém caiu, ela usou horas → confere com a folga programada ou registra como saída avulsa.
async function reconcileBank(){
  const imps=await getAll('time_bank_imports',b=>b.eq('source','planilha').order('imported_at',{ascending:false}).limit(2));
  if(imps.length<2) return [];
  const cur=imps[0], prev=imps[1];
  if(cur.reconciled) return []; // já processado
  const [curBal,prevBal,scheds]=await Promise.all([
    getAll('time_bank_balances',b=>b.eq('import_id',cur.id)),
    getAll('time_bank_balances',b=>b.eq('import_id',prev.id)),
    getAll('schedules',b=>b.eq('is_simulation',false))]);
  const sIds=new Set(scheds.map(s=>s.id));
  const keyOf=b=>b.employee_id||('n:'+(b.employee_name||'').toLowerCase());
  const prevMap={}; prevBal.forEach(b=>{prevMap[keyOf(b)]=+b.balance_hours||0;});
  const w0=(prev.imported_at||'').slice(0,10), w1=(cur.imported_at||todayStr()).slice(0,10);
  const items=(await getAll('schedule_items',b=>b.eq('status','aprovado').gte('date',w0).lte('date',w1))).filter(it=>sIds.has(it.schedule_id));
  const rows=[];
  for(const cb of curBal){
    const before=prevMap[keyOf(cb)]; if(before==null) continue;
    const delta=Math.round((before-(+cb.balance_hours||0))*100)/100; // queda de banco
    if(delta<0.25) continue; // sem queda relevante (ignora arredondamento)
    const folgas=cb.employee_id?items.filter(it=>it.employee_id===cb.employee_id):[];
    const folgaH=Math.round(folgas.reduce((s,it)=>s+(+it.hours||0),0)*100)/100;
    let note, matched=false;
    if(folgas.length && Math.abs(folgaH-delta)<=0.6){ matched=true; note=`Usou ${fmtH(delta)} — confere com folga programada (${folgas.map(f=>f.date.split('-').reverse().slice(0,2).join('/')).join(', ')}).`; }
    else if(folgas.length){ matched=true; note=`Usou ${fmtH(delta)}; tinha folga programada de ${fmtH(folgaH)} — diferença de ${fmtH(Math.abs(delta-folgaH))} pode ser saída avulsa.`; }
    else { note=`Usou ${fmtH(delta)} do banco SEM folga programada — provável saída avulsa/imprevisto.`; }
    rows.push({usage_date:w1, employee_id:cb.employee_id||null, employee_name:cb.employee_name, hours:delta, matched, note});
  }
  if(rows.length) await T('bank_usage').insert(rows);
  await T('time_bank_imports').update({reconciled:true}).eq('id',cur.id);
  return rows;
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
const HOME_TOP=['dashboard','folgas','escala','relatorios'];
const HOME_BOTTOM=['sabados','calendario','pedidos','config'];
const HOME_KEYS=[...HOME_TOP,...HOME_BOTTOM];
const CONFIG_KEYS=['funcionarias','ferias','tiquetaque','regras','simulacao'];

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
    <img src="logo.png" class="home-logo" alt="Ótica Carina" />
    <div class="tag">Sistema de Escalas &amp; Banco de Horas</div>
    <div style="margin-top:12px;display:flex;gap:20px;justify-content:center;flex-wrap:wrap">
      <a href="#tiquetaque" style="color:var(--brand);font-weight:600;font-size:14px">🔄 Sincronizar banco de horas (TiqueTaque)</a>
      <a href="#relsemana" style="color:var(--brand);font-weight:600;font-size:14px">📋 Relatório da semana (grupo)</a>
    </div>
  </div>
  ${cardsFor(HOME_TOP,'cols4')}${cardsFor(HOME_BOTTOM,'cols4')}`;
  $$('[data-go]').forEach(el=>el.onclick=()=>location.hash='#'+el.dataset.go);
}
ROUTES.config=function(){
  $('#view').innerHTML=`${box('info','Aqui ficam os ajustes e cadastros. As telas do dia a dia (folgas, sábados, calendário) estão na tela inicial.')}${cardsFor(CONFIG_KEYS)}`;
  $$('[data-go]').forEach(el=>el.onclick=()=>location.hash='#'+el.dataset.go);
};

// ---------- DASHBOARD ----------
ROUTES.dashboard=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1; const todayISO=todayStr();
  const [emps,rules,dscheds,vacs,dreqs]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('schedules',b=>b.eq('is_simulation',S.sim)),
    getAll('vacation_periods'),
    getAll('dayoff_requests')]);
  const dschedIds=new Set(dscheds.map(s=>s.id));
  const wkItems=(await getAll('schedule_items',b=>b.eq('status','aprovado').gte('date',todayISO))).filter(it=>dschedIds.has(it.schedule_id));
  const active=emps.filter(e=>e.status==='ativa');
  const nmById=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  const cap=Engine.operationalCapacity(emps,rules);
  const minPer=rules.min_per_shift||4;
  // INDISPONÍVEIS HOJE (dia inteiro fora): status (férias/licença/afastada) + período de férias + folga integral / falta / atestado / afastamento de hoje
  const FULLDAY_OUT=['integral','falta','atestado','afastamento'];
  const reasonsOut={};
  emps.forEach(e=>{ if(e.status==='ferias') reasonsOut[e.id]='Férias'; else if(e.status==='licenca') reasonsOut[e.id]='Licença'; else if(e.status==='afastada') reasonsOut[e.id]='Afastada'; });
  (vacs||[]).forEach(v=>{ if(v.employee_id && todayISO>=v.start_date && todayISO<=v.end_date && !reasonsOut[v.employee_id]) reasonsOut[v.employee_id]='Férias'; });
  const todayItems=wkItems.filter(it=>it.date===todayISO);
  todayItems.forEach(it=>{ if((FULLDAY_OUT.includes(it.type)||it.shift==='dia_inteiro') && !reasonsOut[it.employee_id]) reasonsOut[it.employee_id]=TYPE_LABEL[it.type]||'Folga integral'; });
  // exceções registradas (falta/atestado/afastamento) também tiram a pessoa do dia
  (dreqs||[]).forEach(r=>{ if(['falta','atestado','afastamento'].includes(r.request_type) && r.date===todayISO && (r.status==='aprovado'||!r.status) && !reasonsOut[r.employee_id]) reasonsOut[r.employee_id]=TYPE_LABEL[r.request_type]||reqTypeLabel(r.request_type); });
  const meioToday=todayItems.filter(it=>it.type==='meio_turno' && !reasonsOut[it.employee_id]);
  const outIds=Object.keys(reasonsOut);
  const outList=outIds.map(id=>`${esc(nmById[id]||'')} (${reasonsOut[id]})`).concat(meioToday.map(it=>`${esc(nmById[it.employee_id]||'')} (Meio turno)`));
  const availToday=active.filter(e=>!reasonsOut[e.id]).length;
  const tCrit=rules.bank_alert_critico??20, tMax=rules.bank_alert_maxima??16, tAlta=rules.bank_alert_alta??12;
  const critBank=emps.filter(e=>(e.time_bank_balance||0)>=tCrit);
  const altaBank=emps.filter(e=>(e.time_bank_balance||0)>=tAlta && (e.time_bank_balance||0)<tCrit);
  const totalBank=emps.reduce((s,e)=>s+(+e.time_bank_balance||0),0);
  const dataBRhoje=todayISO.split('-').reverse().slice(0,2).join('/');
  let alerts='';
  if(availToday<=minPer) alerts+=box('err',`<b>Cobertura mínima em risco hoje:</b> só ${availToday} disponível(is) para o mínimo de ${minPer} por turno — sem margem para folga.`);
  else if(availToday<=minPer+1) alerts+=box('warn',`<b>Equipe no limite hoje:</b> ${availToday} disponível(is) (mínimo ${minPer}) — pouca margem para folga.`);
  if(outList.length) alerts+=box('warn',`<b>Indisponíveis hoje (${dataBRhoje}):</b> ${outList.join(' · ')}.`);
  if(critBank.length) alerts+=box('err',`<b>Banco de horas CRÍTICO (≥ ${fmtH(tCrit)}):</b> ${critBank.map(e=>e.name+' ('+fmtH(e.time_bank_balance)+')').join(', ')}. Prioridade máxima para compensar com folga.`);
  if(altaBank.length) alerts+=box('warn',`<b>Banco de horas alto (≥ ${fmtH(tAlta)}):</b> ${altaBank.map(e=>e.name+' ('+fmtH(e.time_bank_balance)+')').join(', ')}. Priorize folgas para estas.`);
  if(!alerts) alerts=box('ok','Tudo sob controle: cobertura adequada e banco dentro do limite.');
  // banco previsto: desconta TODAS as folgas aprovadas a partir de hoje (ausências têm 0h, não descontam)
  const folgaH={}; const folgaDates={};
  wkItems.forEach(it=>{ folgaH[it.employee_id]=(folgaH[it.employee_id]||0)+(+it.hours||0); (folgaDates[it.employee_id]=folgaDates[it.employee_id]||[]).push(it.date); });
  const totalFolga=Object.values(folgaH).reduce((s,h)=>s+h,0);
  const totalPrev=totalBank-totalFolga;
  // reconciliação automática (também pega importações feitas pelo robô das 7h) + usos recentes
  if(!S.sim){ try{ await reconcileBank(); }catch(_){} }
  const usos = S.sim?[]:await getAll('bank_usage',b=>b.order('created_at',{ascending:false}).limit(8));
  const fresh=await bankFreshnessBanner();
  $('#view').innerHTML=`
  ${fresh}
  <div class="cards">
    <div class="card"><h3>Disponíveis hoje</h3><div class="kpi">${availToday}<small> / ${active.length} ativas</small></div></div>
    <div class="card"><h3>Indisponíveis hoje</h3><div class="kpi">${outIds.length}${meioToday.length?`<small> + ${meioToday.length} meio turno</small>`:''}</div></div>
    <div class="card"><h3>Capacidade operacional</h3><div class="kpi" style="font-size:17px;text-transform:capitalize">${cap.level.replace('_',' ')}</div></div>
  </div>
  <div class="cards section">
    <div class="card"><h3>Banco real (importado)</h3><div class="kpi">${fmtH(totalBank)}</div></div>
    <div class="card"><h3>Folga prevista (todas aprovadas)</h3><div class="kpi" style="color:var(--amber)">−${fmtH(totalFolga)}</div></div>
    <div class="card"><h3>Banco previsto (após as folgas)</h3><div class="kpi" style="color:var(--green)">${fmtH(totalPrev)}</div></div>
  </div>
  <div class="section">${alerts}</div>
  ${usos.length?`<div class="section panel"><div class="ph"><h3>🔎 Uso de banco detectado</h3><span class="muted">comparando importações</span></div><div class="pb">
    ${usos.map(u=>`<div class="reason" style="border-left-color:${u.matched?'var(--green)':'var(--amber)'};font-size:13px"><b>${esc(u.employee_name||'')}</b> — ${esc(u.note||'')} <span class="muted">(${(u.usage_date||'').split('-').reverse().slice(0,2).join('/')})</span></div>`).join('')}
  </div></div>`:''}
  <div class="toolbar">
    <button class="btn" onclick="location.hash='#folgas'">⚡ Gerar escala automática</button>
    <button class="btn sec" onclick="location.hash='#tiquetaque'">🔄 Sincronizar TiqueTaque</button>
    <div class="spacer"></div><span class="muted">${MONTHS[month-1]} de ${year}</span>
  </div>
  <div class="panel"><div class="ph"><h3>Banco de horas por funcionária</h3><span class="muted">real → folgas aprovadas → previsto</span></div><div class="pb" style="padding:0">
    <table><thead><tr><th>Funcionária</th><th>Cargo</th><th>Banco real</th><th>Folga prevista</th><th>Banco previsto</th><th>Status</th></tr></thead><tbody>
    ${emps.sort((a,b)=>(b.time_bank_balance||0)-(a.time_bank_balance||0)).map(e=>{ const fh=folgaH[e.id]||0; const prev=(+e.time_bank_balance||0)-fh; return `<tr>
      <td><b>${esc(e.name)}</b></td><td class="muted">${esc(e.cargo||'—')}</td>
      <td><b>${fmtH(e.time_bank_balance)}</b></td>
      <td style="color:${fh?'var(--amber)':'var(--muted)'}">${fh?'−'+fmtH(fh):'—'}</td>
      <td><b>${fmtH(prev)}</b></td>
      <td><span class="pill ${e.status}">${e.status}</span></td></tr>`;}).join('')
      ||'<tr><td colspan=6 class="muted" style="padding:18px">Nenhuma funcionária. Sincronize o TiqueTaque ou cadastre manualmente.</td></tr>'}
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
      <td><b>${esc(e.name)}</b><br><span class="muted" style="font-size:11.5px">${esc(e.preferences||'')}</span></td>
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
    <div class="field"><label>Atendimento na ótica</label><select id="f_expert"><option value="false" ${!e.is_expert?'selected':''}>Sabe menos (precisa de apoio)</option><option value="true" ${e.is_expert?'selected':''}>Especialista (sabe mais)</option></select>
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
  const adt=String(r.allowed_dayoff_types||'').split(',').map(s=>s.trim()).filter(Boolean);
  const chk=c=>(adt.length?adt.includes(c):true)?'checked':''; // sem config = todas marcadas
  $('#view').innerHTML=`
  <div class="toolbar"><b>Regras da loja</b><span class="muted" style="font-size:12.5px">— configure os blocos e salve</span><div class="spacer"></div><button class="btn" id="saveRules" ${isGestor()?'':'disabled'}>💾 Salvar regras</button></div>
  <div class="masonry">

    <div class="panel"><div class="ph"><h3>🕐 Horário de funcionamento</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Manhã — abre</label><input id="r_om" type="time" value="${r.open_morning||'09:00'}"/></div>
        <div class="field"><label>Manhã — fecha</label><input id="r_cm" type="time" value="${r.close_morning||'12:00'}"/></div>
        <div class="field"><label>Tarde — abre</label><input id="r_oa" type="time" value="${r.open_afternoon||'14:00'}"/></div>
        <div class="field" style="margin:0"><label>Tarde — fecha</label><input id="r_ca" type="time" value="${r.close_afternoon||'18:00'}"/></div></div>
      <div class="reason">A loja fecha no almoço — por isso manhã e tarde têm horários separados.</div>
    </div></div>

    <div class="panel"><div class="ph"><h3>👥 Cobertura da loja</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Mínimo por turno</label><input id="r_min" type="number" value="${r.min_per_shift||4}"/></div>
        <div class="field" style="margin:0"><label>Máx. folgando no mesmo dia</label><input id="r_maxday" type="number" min="1" value="${r.max_dayoffs_per_day??2}"/></div></div>
      <div class="field" style="margin:13px 0 0"><label>Função essencial</label>
        <select id="r_expert"><option value="true" ${r.require_expert!==false?'selected':''}>Manter sempre 1 das mais experientes</option><option value="false" ${r.require_expert===false?'selected':''}>Não exigir</option></select></div>
      <div class="reason">O motor nunca passa do máximo por dia e (se ativado) nunca deixa a loja sem uma das mais experientes.</div>
    </div></div>

    <div class="panel"><div class="ph"><h3>🏦 Banco de horas</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Mín. p/ sugerir folga (h)</label><input id="r_minbank" type="number" value="${r.min_time_bank_for_dayoff||6}"/></div>
        <div class="field" style="margin:0"><label>Limite recomendado (h)</label><input id="r_maxbank" type="number" value="${r.max_time_bank||20}"/></div></div>
      <label style="margin:13px 0 6px">Alertas de banco alto — prioridade escalonada</label>
      <div class="grid4" style="gap:8px">
        <div class="field" style="margin:0"><label>Atenção</label><input id="r_bk1" type="number" value="${r.bank_alert_atencao??8}"/></div>
        <div class="field" style="margin:0"><label>Alta</label><input id="r_bk2" type="number" value="${r.bank_alert_alta??12}"/></div>
        <div class="field" style="margin:0"><label>Máxima</label><input id="r_bk3" type="number" value="${r.bank_alert_maxima??16}"/></div>
        <div class="field" style="margin:0"><label>Crítico</label><input id="r_bk4" type="number" value="${r.bank_alert_critico??20}"/></div></div>
      <div class="reason">Quanto mais alto o banco, maior a prioridade p/ folga. Acima do crítico vira alerta no painel.</div>
    </div></div>

    <div class="panel"><div class="ph"><h3>🌴 Regras de folga</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Tipo liberado</label><select id="r_mode"><option value="saida_antecipada" ${(r.dayoff_mode||'saida_antecipada')==='saida_antecipada'?'selected':''}>Só sair mais cedo</option><option value="completa" ${r.dayoff_mode==='completa'?'selected':''}>Integral / meio turno</option></select></div>
        <div class="field" style="margin:0"><label>Horas de saída antecipada</label><input id="r_early" type="number" value="${r.early_leave_hours??3}"/></div></div>
      <div class="field" style="margin:13px 0 0"><label>Folga: mín–máx (h)</label><div style="display:flex;gap:6px"><input id="r_dmin" type="number" value="${r.min_dayoff_hours||3}"/><input id="r_dmax" type="number" value="${r.max_dayoff_hours||8}"/></div></div>
      <label style="margin:13px 0 7px">Opções que a loja permite</label>
      <div class="chip-row">
        <label class="chk-chip"><input type="checkbox" class="r_dtype" value="manha_entrar" ${chk('manha_entrar')}/> Entrar tarde (manhã)</label>
        <label class="chk-chip"><input type="checkbox" class="r_dtype" value="manha_sair" ${chk('manha_sair')}/> Sair cedo (manhã)</label>
        <label class="chk-chip"><input type="checkbox" class="r_dtype" value="tarde_entrar" ${chk('tarde_entrar')}/> Entrar tarde (tarde)</label>
        <label class="chk-chip"><input type="checkbox" class="r_dtype" value="tarde_sair" ${chk('tarde_sair')}/> Sair cedo (tarde)</label></div>
      <div class="reason">O motor só sugere os horários marcados. Para o rodízio justo, marque ao menos uma de <b>entrar</b> e uma de <b>sair</b>.</div>
    </div></div>

    <div class="panel"><div class="ph"><h3>📅 Sábados &amp; escala</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Sábados abertos / mês</label><input id="r_satn" type="number" value="${r.saturday_open_count||2}"/></div>
        <div class="field"><label>Horário do sábado</label><div style="display:flex;gap:6px"><input id="r_sats" type="time" value="${r.saturday_start||'14:00'}"/><input id="r_sate" type="time" value="${r.saturday_end||'17:00'}"/></div></div>
        <div class="field"><label>Pessoas no 1º sábado</label><input id="r_sat1" type="number" value="${r.saturday_first_count??3}"/></div>
        <div class="field"><label>Pessoas no 2º sábado</label><input id="r_sat2" type="number" value="${r.saturday_second_count??2}"/></div>
        <div class="field"><label>Quais sábados (padrão)</label><select id="r_satmode"><option value="dois_primeiros" ${(r.saturday_open_mode||'dois_primeiros')==='dois_primeiros'?'selected':''}>Os dois primeiros</option><option value="primeiro_ultimo" ${r.saturday_open_mode==='primeiro_ultimo'?'selected':''}>1º e último</option><option value="todos" ${r.saturday_open_mode==='todos'?'selected':''}>Todos</option></select></div>
        <div class="field" style="margin:0"><label>Escala 5x2 (futura)</label><select id="r_5x2"><option value="false" ${!r.scale_5x2_enabled?'selected':''}>Desativada</option><option value="true" ${r.scale_5x2_enabled?'selected':''}>Ativada</option></select></div></div>
      <div class="reason">1º sábado tem mais movimento → mais gente; perto de feriado o reforço inverte sozinho. O modo de cada mês ajusta-se em <b>Rodízio de sábados</b>.</div>
    </div></div>

    <div class="panel"><div class="ph"><h3>🚫 Dias bloqueados</h3><button class="btn sm" id="addBlk" ${isGestor()?'':'disabled'}>+ Adicionar</button></div>
      <div class="pb" style="padding:0"><table><thead><tr><th>Data</th><th>Tipo</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${blocked.map(b=>`<tr><td>${b.date.split('-').reverse().join('/')}</td><td>${b.type}</td><td>${esc(b.reason||'')}</td><td>${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-delblk="${b.id}">remover</button>`:''}</td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:16px">Nenhum dia bloqueado.</td></tr>'}
      </tbody></table></div></div>

    <div class="panel"><div class="ph"><h3>🎁 Datas comemorativas</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Proteção</label><select id="r_comm"><option value="true" ${r.block_commemorative!==false?'selected':''}>Ativada</option><option value="false" ${r.block_commemorative===false?'selected':''}>Desativada</option></select></div>
        <div class="field" style="margin:0"><label>Dias antes a proteger</label><input id="r_lead" type="number" value="${lead}"/></div></div>
      <div class="pb" style="padding:0;margin-top:12px"><table><thead><tr><th>Data</th><th>Quando</th><th>Sem folga</th></tr></thead><tbody>${commRows||'<tr><td colspan=3 class="muted">—</td></tr>'}</tbody></table></div>
      <div class="reason">Nessas datas e na semana anterior o sistema não sugere folga (o sábado também não). Datas fixas de varejo já vêm incluídas; extras vão em <b>Dias bloqueados</b>.</div>
    </div></div>

  </div>`;
  $('#saveRules')?.addEventListener('click',async()=>{ if(!gate())return;
    const payload={id:1,open_morning:$('#r_om').value,close_morning:$('#r_cm').value,open_afternoon:$('#r_oa').value,close_afternoon:$('#r_ca').value,
      open_time:$('#r_om').value,close_time:$('#r_ca').value,
      min_per_shift:+$('#r_min').value,max_time_bank:+$('#r_maxbank').value,min_time_bank_for_dayoff:+$('#r_minbank').value,
      max_dayoffs_per_day:Math.max(1,+$('#r_maxday').value||2),
      bank_alert_atencao:+$('#r_bk1').value||8, bank_alert_alta:+$('#r_bk2').value||12, bank_alert_maxima:+$('#r_bk3').value||16, bank_alert_critico:+$('#r_bk4').value||20,
      require_expert:$('#r_expert').value!=='false',
      allowed_dayoff_types:$$('.r_dtype').filter(c=>c.checked).map(c=>c.value).join(','),
      min_dayoff_hours:+$('#r_dmin').value,max_dayoff_hours:+$('#r_dmax').value,
      dayoff_mode:$('#r_mode').value,early_leave_hours:+$('#r_early').value||3,
      saturday_open_count:+$('#r_satn').value,saturday_start:$('#r_sats').value,saturday_end:$('#r_sate').value,
      saturday_first_count:+$('#r_sat1').value||3,saturday_second_count:+$('#r_sat2').value||2,
      saturday_open_mode:$('#r_satmode').value||'dois_primeiros',
      block_commemorative:$('#r_comm').value==='true', high_traffic_lead_days:+$('#r_lead').value||7,
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
      const rec=await reconcileBank();
      toast(rec.length?`Importação concluída. Detectado uso de banco de ${rec.length} funcionária(s) — veja no Dashboard.`:'Importação concluída.'); route();
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
  // folgas já aprovadas (a partir de hoje) para a engine não sugerir quem já tem folga programada
  const scheds=await getAll('schedules',b=>b.eq('is_simulation',S.sim));
  const schedIds=new Set(scheds.map(s=>s.id));
  // folga de segunda/sexta MAIS RECENTE já agendada (passada ou futura) — base do rodízio
  const nmMap=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  const allAp=(await getAll('schedule_items',b=>b.eq('status','aprovado').order('date',{ascending:false}))).filter(it=>schedIds.has(it.schedule_id));
  const lastDow=dw=>{ const arr=allAp.filter(it=>Engine.parse(it.date).getDay()===dw); if(!arr.length) return null;
    const d=arr[0].date; return {date:d, names:[...new Set(arr.filter(x=>x.date===d).map(x=>x.employee_name||nmMap[x.employee_id]||''))].filter(Boolean)}; };
  const lastMon=lastDow(1), lastFri=lastDow(5);
  const fresh=await bankFreshnessBanner();
  let weekOffset=0; // 0 = semana de planejamento atual; ← / → mudam a semana (para simular as próximas)
  // dias da semana onde o motor pode distribuir folgas (1=seg … 5=sex). Padrão: todos.
  let selDays=String(rules.dayoff_weekdays||'1,2,3,4,5').split(',').map(s=>+s.trim()).filter(n=>n>=1&&n<=5);
  if(!selDays.length) selDays=[1,2,3,4,5];
  $('#view').innerHTML=`
  ${fresh}
  <div class="toolbar">
    <button class="btn sec sm" id="wkPrev">←</button>
    <b id="wkLabel" style="min-width:185px;text-align:center">—</b>
    <button class="btn sec sm" id="wkNext">→</button>
    <button class="btn sec" id="regen">↻ Recalcular</button>
    <div class="spacer"></div><span class="muted" id="capInfo"></span></div>
  <div class="toolbar" style="flex-wrap:wrap;align-items:center"><span class="muted">Distribuir folgas em:</span>
    <div class="chip-row">${[[1,'Seg'],[2,'Ter'],[3,'Qua'],[4,'Qui'],[5,'Sex']].map(([n,lb])=>`<label class="chk-chip"><input type="checkbox" class="wkday" value="${n}" ${selDays.includes(n)?'checked':''} ${isGestor()?'':'disabled'}/> ${lb}</label>`).join('')}</div>
    <span class="muted" style="font-size:12px">desmarque um dia para o motor não dar folga nele</span></div>
  <div id="folgaOut"><p class="muted">Carregando sugestões da semana…</p></div>`;
  async function run(){
    // semana completa (segunda a sexta), a partir de 22/06/2026 ou da semana atual, mais o deslocamento escolhido
    const SYSTEM_START='2026-06-22';
    const base = todayStr() < SYSTEM_START ? SYSTEM_START : todayStr();
    const bd=Engine.parse(base); const wd=bd.getDay(); bd.setDate(bd.getDate()+(wd===0?1:1-wd)+weekOffset*7); // segunda-feira da semana escolhida
    const weekStart=Engine.fmt(bd);
    const history=await buildHistory(weekStart); // recência/justiça relativas à semana planejada (conta folgas anteriores a ela)
    // folgas já aprovadas (atualizadas a cada cálculo — reflete o que você acabou de aprovar)
    const fScheds=await getAll('schedules',b=>b.eq('is_simulation',S.sim));
    const fSchedIds=new Set(fScheds.map(s=>s.id));
    const existing=(await getAll('schedule_items',b=>b.eq('status','aprovado').gte('date',todayStr()))).filter(it=>fSchedIds.has(it.schedule_id));
    const out=Engine.suggestDayOffs({employees:emps,rules,vacations:vacs,requests:reqs,refusals,blockedDates:blk,year,month,horizonDays:4,startDate:weekStart,history,existing,weekdays:selDays});
    const wEnd=Engine.parse(weekStart); wEnd.setDate(wEnd.getDate()+4);
    const wlabel=`${weekStart.split('-').reverse().slice(0,2).join('/')} a ${Engine.fmt(wEnd).split('-').reverse().slice(0,2).join('/')}`;
    $('#wkLabel').textContent = weekOffset===0?`Semana ${wlabel}`:`Semana ${wlabel} ${weekOffset>0?'(+'+weekOffset+')':'('+weekOffset+')'}`;
    $('#capInfo').textContent=`cobertura ${out.capacity.level.replace('_',' ')}${weekOffset!==0?' · simulação':''}`;
    // agrupa as sugestões por dia
    const byDay={};
    out.suggestions.forEach((s,i)=>{ (byDay[s.date]=byDay[s.date]||[]).push({...s,_i:i}); });
    // cor da tag por categoria: banco=azul, tempo sem folgar=verde, sexta=roxo, prioridade=âmbar, demais=cinza
    const tagColor=(t)=>{const s=t.toLowerCase();
      if(s.includes('banco')) return 'background:var(--brand-soft);color:var(--brand-d)';
      if(s.includes('sem folgar')||s.includes('histórico')) return 'background:var(--green-soft);color:var(--green)';
      if(s.includes('sexta')) return 'background:var(--purple-soft);color:var(--purple)';
      if(s.includes('prioridade')) return 'background:var(--amber-soft);color:var(--amber)';
      return 'background:#eef0f4;color:#5b6577';};
    // tag com a preferência que a funcionária escolheu (ou "sem preferência · aleatório")
    const PREF_LABEL={manha_entrar:'Entrar +tarde · manhã',manha_sair:'Sair +cedo · manhã',tarde_entrar:'Entrar +tarde · tarde',tarde_sair:'Sair +cedo · tarde'};
    const prefBadge=(empId)=>{
      const e=emps.find(x=>x.id===empId);
      const codes=String((e&&e.dayoff_pref)||'').split(',').map(x=>x.trim()).filter(c=>PREF_LABEL[c]);
      if(!codes.length || codes.length>=4) return `<span style="font-size:11px;font-weight:600;background:#eef0f4;color:#5b6577;padding:2px 9px;border-radius:20px">🎲 Sem preferência · aleatório</span>`;
      return `<span style="font-size:11px;font-weight:600;background:var(--purple-soft);color:var(--purple);padding:2px 9px;border-radius:20px">🙋 Prefere: ${esc(codes.map(c=>PREF_LABEL[c]).join(' / '))}</span>`;
    };
    const dayBlocks=Object.keys(byDay).sort().map(date=>{
      const dia=Engine.DOW[Engine.parse(date).getDay()]; const dataBR=date.split('-').reverse().slice(0,2).join('/');
      const cards=byDay[date].map(s=>{
        const i=s._i;
        const hm=(folgaTimeLabel(s,rules).match(/(\d{2}):(\d{2})/)||[])[0]; const hora=hm?' · '+hm.replace(':','h'):'';
        return `<div class="card" style="margin:0;display:flex;flex-direction:column;gap:9px">
          <div>
            <div style="font-weight:700;font-size:15px">${esc(s.employee_name)}</div>
            <div style="font-size:14px;font-weight:600;margin-top:3px">${TYPE_LABEL[s.type]||s.type} <span class="muted" style="font-weight:500">(${SHIFT_LABEL[s.shift]||s.shift}) · ${s.hours}h${hora}</span></div>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">${prefBadge(s.employee_id)}</div>
          ${(s.tags&&s.tags.length)?`<div style="display:flex;gap:5px;flex-wrap:wrap">${s.tags.map(t=>`<span style="font-size:11px;font-weight:600;${tagColor(t)};padding:2px 9px;border-radius:20px">${esc(t)}</span>`).join('')}</div>`:''}
          <div class="row-actions" id="act${i}" style="margin-top:auto;padding-top:2px">${isGestor()?`<button class="btn sm" data-ap="${i}">Aprovar</button><button class="btn sm" data-aj="${i}" style="background:var(--amber-soft);color:var(--amber)">✏️ Ajustar</button><button class="btn sec sm" data-rf="${i}">Recusar</button>`:'<span class="muted">—</span>'}</div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:16px">
        <div style="font-weight:800;font-size:17px;padding:8px 14px;background:var(--brand-soft);color:var(--brand-d);border-radius:10px;margin-bottom:10px;text-transform:capitalize">${dia} · ${dataBR}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px">${cards}</div></div>`;
    }).join('');
    const logRows=out.logs.map(l=>`<div class="reason" style="font-size:12.5px;border-left-color:${l.type==='bloqueio'?'var(--red)':l.type==='rodizio'?'var(--purple)':'var(--brand)'}">${l.type==='bloqueio'?'🚫':l.type==='rodizio'?'🔁':'✅'} ${esc(l.message)}</div>`).join('');
    // FILA DE JUSTIÇA — quem está na frente para folgar e por quê
    const queue=Engine.dayoffQueue(emps,rules,history,existing);
    const queueHtml=queue.map(q=>`<div style="display:flex;align-items:center;gap:11px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px;background:${q.elig?'#fff':'#f6f8fb'}">
        <div style="min-width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;flex:none;background:${(q.elig&&q.position<=3)?'var(--brand)':'#eef1f8'};color:${(q.elig&&q.position<=3)?'#fff':'var(--muted)'}">${q.position}º</div>
        <div style="flex:1;min-width:0"><div style="font-weight:700">${esc(q.name)}</div><div class="muted" style="font-size:12.5px;margin-top:1px">${esc(q.why)}</div></div></div>`).join('');
    const lf=info=> (info&&info.names&&info.names.length)?`<b>${info.names.map(esc).join(', ')}</b> <span class="muted">· ${info.date.split('-').reverse().join('/')}</span>`:'<span class="muted">ninguém ainda</span>';
    // faixa fina full-width: última folga seg/sex
    const monFri=`<div class="panel" style="margin-bottom:12px"><div class="pb" style="padding:11px 14px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:stretch">
        <span class="muted" style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;display:flex;align-items:center;gap:6px;align-self:center">🗓️ Última folga</span>
        <div style="flex:1;min-width:190px;border:1px solid var(--line);border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase">Segunda</span> <span>${lf(lastMon)}</span></div>
        <div style="flex:1;min-width:190px;border:1px solid var(--line);border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase">Sexta</span> <span>${lf(lastFri)}</span></div>
        <span class="muted" style="font-size:11.5px;flex-basis:100%">Evita repetir a mesma pessoa na segunda/sexta em semanas seguidas.</span>
      </div></div></div>`;
    $('#folgaOut').innerHTML=`
      ${monFri}
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <details class="panel" open style="flex:1 1 300px;min-width:270px;max-width:400px;margin:0"><summary style="cursor:pointer;padding:13px 16px;font-weight:700">📋 Fila de justiça <span class="muted" style="font-weight:500">(${queue.filter(q=>q.elig).length} com saldo)</span></summary>
          <div class="pb" style="padding-top:4px">${queueHtml||'<span class="muted">Sem funcionárias ativas.</span>'}
          <div class="reason">Ordem por <b>banco de horas</b>, depois <b>tempo sem folgar</b> e justiça do histórico. Quem está sem saldo aparece no fim (em dia).</div></div></details>
        <div class="panel" style="flex:2 1 440px;min-width:300px;margin:0"><div class="ph"><h3>Sugestões da semana</h3>
          <div style="display:flex;align-items:center;gap:10px"><span class="muted">${out.suggestions.length} folga(s)</span>
          ${(isGestor()&&out.suggestions.length)?`<button class="btn sm" id="apAll">✓ Aprovar todos</button>`:''}</div></div>
          <div class="pb">${out.suggestions.length?'':box('warn','Nenhuma folga sugerida nesta semana — veja o porquê no log abaixo.')}${dayBlocks||'<span class="muted">Sem sugestões nesta semana.</span>'}</div></div>
      </div>
      <details class="panel section" style="margin-top:12px"><summary style="cursor:pointer;padding:13px 16px;font-weight:700">🧠 Log de decisão <span class="muted" style="font-weight:500">— toque para ver o porquê</span></summary>
        <div class="pb" style="padding-top:4px">${logRows||'<span class="muted">Sem registros.</span>'}</div></details>`;
    $$('[data-ap]').forEach(b=>b.onclick=async()=>{ if(!gate())return; const i=+b.dataset.ap; b.disabled=true;
      await saveApproval(out.suggestions[i]);
      $('#act'+i).innerHTML='<span class="pill ativa">✓ Aprovado</span>'; toast('Folga aprovada — veja em Folgas aprovadas.'); });
    $$('[data-aj]').forEach(b=>b.onclick=()=>{ if(!gate())return; const s=out.suggestions[+b.dataset.aj];
      // abre o formulário já preenchido com a sugestão — mude dia/horário/tipo e salve (aprova com o ajuste)
      folgaModal({employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,type:s.type,shift:s.shift,hours:s.hours},emps,rules); });
    $('#apAll')?.addEventListener('click',async()=>{ if(!gate())return; if(!out.suggestions.length)return;
      if(!confirm(`Aprovar todas as ${out.suggestions.length} folgas sugeridas desta semana?`))return;
      const btn=$('#apAll'); btn.disabled=true; btn.textContent='Aprovando…';
      for(const s of out.suggestions){ await saveApproval(s); }
      toast('Todas as folgas foram aprovadas! Veja em Folgas aprovadas.'); route(); });
    $$('[data-rf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; const i=+b.dataset.rf; const s=out.suggestions[i]; const motivo=prompt('Motivo da recusa:','')||'';
      await T('dayoff_requests').insert({employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,shift:s.shift,type:s.type,request_type:'recusa_folga',reason:motivo,status:'recusado'});
      $('#act'+i).innerHTML='<span class="pill afastada">✗ Recusado</span>'; toast('Recusa registrada. Recalcule para nova sugestão.'); });
  }
  async function saveApproval(s){
    const d=Engine.parse(s.date); const y=d.getFullYear(), m=d.getMonth()+1; // mês/ano da própria folga
    let sched=(await T('schedules').select('*').eq('is_simulation',S.sim).eq('year',y).eq('month',m).order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
    if(!sched) sched=(await T('schedules').insert({year:y,month:m,status:'sugerida',is_simulation:S.sim,created_by:S.user.id}).select().single()).data;
    await T('schedule_items').insert({schedule_id:sched.id,employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,shift:s.shift,type:s.type,hours:s.hours,status:'aprovado',reason:s.reason});
    await T('decision_logs').insert({schedule_id:sched.id,employee_id:s.employee_id,employee_name:s.employee_name,decision_type:'sugestao',message:s.reason,is_simulation:S.sim});
  }
  $('#regen').onclick=run;
  $('#wkPrev').onclick=()=>{ weekOffset--; run(); };
  $('#wkNext').onclick=()=>{ weekOffset++; run(); };
  $$('.wkday').forEach(c=>c.addEventListener('change',async()=>{
    const sel=$$('.wkday').filter(x=>x.checked).map(x=>+x.value);
    if(!sel.length){ toast('Selecione pelo menos um dia.'); c.checked=true; return; }
    selDays=sel;
    if(isGestor()) await T('store_rules').update({dayoff_weekdays:selDays.join(',')}).eq('id',1);
    run();
  }));
  run();
};

// ---------- FOLGAS APROVADAS (ver / editar / lançar) ----------
ROUTES.escala=async function(){
  const ini=todayStr().slice(0,8)+'01';
  const [emps,rules,items]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('schedule_items',b=>b.gte('date',ini).order('date'))]);
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  const timeKey=it=>{const m=folgaTimeLabel(it,rules).match(/(\d{2}):(\d{2})/);return m?(+m[1]*60+ +m[2]):9999;};
  items.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||timeKey(a)-timeKey(b));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addFolga" ${isGestor()?'':'disabled'}>+ Lançar folga</button>
    ${(isGestor()&&items.length)?`<button class="btn sec" id="delAllF" style="color:var(--red)">🗑️ Remover tudo</button>`:''}
    <div class="spacer"></div><span class="muted">${items.length} folga(s) a partir deste mês</span></div>
  ${box('info','Todas as folgas aprovadas. <b>Editar</b> troca o dia/horário, <b>Remover</b> apaga — útil quando a funcionária pede um dia diferente do que o sistema sugeriu. Você também pode <b>lançar</b> uma folga do zero.')}
  <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start">
    ${(()=>{ const byDay={}; items.forEach(it=>{(byDay[it.date]=byDay[it.date]||[]).push(it);});
      return Object.keys(byDay).sort().map(date=>{
        const dia=Engine.DOW[Engine.parse(date).getDay()]; const dataBR=date.split('-').reverse().join('/');
        const cards=byDay[date].map(it=>`<div class="card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="font-weight:700">${esc(it.employee_name||map[it.employee_id]||'')}</div>
            <div class="muted" style="font-size:13px;margin-top:2px"><b style="color:var(--ink)">${folgaTimeLabel(it,rules)}</b> · ${TYPE_LABEL[it.type]||it.type}${it.hours?' '+it.hours+'h':''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="pill ${it.status==='aprovado'?'ativa':it.status==='recusado'?'afastada':'ferias'}">${it.status==='aprovado'?'Aprovado':it.status}</span>
            ${isGestor()?`<button class="btn ghost sm" data-swapf="${it.id}">🔁 Trocar</button><button class="btn ghost sm" data-edf="${it.id}">Editar</button><button class="btn ghost sm" style="color:var(--red)" data-delf="${it.id}">Remover</button>`:''}
          </div></div>`).join('');
        return `<div class="panel" style="flex:1 1 calc(50% - 7px);min-width:300px;margin:0"><div class="ph" style="background:var(--brand-soft)"><h3 style="color:var(--brand-d);text-transform:capitalize;margin:0">${dia} · ${dataBR}</h3></div><div class="pb">${cards}</div></div>`;
      }).join('');
    })()||'<p class="muted" style="margin:0">Nenhuma folga registrada. Aprove no Motor de folgas ou clique em “Lançar folga”.</p>'}
  </div>`;
  $('#addFolga')?.addEventListener('click',()=>folgaModal(null,emps,rules));
  $('#delAllF')?.addEventListener('click',async()=>{ if(!gate())return;
    if(!confirm(`Remover TODAS as ${items.length} folgas aprovadas a partir deste mês? Esta ação não pode ser desfeita.`))return;
    const res=await T('schedule_items').delete().in('id',items.map(i=>i.id)); if(res.error){toast(res.error.message);return;}
    toast('Todas as folgas foram removidas.'); route(); });
  $$('[data-edf]').forEach(b=>b.onclick=()=>folgaModal(items.find(x=>x.id===b.dataset.edf),emps,rules));
  $$('[data-swapf]').forEach(b=>b.onclick=()=>swapModal(items.find(x=>x.id===b.dataset.swapf),items,emps,rules));
  $$('[data-delf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; if(!confirm('Remover esta folga?'))return; await T('schedule_items').delete().eq('id',b.dataset.delf); toast('Folga removida.'); route(); });
};
// ---------- TROCAR FOLGA (entre funcionárias) ----------
function swapModal(folga, items, emps, rules){
  if(!folga) return;
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  const desc=f=>{ const dow=Engine.DOW[Engine.parse(f.date).getDay()]; const dBR=f.date.split('-').reverse().slice(0,2).join('/'); return `${dow} ${dBR} · ${folgaTimeLabel(f,rules)} · ${TYPE_LABEL[f.type]||f.type}`; };
  const meName=folga.employee_name||map[folga.employee_id]||'';
  const others=items.filter(x=>x.id!==folga.id && x.employee_id!==folga.employee_id).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const rows=others.map(f=>{ const nm=f.employee_name||map[f.employee_id]||'';
    return `<button class="card" data-sw="${f.id}" style="width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;background:#fff">
      <div style="min-width:0"><div style="font-weight:700">${esc(nm)}</div><div class="muted" style="font-size:13px;margin-top:2px">${desc(f)}</div></div>
      <span class="pill ativa" style="white-space:nowrap">trocar →</span></button>`; }).join('')
    ||'<p class="muted" style="margin:0">Não há folgas de outras funcionárias para trocar.</p>';
  const root=$('#modalRoot');
  root.innerHTML=`<div class="modal-bg"><div class="modal"><div class="mh"><h3>Trocar folga</h3><button class="x" id="mClose">×</button></div>
    <div class="mb">
      <div class="reason" style="margin-bottom:12px">Folga de <b>${esc(meName)}</b>: ${desc(folga)}.<br>Escolha com quem trocar — as duas funcionárias trocam de folga.</div>
      <div style="max-height:52vh;overflow:auto">${rows}</div>
    </div>
    <div class="mf"><button class="btn sec" id="mCancel">Fechar</button></div></div></div>`;
  const close=()=>root.innerHTML='';
  $('#mClose').onclick=close; $('#mCancel').onclick=close;
  $('.modal-bg').onclick=(e)=>{ if(e.target.classList.contains('modal-bg')) close(); };
  $$('[data-sw]').forEach(btn=>btn.onclick=async()=>{ if(!gate())return;
    const other=others.find(x=>x.id===btn.dataset.sw); if(!other)return;
    const otherNm=other.employee_name||map[other.employee_id]||'';
    if(!confirm(`Trocar a folga de ${meName} (${desc(folga)}) com a de ${otherNm} (${desc(other)})?\n\nDepois: ${meName} fica com ${desc(other)} · ${otherNm} fica com ${desc(folga)}.`)) return;
    const [ra,rb]=await Promise.all([
      T('schedule_items').update({employee_id:other.employee_id, employee_name:otherNm}).eq('id',folga.id),
      T('schedule_items').update({employee_id:folga.employee_id, employee_name:meName}).eq('id',other.id)]);
    if(ra.error||rb.error){ toast((ra.error||rb.error).message); return; }
    close(); toast('Folgas trocadas.'); route(); });
}
function folgaModal(it,emps,rules){
  it=it||{};
  const toMin=s=>{const[h,m]=String(s||'').split(':').map(Number);return (h||0)*60+(m||0);};
  const diffH=(a,b)=>Math.max(0,(toMin(b)-toMin(a))/60);
  const mh=diffH(rules.open_morning||'09:00', rules.close_morning||'12:00');   // horas da manhã
  const ah=diffH(rules.open_afternoon||'14:00', rules.close_afternoon||'18:00'); // horas da tarde
  const fmtHrs=h=>{const m=Math.round(h*60);const H=Math.floor(m/60),M=m%60;return H+'h'+(M?String(M).padStart(2,'0'):'');};
  const oM=(rules.open_morning||'09:00').slice(0,5), cM=(rules.close_morning||'12:00').slice(0,5);
  const oA=(rules.open_afternoon||'14:00').slice(0,5), cA=(rules.close_afternoon||'18:00').slice(0,5);
  // combo inicial (tipo|período) a partir do registro existente
  let sel0='saida_antecipada|tarde';
  if(it.type==='entrada_tarde') sel0='entrada_tarde|'+(it.shift==='manha'?'manha':'tarde');
  else if(it.type==='saida_antecipada') sel0='saida_antecipada|'+(it.shift==='manha'?'manha':'tarde');
  else if(it.type==='meio_turno') sel0='meio_turno|'+(it.shift==='manha'?'manha':'tarde');
  else if(it.type==='integral') sel0='integral|dia_inteiro';
  const chipR=(val,label)=>`<label class="chk-chip"><input type="radio" name="ff_act" value="${val}" ${sel0===val?'checked':''}/> ${label}</label>`;
  openModal(it.id?'Editar lançamento':'Lançar folga',`
    <div class="field"><label>Funcionária</label><select id="ff_emp">${emps.map(e=>`<option value="${e.id}" ${it.employee_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
    <div class="field"><label>O que vai acontecer — marque uma opção</label>
      <div class="chip-row">
        ${chipR('entrada_tarde|manha','Entrar mais tarde (manhã)')}
        ${chipR('saida_antecipada|manha','Sair mais cedo (manhã)')}
        ${chipR('entrada_tarde|tarde','Entrar mais tarde (tarde)')}
        ${chipR('saida_antecipada|tarde','Sair mais cedo (tarde)')}
      </div>
      <div class="chip-row" style="margin-top:7px">
        ${chipR('meio_turno|manha','Meio turno (manhã)')}
        ${chipR('meio_turno|tarde','Meio turno (tarde)')}
        ${chipR('integral|dia_inteiro','Folga dia inteiro')}
      </div>
      <p class="muted" style="margin:9px 0 0;font-size:12px">Faltas, atestados e afastamentos são registrados em <b>Pedidos &amp; exceções</b>.</p></div>
    <div class="grid2">
      <div class="field"><label>Data</label><input id="ff_date" type="date" value="${it.date||todayStr()}"/></div>
      <div class="field" id="ff_hoursWrap"><label>Horas</label><input id="ff_hours" type="number" step="0.5" min="1" value="${it.hours||rules.early_leave_hours||3}"/></div></div>
    <div class="reason" id="ff_preview"></div>
  `,async()=>{
    if(!gate())return false;
    const emp=emps.find(e=>e.id===$('#ff_emp').value);
    const date=$('#ff_date').value; if(!date){toast('Informe a data.');return false;}
    const selEl=$$('input[name=ff_act]').find(r=>r.checked); if(!selEl){toast('Escolha uma opção.');return false;}
    const [type,shift]=selEl.value.split('|');
    let hours;
    if(type==='meio_turno') hours = shift==='manha'?mh:ah;
    else if(type==='integral') hours = mh+ah;
    else hours = +$('#ff_hours').value||1;
    const d=Engine.parse(date);
    const sched=await getOrCreateSchedule(d.getFullYear(), d.getMonth()+1);
    const payload={schedule_id:sched.id, employee_id:emp.id, employee_name:emp.name, date, shift, type, hours:Math.round(hours*100)/100, status:'aprovado', reason:'Lançada manualmente pelo gestor'};
    const r = it.id ? await T('schedule_items').update(payload).eq('id',it.id) : await T('schedule_items').insert(payload);
    if(r.error){toast(r.error.message);return false;}
    toast('Folga salva.'); route(); return true;
  });
  const upd=()=>{
    const sel=($$('input[name=ff_act]').find(r=>r.checked)||{}).value||'saida_antecipada|tarde';
    const [type,shift]=sel.split('|');
    const partial=(type==='saida_antecipada'||type==='entrada_tarde');
    $('#ff_hoursWrap').style.display=partial?'':'none';
    let txt;
    if(type==='meio_turno') txt=`Meio turno ${shift==='manha'?'manhã':'tarde'} · ${fmtHrs(shift==='manha'?mh:ah)} (das ${shift==='manha'?oM+' às '+cM:oA+' às '+cA})`;
    else if(type==='integral') txt=`Folga o dia todo · ${fmtHrs(mh+ah)}`;
    else { const prev={type,shift,hours:+$('#ff_hours').value||1}; txt=folgaTimeLabel(prev,rules)+' · '+prev.hours+'h'; }
    $('#ff_preview').textContent='Vai aparecer como: '+txt;
  };
  $$('input[name=ff_act]').forEach(r=>r.addEventListener('change',upd));
  $('#ff_hours')?.addEventListener('input',upd); upd();
}

// ---------- RELATÓRIO DA SEMANA (texto p/ o grupo) ----------
function weekReportText(monday, emps, items, rot, vacs, rules){
  const days=[...Array(7)].map((_,i)=>{ const d=new Date(monday); d.setDate(d.getDate()+i); return Engine.fmt(d); });
  const start=days[0], end=days[6];
  const br=(ds)=>ds.split('-').reverse().slice(0,2).join('/');
  const dlong=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const ss=(rules.saturday_start||'14:00').slice(0,5), se=(rules.saturday_end||'17:00').slice(0,5);
  const nameOf=id=>{const e=emps.find(x=>x.id===id);return e?(e.name.split(' ')[0]||e.name):'';};
  const first=n=>(String(n||'').split(' ')[0]||n||'').toUpperCase();
  // no relatório, meio turno fica mais explícito ("Folga meio turno tarde")
  const lblOf=it=> it.type==='meio_turno' ? 'Folga meio turno '+(it.shift==='manha'?'manhã':'tarde') : folgaTimeLabel(it,rules);
  let out=`*Escala da semana — ${br(start)} a ${br(end)}*\n`;
  // por DIA da semana, ordenado por horário (manhã antes da tarde)
  days.forEach(ds=>{
    const dow=Engine.parse(ds).getDay();
    if(dow===0) return; // domingo: loja fechada
    const lines=[];
    items.filter(it=>it.date===ds).sort((a,b)=>folgaSortKey(a,rules)-folgaSortKey(b,rules))
      .forEach(it=>lines.push(`${first(it.employee_name||nameOf(it.employee_id))} — ${lblOf(it)}`));
    const sab=rot.filter(r=>r.saturday_date===ds);
    if(sab.length) lines.push(`Trabalham (${ss}–${se}): ${sab.map(r=>first(r.employee_name||nameOf(r.employee_id))).join(', ')}`);
    out+=`\n*${dlong[dow]} ${br(ds)}*\n`;
    out+= lines.length ? lines.map(l=>'• '+l).join('\n') : '• Sem alterações';
    out+='\n';
  });
  // férias da semana (resumo no fim)
  const vacLines=[];
  emps.forEach(e=>{ const v=vacs.find(v=>v.employee_id===e.id && v.start_date<=end && v.end_date>=start); if(v) vacLines.push(`${first(e.name)} — Férias (${br(v.start_date)} a ${br(v.end_date)})`); });
  if(vacLines.length) out+=`\n*Férias*\n`+vacLines.map(l=>'• '+l).join('\n');
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
    const [emps,rules,saved,hist,recent,mset]=await Promise.all([
      getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),
      T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
      getAll('saturday_rotation',b=>b.eq('year',year).eq('month',month).order('saturday_number')),
      buildHistory(),
      getAll('saturday_rotation',b=>b.order('saturday_date',{ascending:false}).limit(120)),
      T('month_settings').select('*').eq('year',year).eq('month',month).maybeSingle().then(r=>r.data||null)]);
    const active=emps.filter(e=>e.status==='ativa');
    const empName=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const expert=new Set(emps.filter(e=>e.is_expert).map(e=>e.id));
    const monthMode=(mset&&mset.sat_mode)||rules.saturday_open_mode||'dois_primeiros';
    const monthReinforce=(mset&&mset.sat_reinforce)||rules.saturday_reinforce||'auto';
    const bigN=Math.max(rules.saturday_first_count??3, rules.saturday_second_count??2);
    const smallN=Math.min(rules.saturday_first_count??3, rules.saturday_second_count??2);
    const erules={...rules, saturday_open_mode:monthMode, saturday_reinforce:monthReinforce};
    const sats=Engine.openSaturdays(year,month,monthMode).map(Engine.fmt);
    const meta=Engine.saturdayRotation(active,erules,year,month,hist);
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
        return `<div class="panel" style="margin-bottom:0;flex:1 1 300px;min-width:280px"><div class="ph">
          <h3>${n}º sábado · ${d.split('-').reverse().join('/')}</h3>
          <span class="pill ${ok?'ativa':'ferias'}">${assigned.length}/${tgt} pessoas</span></div>
          <div class="pb">
            ${assigned.map(a=>`<span class="pill ativa" style="margin:0 8px 8px 0;display:inline-flex;align-items:center;gap:7px;font-size:13px">${esc(a.employee_name)} ${isGestor()?`<button class="x" style="font-size:15px;line-height:1;padding:0" data-rm="${n}|${a.employee_id}" title="remover">×</button>`:''}</span>`).join('')||'<span class="muted">Ninguém escalado ainda.</span>'}
            ${noExp?`<div class="alert warn" style="margin-top:8px">⚠️ Este sábado está <b>sem ninguém com mais conhecimento</b>. Evite deixar só quem sabe menos — inclua pelo menos uma das mais experientes.</div>`:''}
            ${isGestor()?`<div style="margin-top:10px;max-width:300px"><select data-add="${n}"><option value="">+ adicionar funcionária…</option>${avail.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>`:''}
          </div></div>`;
      }).join('');
      $('#satEditor').innerHTML=`<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">${cards}</div>`+(invNote?`<div class="section">${invNote}</div>`:'');
      $$('[data-rm]').forEach(b=>b.onclick=()=>{ const [n,id]=b.dataset.rm.split('|'); state=state.filter(a=>!(String(a.saturday_number)===n&&a.employee_id===id)); renderEditor(); });
      $$('[data-add]').forEach(s=>s.onchange=()=>{ const n=+s.dataset.add, id=s.value; if(!id)return; const e=emps.find(x=>x.id===id); state.push({saturday_number:n,saturday_date:sats[n-1],employee_id:id,employee_name:e.name}); renderEditor(); });
    }

    // histórico agrupado por mês → por sábado (data DD/MM/AAAA, visual em cards)
    const byMonth={};
    for(const r of recent){
      if(!r.saturday_date) continue;
      const [yy,mm]=r.saturday_date.split('-');
      const mk=`${yy}-${mm}`;
      const M=byMonth[mk]||(byMonth[mk]={label:`${MONTHS[+mm-1]} ${yy}`, sats:{}});
      const S2=M.sats[r.saturday_date]||(M.sats[r.saturday_date]={num:r.saturday_number, date:r.saturday_date, people:[]});
      const pn=r.employee_name||empName[r.employee_id]||'';
      if(pn && !S2.people.includes(pn)) S2.people.push(pn);
    }
    const histHtml=Object.keys(byMonth).sort().reverse().map(mk=>{
      const M=byMonth[mk];
      const rows=Object.keys(M.sats).sort().reverse().map(sk=>{
        const s=M.sats[sk]; const dBR=s.date.split('-').reverse().join('/');
        return `<div style="display:flex;align-items:center;gap:14px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:#fff;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:88px;background:#eef1ff;border-radius:10px;padding:7px 10px">
            <span style="font-weight:800;font-size:12px;color:var(--brand)">${s.num}º sábado</span>
            <span style="font-weight:700;font-size:13px">${dBR}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0">
            ${s.people.map(p=>`<span class="pill ativa" style="font-size:12.5px">${esc(p)}</span>`).join('')||'<span class="muted">—</span>'}
          </div></div>`;
      }).join('');
      return `<div style="margin-bottom:18px">
        <div style="font-weight:800;font-size:15px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)">${M.label}</div>
        ${rows}</div>`;
    }).join('')||'<p class="muted" style="margin:0">Sem histórico ainda.</p>';

    $('#view').innerHTML=`
    <div class="toolbar">
      <button class="btn sec sm" id="satPrev">←</button>
      <b style="min-width:150px;text-align:center">${MONTHS[month-1]} ${year}</b>
      <button class="btn sec sm" id="satNext">→</button>
      <button class="btn" id="genSat" ${isGestor()?'':'disabled'}>⚡ Gerar sugestão</button>
      <button class="btn sec" id="saveSat" ${isGestor()?'':'disabled'}>💾 Salvar rodízio</button>
      <div class="spacer"></div><span class="muted">${rules.saturday_start||'14:00'}–${rules.saturday_end||'17:00'}</span>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 4px">
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:230px;max-width:360px">
        <span class="muted">Sábados que abrem neste mês:</span>
        <select id="satMode" ${isGestor()?'':'disabled'}>
          <option value="dois_primeiros" ${monthMode==='dois_primeiros'?'selected':''}>Os dois primeiros</option>
          <option value="primeiro_ultimo" ${monthMode==='primeiro_ultimo'?'selected':''}>O primeiro e o último</option>
          <option value="todos" ${monthMode==='todos'?'selected':''}>Todos</option></select>
        <span class="muted" style="font-size:12px">${sats.length} sábado(s): ${sats.map(d=>d.split('-').reverse().slice(0,2).join('/')).join(', ')||'—'}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:230px;max-width:360px">
        <span class="muted">Reforço (mais gente em qual sábado):</span>
        <select id="satReinf" ${isGestor()?'':'disabled'}>
          <option value="auto" ${monthReinforce==='auto'?'selected':''}>Automático (mais no 1º, inverte em feriado)</option>
          <option value="primeiro" ${monthReinforce==='primeiro'?'selected':''}>Mais no 1º sábado (${bigN} e ${smallN})</option>
          <option value="segundo" ${monthReinforce==='segundo'?'selected':''}>Mais no 2º sábado (${smallN} e ${bigN})</option></select>
        <span class="muted" style="font-size:12px">1º: ${targets[0]??'—'} · 2º: ${targets[1]??'—'} pessoa(s)</span>
      </div>
    </div>
    ${passed?box('warn','Estes sábados <b>já passaram</b>. Você pode registrar quem trabalhou (alimenta o histórico) ou ir para um mês futuro no <b>→</b>.'):box('info','O sistema sugere e <b>equilibra pelo histórico</b>. Ajuste na mão: remova no × e adicione pela lista — útil quando alguém pede para trocar um sábado. Depois <b>Salvar rodízio</b>.')}
    <div id="satEditor"></div>
    <div class="section panel"><div class="ph"><h3>Histórico de sábados</h3><span class="muted">por mês</span></div>
      <div class="pb">${histHtml}</div></div>`;
    renderEditor();
    $('#satPrev').onclick=()=>{ month--; if(month<1){month=12;year--;} load(); };
    $('#satNext').onclick=()=>{ month++; if(month>12){month=1;year++;} load(); };
    $('#satMode')?.addEventListener('change',async(e)=>{ if(!gate())return; const mode=e.target.value;
      const res=await T('month_settings').upsert({year,month,sat_mode:mode},{onConflict:'year,month'}); if(res.error){toast(res.error.message);return;}
      toast('Modo de sábados deste mês atualizado.'); load(); });
    $('#satReinf')?.addEventListener('change',async(e)=>{ if(!gate())return; const rein=e.target.value;
      const res=await T('month_settings').upsert({year,month,sat_reinforce:rein},{onConflict:'year,month'}); if(res.error){toast(res.error.message);return;}
      toast('Reforço deste mês atualizado — gere a sugestão de novo.'); load(); });
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
    const mset=await T('month_settings').select('*').eq('year',year).eq('month',month).maybeSingle().then(r=>r.data||null);
    const nm=Object.fromEntries(emps.map(e=>[e.id,e.name]));
    const satMode=(mset&&mset.sat_mode)||rules.saturday_open_mode||'dois_primeiros';
    const sats=Engine.openSaturdays(year,month,satMode).map(Engine.fmt);
    const dowFull=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const dayEv=[];
    for(let d=1;d<=dim;d++){
      const ds=`${year}-${mm}-${String(d).padStart(2,'0')}`; const dow=new Date(year,month-1,d).getDay();
      let ev='';
      items.filter(x=>x.date===ds).sort((a,b)=>folgaSortKey(a,rules)-folgaSortKey(b,rules)).forEach(x=>{ const fn=(x.employee_name||'').split(' ')[0]; const t=folgaTimeLabel(x,rules); ev+=`<span class="ev folga" title="${esc(x.employee_name||'')} — ${esc(t)}">${esc(fn)}<span class="evt">${esc(t)}</span></span>`; });
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
    <div class="toolbar"><button class="btn sec sm" id="prev">←</button><b style="min-width:140px;text-align:center">${MONTHS[month-1]} ${year}</b><button class="btn sec sm" id="next">→</button>
      <button class="btn sm" onclick="location.hash='#relsemana'">📋 Relatório semanal</button><div class="spacer"></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Folga</span><span><i class="dot" style="background:var(--amber)"></i>Férias</span><span><i class="dot" style="background:var(--purple)"></i>Sábado</span><span><i class="dot" style="background:var(--red)"></i>Bloqueio</span></div></div>
    ${body}`;
    $('#prev').onclick=()=>{month--;if(month<1){month=12;year--;}draw();};
    $('#next').onclick=()=>{month++;if(month>12){month=1;year++;}draw();};
  }
  draw();
};

// ---------- PEDIDOS ----------
ROUTES.pedidos=async function(){
  const ini=todayStr().slice(0,8)+'01';
  const [emps,reqs,rules,scheds]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),
    getAll('dayoff_requests',b=>b.order('created_at',{ascending:false}).limit(50)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('schedules',b=>b.eq('is_simulation',S.sim))]);
  const schedIds=new Set(scheds.map(s=>s.id));
  const folgas=(await getAll('schedule_items',b=>b.eq('status','aprovado').gte('date',ini).order('date'))).filter(it=>schedIds.has(it.schedule_id));
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addFolga" ${isGestor()?'':'disabled'}>+ Lançar folga</button>
    <button class="btn sec" id="addReq" ${isGestor()?'':'disabled'}>+ Registrar exceção (falta, atestado…)</button></div>
  ${box('info','<b>Lançar folga</b> registra uma folga <b>já aprovada</b> (você escolhe integral, meio turno ou o horário de sair/entrar) — o <b>motor de folgas já considera</b> essa folga: conta o horário ocupado e não oferece o mesmo horário para outra pessoa no dia. Férias (em Funcionárias) também entram automaticamente na conta. As <b>exceções de falta, atestado e afastamento</b> também tiram a funcionária do dia inteiro (o painel e o motor já consideram, <b>sem descontar banco</b>). <b>Atraso</b> e <b>troca</b> são só registro de histórico.')}
  <div class="panel"><div class="ph"><h3>Folgas lançadas (a partir deste mês)</h3><span class="muted">${folgas.length} folga(s)</span></div>
    <div class="pb">${folgas.map(it=>`<div class="card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="min-width:0">
        <div style="font-weight:700">${esc(it.employee_name||map[it.employee_id]||'')} <span class="muted" style="font-weight:500;font-size:13px">· ${(it.date||'').split('-').reverse().slice(0,2).join('/')} (${it.date?Engine.DOW[Engine.parse(it.date).getDay()]:''})</span></div>
        <div style="font-size:14px;font-weight:600;margin-top:2px">${folgaTimeLabel(it,rules)} <span class="muted" style="font-weight:500">(${TYPE_LABEL[it.type]||it.type}${it.hours?' · '+it.hours+'h':''})</span></div>
      </div>
      <div class="row-actions">${isGestor()?`<button class="btn ghost sm" data-edf="${it.id}">Editar</button><button class="btn ghost sm" style="color:var(--red)" data-delf="${it.id}">Remover</button>`:''}</div>
    </div>`).join('')||'<p class="muted" style="margin:0">Nenhuma folga lançada. Use “+ Lançar folga”.</p>'}</div></div>
  <div class="section panel"><div class="ph"><h3>Exceções (falta, atestado, afastamento, atraso, troca)</h3></div><div class="pb" style="padding:0"><table>
    <thead><tr><th>Funcionária</th><th>Data</th><th>Tipo</th><th>Motivo</th><th>Status</th><th></th></tr></thead>
    <tbody>${reqs.map(r=>`<tr><td><b>${esc(r.employee_name||map[r.employee_id]||'—')}</b></td><td>${r.date||'—'}</td><td>${reqTypeLabel(r.request_type)}</td><td class="muted">${esc(r.reason||'')}</td>
      <td><span class="pill ${r.status==='aprovado'?'ativa':r.status==='recusado'?'afastada':'ferias'}">${r.status}</span></td>
      <td class="row-actions">${isGestor()?`${r.status==='pendente'?`<button class="btn sm" data-ap="${r.id}">Aprovar</button><button class="btn sec sm" data-rf="${r.id}">Recusar</button>`:''}<button class="btn ghost sm" data-edexc="${r.id}">Editar</button><button class="btn ghost sm" style="color:var(--red)" data-delexc="${r.id}">Remover</button>`:''}</td></tr>`).join('')||'<tr><td colspan=6 class="muted" style="padding:16px">Nenhum pedido registrado.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addFolga')?.addEventListener('click',()=>folgaModal(null,emps,rules));
  $$('[data-edf]').forEach(b=>b.onclick=()=>folgaModal(folgas.find(x=>x.id===b.dataset.edf),emps,rules));
  $$('[data-delf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; if(!confirm('Remover esta folga?'))return; await T('schedule_items').delete().eq('id',b.dataset.delf); toast('Folga removida.'); route(); });
  function reqModal(r){
    const types=[['falta','Falta'],['atestado','Atestado'],['afastamento','Afastamento'],['atraso','Atraso'],['troca_folga','Troca de folga']];
    openModal(r?'Editar exceção':'Registrar exceção',`
      <div class="field"><label>Funcionária</label><select id="q_emp">${emps.map(e=>`<option value="${e.id}" ${r&&r.employee_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label>Data</label><input id="q_date" type="date" value="${r&&r.date?r.date:todayStr()}"/></div>
        <div class="field"><label>Tipo</label><select id="q_type">${types.map(([v,l])=>`<option value="${v}" ${r&&r.request_type===v?'selected':''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label>Motivo</label><input id="q_reason" value="${r?esc(r.reason||''):''}"/></div>
      ${box('info','<b>Falta, atestado e afastamento</b> tiram a funcionária do dia inteiro — o painel e o motor de folgas já consideram (sem descontar banco). <b>Atraso</b> e <b>troca</b> são só registro.')}`,
      async()=>{ if(!gate())return false; const emp=emps.find(e=>e.id===$('#q_emp').value);
        const data={employee_id:emp.id,employee_name:emp.name,date:$('#q_date').value,request_type:$('#q_type').value,reason:$('#q_reason').value,status:'aprovado'};
        const res= r ? await T('dayoff_requests').update(data).eq('id',r.id) : await T('dayoff_requests').insert(data);
        if(res.error){toast(res.error.message);return false;} toast(r?'Exceção atualizada.':'Exceção registrada.'); route(); return true; });
  }
  $('#addReq')?.addEventListener('click',()=>reqModal(null));
  $$('[data-edexc]').forEach(b=>b.onclick=()=>reqModal(reqs.find(x=>x.id===b.dataset.edexc)));
  $$('[data-delexc]').forEach(b=>b.onclick=async()=>{ if(!gate())return; if(!confirm('Remover esta exceção?'))return; await T('dayoff_requests').delete().eq('id',b.dataset.delexc); toast('Exceção removida.'); route(); });
  $$('[data-ap]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('dayoff_requests').update({status:'aprovado'}).eq('id',b.dataset.ap); toast('Aprovado.'); route(); });
  $$('[data-rf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('dayoff_requests').update({status:'recusado'}).eq('id',b.dataset.rf); toast('Recusado.'); route(); });
};
function reqTypeLabel(t){return {pedido_folga:'Pedido de folga',recusa_folga:'Recusa de folga',falta:'Falta',atestado:'Atestado',afastamento:'Afastamento',saida_antecipada:'Saída antecipada',atraso:'Atraso',troca_folga:'Troca de folga'}[t]||t;}

// ---------- RELATÓRIOS ----------
ROUTES.relatorios=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1, hoje=todayStr();
  const [emps,items,reqs,rot,scheds,rules]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim)),getAll('schedule_items'),getAll('dayoff_requests'),getAll('saturday_rotation'),getAll('schedules',b=>b.eq('is_simulation',S.sim)),T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{})]);
  const sIds=new Set(scheds.map(s=>s.id));
  const appr=items.filter(i=>i.status==='aprovado'&&sIds.has(i.schedule_id));
  const history=await buildHistory();
  const fair=Engine.fairnessIndex(emps,history);
  const ballColor={justo:'var(--green)',aceitavel:'var(--brand)',atencao:'var(--amber)',desequilibrado:'var(--red)'}[fair.status];
  // véspera/pós-feriado (±1 dia de data comemorativa)
  const commDates=[...Engine.commemorativeDates(year-1),...Engine.commemorativeDates(year),...Engine.commemorativeDates(year+1)].map(c=>Engine.parse(c.date).getTime());
  const nearHoliday=(ds)=>{const t=Engine.parse(ds).getTime();return commDates.some(c=>Math.abs((c-t)/86400000)<=1);};
  const active=emps.filter(e=>e.status!=='desligada');
  const per=active.map(e=>{
    const mine=appr.filter(i=>i.employee_id===e.id);
    const dow=ds=>Engine.parse(ds).getDay();
    const past=mine.filter(i=>i.date<=hoje).map(i=>i.date).sort();
    const ultima=past.length?past[past.length-1]:null;
    const r={ e,
      folgas:mine.length,
      horas:mine.reduce((s,i)=>s+(+i.hours||0),0),
      sextas:mine.filter(i=>dow(i.date)===5).length,
      segundas:mine.filter(i=>dow(i.date)===1).length,
      integral:mine.filter(i=>i.type==='integral').length,
      meio:mine.filter(i=>i.type==='meio_turno').length,
      vesp:mine.filter(i=>nearHoliday(i.date)).length,
      sabados:rot.filter(x=>x.employee_id===e.id && x.worked!==false).length,
      recusas:reqs.filter(x=>x.employee_id===e.id&&x.request_type==='recusa_folga').length,
      faltas:reqs.filter(x=>x.employee_id===e.id&&x.request_type==='falta').length,
      pedidos:reqs.filter(x=>x.employee_id===e.id&&['troca_folga','pedido_folga'].includes(x.request_type)).length + mine.filter(i=>/manual/i.test(i.reason||'')).length,
      semFolgar: ultima? Math.floor((new Date(hoje+'T00:00:00')-Engine.parse(ultima))/86400000) : null,
      banco:+e.time_bank_balance||0 };
    r.vantagem = r.sextas*2 + r.segundas*1.5 + r.integral*2 + r.vesp*1.5 + r.folgas; // folgas "boas" acumuladas
    return r;
  });
  const avgV = per.length? per.reduce((s,p)=>s+p.vantagem,0)/per.length : 0;
  const minB = rules.min_time_bank_for_dayoff||6, custoFolga = rules.early_leave_hours??3;
  const limiteFolga = Math.min(minB, custoFolga); // saldo mínimo para conseguir UMA folga
  // balanço usa o banco RESTANTE (descontando as folgas já aprovadas). Sem saldo = "em dia", não prejuízo.
  const balanco=(p)=>{
    const restante = p.banco - (p.horas||0);
    if (restante < limiteFolga) return {t:'em dia',c:'var(--muted)',note:'sem saldo p/ folga'};
    if (avgV<=0) return {t:'equilibrada',c:'var(--muted)'};
    if (p.vantagem > avgV*1.3) return {t:'favorecida',c:'var(--amber)'};
    if (p.vantagem < avgV*0.7) return {t:'prejudicada',c:'var(--green)'}; // tem saldo e recebeu poucas folgas boas
    return {t:'equilibrada',c:'var(--muted)'};
  };
  $('#view').innerHTML=`
  <div class="cards">
    <div class="card"><h3>Índice de justiça</h3><div class="fair" style="font-size:20px"><span class="ball" style="background:${ballColor}"></span>${fair.status} · ${fair.score}</div><div class="reason">${esc(fair.reason)}</div></div>
    <div class="card"><h3>Folgas aprovadas</h3><div class="kpi">${appr.length}</div></div>
    <div class="card"><h3>Sábados trabalhados</h3><div class="kpi">${rot.filter(r=>r.worked!==false).length}</div></div>
    <div class="card"><h3>Em férias</h3><div class="kpi">${emps.filter(e=>e.status==='ferias').length}</div></div>
  </div>
  <div class="section"><div class="ph" style="padding:0 4px 8px"><h3>Justiça por funcionária</h3><span class="muted">todos os fatores</span></div>
    ${(()=>{ const stat=(label,val,hot)=>`<div style="background:#f4f6fb;border-radius:10px;padding:9px 11px"><div class="muted" style="font-size:11.5px;line-height:1.25">${label}</div><div style="font-weight:800;font-size:19px;margin-top:3px;color:${hot?'var(--amber)':'var(--ink)'}">${val}</div></div>`;
      return per.sort((a,b)=>b.banco-a.banco).map(p=>{ const b=balanco(p);
        return `<div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
            <div style="font-weight:800;font-size:16px">${esc(p.e.name)}</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <span class="muted" style="font-size:13px">Banco: <b style="color:var(--ink)">${fmtH(p.banco)}</b>${p.horas>0?` · resta <b style="color:var(--ink)">${fmtH(p.banco-p.horas)}</b> após folgas`:''}</span>
              <span class="pill" style="background:${b.c}22;color:${b.c};font-weight:700;text-transform:capitalize">${b.t}${b.note?' · '+b.note:''}</span></div></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px">
            ${stat('Folgas no total',p.folgas)}
            ${stat('Horas compensadas',fmtH(p.horas))}
            ${stat('Sextas folgadas',p.sextas,p.sextas>0)}
            ${stat('Segundas folgadas',p.segundas,p.segundas>0)}
            ${stat('Folgas de dia inteiro',p.integral,p.integral>0)}
            ${stat('Folgas de meio turno',p.meio)}
            ${stat('Véspera de feriado',p.vesp,p.vesp>0)}
            ${stat('Sábados trabalhados',p.sabados)}
            ${stat('Recusas de folga',p.recusas)}
            ${stat('Faltas',p.faltas)}
            ${stat('Pedidos / trocas',p.pedidos)}
            ${stat('Dias sem folgar',p.semFolgar==null?'—':p.semFolgar+' dias')}
          </div></div>`;
      }).join('')||'<p class="muted">Sem dados ainda.</p>';
    })()}
  </div>
  ${box('info','<b>Como o balanço é calculado:</b> o sistema soma as folgas "boas" de cada uma (sextas, segundas, dia inteiro, véspera de feriado, total de folgas) e compara com a média da equipe — <b>mas só entre quem tem banco de horas para folgar</b>. <b>Favorecida</b>: recebeu mais folgas boas que a média (perde prioridade). <b>Prejudicada</b>: tem banco para compensar mas recebeu poucas folgas boas (ganha prioridade). <b>Em dia (banco baixo)</b>: já compensou as horas e não tem saldo para mais folgas — não é prejuízo. Os números em <span style="color:var(--amber);font-weight:700">laranja</span> destacam as folgas mais disputadas. Tudo já entra automaticamente no motor.')}`;
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
