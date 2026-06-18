// ============================================================
// APP — Sistema de Escalas Ótica Carina
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
const h=(html)=>{const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstChild;};
const esc=(s)=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isGestor=()=>S.role==='gestor';
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}
function gate(){ if(!isGestor()){ toast('Apenas o gestor pode alterar dados.'); return false;} return true; }
const todayStr=()=>new Date().toISOString().slice(0,10);
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const SHIFT_LABEL={manha:'Manhã',tarde:'Tarde',sabado_tarde:'Sábado tarde'};
const TYPE_LABEL={integral:'Folga integral',meio_turno:'Meio turno',entrada_tarde:'Entrada mais tarde',saida_antecipada:'Saída antecipada'};

// ---------- DB (prefixo esc_) ----------
const T=(name)=>sb.from('esc_'+name);
async function getAll(name, q){ let b=T(name).select('*'); if(q) b=q(b); const {data,error}=await b; if(error){console.warn(name,error.message);} return data||[]; }

// ---------- Auth ----------
async function doLogin(){
  const email=$('#liEmail').value.trim(), pass=$('#liPass').value;
  $('#loginErr').innerHTML='';
  if(!email||!pass){ $('#loginErr').innerHTML=alert('err','Informe e-mail e senha.'); return; }
  if(!sb||CFG.SUPABASE_URL==='COLE_AQUI_A_URL'){ $('#loginErr').innerHTML=alert('err','Configuração do Supabase ausente em config.js.'); return; }
  const {error}=await sb.auth.signInWithPassword({email,password:pass});
  if(error){ $('#loginErr').innerHTML=alert('err','Não foi possível entrar: '+error.message); return; }
  await boot();
}
async function doSignup(){
  const email=$('#liEmail').value.trim(), pass=$('#liPass').value;
  if(!email||pass.length<6){ $('#loginErr').innerHTML=alert('warn','Para criar conta: e-mail válido e senha de 6+ caracteres.'); return; }
  const {error}=await sb.auth.signUp({email,password:pass});
  if(error){ $('#loginErr').innerHTML=alert('err',error.message); return; }
  $('#loginErr').innerHTML=alert('ok','Conta criada! Se o projeto exigir confirmação por e-mail, confirme antes de entrar. O primeiro usuário vira Gestor.');
}
async function logout(){ await sb.auth.signOut(); location.reload(); }

function alert(kind,msg){ return `<div class="alert ${kind}"><span>${kind==='err'?'⚠️':kind==='ok'?'✅':kind==='warn'?'🔔':'ℹ️'}</span><div>${msg}</div></div>`; }

// ---------- Boot ----------
async function boot(){
  const {data:{user}}=await sb.auth.getUser();
  if(!user){ $('#login').style.display='flex'; $('#app').style.display='none'; return; }
  S.user=user;
  // carrega profile (role)
  let {data:prof}=await T('profiles').select('*').eq('id',user.id).maybeSingle();
  if(!prof){ // fallback: cria/garante profile
    await T('profiles').upsert({id:user.id,email:user.email}).select();
    ({data:prof}=await T('profiles').select('*').eq('id',user.id).maybeSingle());
  }
  S.profile=prof||{role:'viewer',email:user.email};
  S.role=S.profile.role||'viewer';
  $('#login').style.display='none'; $('#app').style.display='block';
  $('#uEmail').textContent=user.email;
  $('#uRole').innerHTML=`<span class="badge ${S.role}">${S.role==='gestor'?'Gestor':'Visualização'}</span>`;
  $('#footUser').innerHTML=`${esc(user.email)}<br><span class="muted">${S.role==='gestor'?'Acesso total':'Somente leitura'}</span>`;
  renderNav(); renderSimToggle();
  if(!location.hash) location.hash='#dashboard';
  route();
}

// ---------- Nav ----------
const NAV=[
  ['dashboard','📊','Dashboard'],
  ['funcionarias','👥','Funcionárias'],
  ['folgas','🌴','Motor de folgas'],
  ['sabados','📅','Rodízio sábados'],
  ['calendario','🗓️','Calendário'],
  ['ferias','✈️','Férias'],
  ['pedidos','📨','Pedidos & exceções'],
  ['importar','📥','Importar TiqueTaque'],
  ['regras','⚙️','Regras da loja'],
  ['relatorios','📈','Relatórios'],
  ['simulacao','🧪','Simulação'],
];
function renderNav(){
  $('#nav').innerHTML=NAV.map(([k,i,l])=>`<a href="#${k}" data-k="${k}"><span class="ico">${i}</span>${l}</a>`).join('');
}
function renderSimToggle(){
  $('#simToggleWrap').innerHTML=`<button class="btn ${S.sim?'':'sec'} sm" id="simBtn">${S.sim?'🧪 Simulação ON':'🧪 Simulação'}</button>`;
  $('#simBtn').onclick=()=>{ S.sim=!S.sim; renderSimToggle(); updateSimBanner(); route(); };
  updateSimBanner();
}
function updateSimBanner(){
  $('#simBanner').innerHTML = S.sim ? `<div class="simbanner">🧪 MODO SIMULAÇÃO — usando dados fictícios. Nada aqui afeta os dados reais.</div>`:'';
}

// ---------- Router ----------
const ROUTES={};
function route(){
  const k=(location.hash||'#dashboard').slice(1);
  $$('#nav a').forEach(a=>a.classList.toggle('active',a.dataset.k===k));
  const def=NAV.find(n=>n[0]===k);
  $('#pageTitle').textContent=def?def[2]:'Dashboard';
  $('#sidebar').classList.remove('open');
  const fn=ROUTES[k]||ROUTES.dashboard;
  $('#view').innerHTML='<p class="muted">Carregando…</p>';
  fn();
}
window.addEventListener('hashchange',route);

// ============================================================
// VIEWS
// ============================================================

// ---------- DASHBOARD ----------
ROUTES.dashboard=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1;
  const [emps,rules,vacs,scheds]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('vacation_periods'),
    getAll('schedules',b=>b.eq('is_simulation',S.sim).order('created_at',{ascending:false}).limit(1)),
  ]);
  const active=emps.filter(e=>e.status==='ativa');
  const onVac=emps.filter(e=>e.status==='ferias');
  const cap=Engine.operationalCapacity(emps,rules);
  const highBank=emps.filter(e=>(e.time_bank_balance||0)>=(rules.max_time_bank||20));
  const totalBank=emps.reduce((s,e)=>s+(+e.time_bank_balance||0),0);

  let alerts='';
  if(cap.availableForShift<=cap.minPerShift) alerts+=alert('err',`<b>Cobertura mínima em risco:</b> ${cap.availableForShift} ativa(s) para mínimo de ${cap.minPerShift} por turno.`);
  if(onVac.length>=1) alerts+=alert('warn',`<b>Equipe reduzida:</b> ${onVac.length} funcionária(s) em férias. ${cap.note}`);
  if(highBank.length) alerts+=alert('warn',`<b>Banco de horas alto:</b> ${highBank.map(e=>e.name+' ('+e.time_bank_balance+'h)').join(', ')} acima do limite de ${rules.max_time_bank||20}h.`);
  if(!alerts) alerts=alert('ok','Tudo sob controle: cobertura adequada e banco de horas dentro do limite.');

  $('#view').innerHTML=`
  <div class="cards">
    <div class="card"><h3>Funcionárias ativas</h3><div class="kpi">${active.length}<small> / ${emps.length}</small></div></div>
    <div class="card"><h3>Em férias</h3><div class="kpi">${onVac.length}</div></div>
    <div class="card"><h3>Banco de horas total</h3><div class="kpi">${totalBank.toFixed(0)}<small>h</small></div></div>
    <div class="card"><h3>Capacidade operacional</h3><div class="kpi" style="font-size:18px;text-transform:capitalize">${cap.level.replace('_',' ')}</div><div class="reason">${cap.note}</div></div>
  </div>
  <div class="section">${alerts}</div>
  <div class="toolbar">
    <button class="btn" id="genBtn">⚡ Gerar escala automática</button>
    <button class="btn sec" onclick="location.hash='#simulacao'">🧪 Abrir simulação</button>
    <div class="spacer"></div><span class="muted">${MONTHS[month-1]} de ${year}</span>
  </div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Banco de horas por funcionária</h3></div><div class="pb" style="padding:0">
      <table><thead><tr><th>Funcionária</th><th>Cargo</th><th>Banco</th><th>Status</th></tr></thead><tbody>
      ${emps.sort((a,b)=>(b.time_bank_balance||0)-(a.time_bank_balance||0)).map(e=>`<tr>
        <td><b>${esc(e.name)}</b></td><td class="muted">${esc(e.cargo||'—')}</td>
        <td><b>${(+e.time_bank_balance||0).toFixed(0)}h</b></td>
        <td><span class="pill ${e.status}">${e.status}</span></td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:18px">Nenhuma funcionária cadastrada.</td></tr>'}
      </tbody></table>
    </div></div>
    <div class="panel"><div class="ph"><h3>Próximas folgas sugeridas</h3><a href="#folgas" class="btn ghost sm">Ver motor →</a></div>
      <div class="pb" id="dashSug"><p class="muted">Clique em “Gerar escala automática”.</p></div></div>
  </div>`;
  $('#genBtn').onclick=()=>location.hash='#folgas';
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
      <td>${e.weekly_hours||44}h</td><td><b>${(+e.time_bank_balance||0).toFixed(0)}h</b></td>
      <td>${e.manual_priority||0}</td>
      <td class="row-actions">
        <button class="btn ghost sm" data-edit="${e.id}">Editar</button>
        ${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-del="${e.id}">Excluir</button>`:''}
      </td></tr>`).join('')||'<tr><td colspan=7 class="muted" style="padding:18px">Nenhuma funcionária. Clique em “Nova funcionária”.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addEmp')?.addEventListener('click',()=>empModal());
  $$('[data-edit]').forEach(b=>b.onclick=()=>empModal(emps.find(e=>e.id===b.dataset.edit)));
  $$('[data-del]').forEach(b=>b.onclick=async()=>{ if(!gate())return; if(!confirm('Excluir esta funcionária?'))return;
    await T('employees').delete().eq('id',b.dataset.del); toast('Excluída.'); route(); });
};
function empModal(e){
  e=e||{};
  const m=openModal(e.id?'Editar funcionária':'Nova funcionária',`
    <div class="field"><label>Nome *</label><input id="f_name" value="${esc(e.name||'')}"/></div>
    <div class="grid2">
      <div class="field"><label>Cargo / função</label><input id="f_cargo" value="${esc(e.cargo||'')}" placeholder="Vendedora, Caixa, Óptica…"/></div>
      <div class="field"><label>Status</label><select id="f_status">${['ativa','ferias','licenca','afastada','desligada'].map(s=>`<option ${e.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="grid3">
      <div class="field"><label>Carga semanal (h)</label><input id="f_wh" type="number" value="${e.weekly_hours||44}"/></div>
      <div class="field"><label>Banco de horas (h)</label><input id="f_bank" type="number" step="0.5" value="${e.time_bank_balance||0}"/></div>
      <div class="field"><label>Prioridade manual</label><input id="f_prio" type="number" value="${e.manual_priority||0}"/></div>
    </div>
    <div class="field"><label>Preferências de folga</label><input id="f_pref" value="${esc(e.preferences||'')}" placeholder="Ex.: prefere folgar 2ª à tarde"/></div>
    <div class="field"><label>Restrições pessoais</label><input id="f_restr" value="${esc(e.restrictions||'')}" placeholder="Ex.: não pode sábado"/></div>
    <div class="field"><label>Observações internas</label><textarea id="f_notes" rows="2">${esc(e.notes||'')}</textarea></div>
  `,async()=>{
    if(!gate())return false;
    const name=$('#f_name').value.trim(); if(!name){toast('Informe o nome.');return false;}
    const payload={name,cargo:$('#f_cargo').value.trim(),status:$('#f_status').value,
      weekly_hours:+$('#f_wh').value||44,time_bank_balance:+$('#f_bank').value||0,
      manual_priority:+$('#f_prio').value||0,preferences:$('#f_pref').value.trim(),
      restrictions:$('#f_restr').value.trim(),notes:$('#f_notes').value.trim(),is_simulation:S.sim,updated_at:new Date().toISOString()};
    const r = e.id ? await T('employees').update(payload).eq('id',e.id) : await T('employees').insert(payload);
    if(r.error){toast('Erro: '+r.error.message);return false;}
    toast('Salvo.'); route(); return true;
  });
}

// ---------- REGRAS ----------
ROUTES.regras=async function(){
  const r=(await T('store_rules').select('*').eq('id',1).maybeSingle()).data||{};
  const blocked=await getAll('blocked_dates',b=>b.order('date'));
  $('#view').innerHTML=`
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Funcionamento e turnos</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Abre</label><input id="r_open" type="time" value="${r.open_time||'09:00'}"/></div>
        <div class="field"><label>Fecha</label><input id="r_close" type="time" value="${r.close_time||'18:00'}"/></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Mínimo por turno</label><input id="r_min" type="number" value="${r.min_per_shift||4}"/></div>
        <div class="field"><label>Limite recomendado de banco (h)</label><input id="r_maxbank" type="number" value="${r.max_time_bank||20}"/></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Mín. de banco p/ sugerir folga (h)</label><input id="r_minbank" type="number" value="${r.min_time_bank_for_dayoff||6}"/></div>
        <div class="field"><label>Folga: mín–máx (h)</label>
          <div style="display:flex;gap:6px"><input id="r_dmin" type="number" value="${r.min_dayoff_hours||3}"/><input id="r_dmax" type="number" value="${r.max_dayoff_hours||8}"/></div></div>
      </div>
    </div></div>
    <div class="panel"><div class="ph"><h3>Sábados & escala 5x2</h3></div><div class="pb">
      <div class="grid2">
        <div class="field"><label>Sábados abertos / mês</label><input id="r_satn" type="number" value="${r.saturday_open_count||2}"/></div>
        <div class="field"><label>Horário do sábado</label>
          <div style="display:flex;gap:6px"><input id="r_sats" type="time" value="${r.saturday_start||'14:00'}"/><input id="r_sate" type="time" value="${r.saturday_end||'17:00'}"/></div></div>
      </div>
      <div class="field"><label>Escala 5x2 (futura)</label>
        <select id="r_5x2"><option value="false" ${!r.scale_5x2_enabled?'selected':''}>Desativada (modelo atual)</option>
        <option value="true" ${r.scale_5x2_enabled?'selected':''}>Ativada</option></select>
        <div class="reason">Quando ativada: domingo fixo de folga + 1 dia rotativo na semana, com rodízio justo. A arquitetura já está preparada.</div></div>
      <button class="btn" id="saveRules" ${isGestor()?'':'disabled'}>Salvar regras</button>
    </div></div>
  </div>
  <div class="section panel"><div class="ph"><h3>Dias bloqueados / datas especiais</h3>
    <button class="btn sm" id="addBlk" ${isGestor()?'':'disabled'}>+ Adicionar</button></div>
    <div class="pb" style="padding:0"><table><thead><tr><th>Data</th><th>Tipo</th><th>Motivo</th><th></th></tr></thead>
    <tbody>${blocked.map(b=>`<tr><td>${b.date}</td><td>${b.type}</td><td>${esc(b.reason||'')}</td>
      <td>${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-delblk="${b.id}">remover</button>`:''}</td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:16px">Nenhum dia bloqueado.</td></tr>'}
    </tbody></table></div></div>`;
  $('#saveRules')?.addEventListener('click',async()=>{ if(!gate())return;
    const payload={id:1,open_time:$('#r_open').value,close_time:$('#r_close').value,min_per_shift:+$('#r_min').value,
      max_time_bank:+$('#r_maxbank').value,min_time_bank_for_dayoff:+$('#r_minbank').value,
      min_dayoff_hours:+$('#r_dmin').value,max_dayoff_hours:+$('#r_dmax').value,
      saturday_open_count:+$('#r_satn').value,saturday_start:$('#r_sats').value,saturday_end:$('#r_sate').value,
      scale_5x2_enabled:$('#r_5x2').value==='true',updated_at:new Date().toISOString()};
    const res=await T('store_rules').upsert(payload); if(res.error){toast('Erro: '+res.error.message);return;}
    toast('Regras salvas.'); });
  $('#addBlk')?.addEventListener('click',()=>{
    openModal('Bloquear data',`
      <div class="field"><label>Data</label><input id="b_date" type="date" value="${todayStr()}"/></div>
      <div class="field"><label>Tipo</label><select id="b_type"><option value="bloqueio">Bloqueio de folga</option><option value="especial">Data especial</option><option value="alto_movimento">Alto movimento</option></select></div>
      <div class="field"><label>Motivo</label><input id="b_reason" placeholder="Ex.: liquidação, feriado movimentado"/></div>`,
      async()=>{ if(!gate())return false; const res=await T('blocked_dates').insert({date:$('#b_date').value,type:$('#b_type').value,reason:$('#b_reason').value});
        if(res.error){toast(res.error.message);return false;} toast('Adicionado.'); route(); return true; });
  });
  $$('[data-delblk]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('blocked_dates').delete().eq('id',b.dataset.delblk); route(); });
};

// ---------- IMPORTAR TIQUETAQUE ----------
ROUTES.importar=async function(){
  const imports=await getAll('time_bank_imports',b=>b.order('imported_at',{ascending:false}).limit(10));
  $('#view').innerHTML=`
  ${alert('info','<b>Integração TiqueTaque.</b> O TiqueTaque exporta relatórios em <b>Excel, CSV e PDF</b> e possui <b>API aberta</b>. Hoje usamos importação manual de planilha (seguro, sem senhas). A estrutura já está pronta para plugar a API depois.')}
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Importar planilha / CSV</h3></div><div class="pb">
      <p class="muted" style="margin-top:0">Colunas reconhecidas (qualquer ordem): <b>nome, saldo, horas_positivas, horas_negativas, faltas, atrasos, saidas_antecipadas, batidas_faltantes</b>.</p>
      <div class="field"><label>Arquivo (.xlsx, .xls ou .csv)</label><input id="imp_file" type="file" accept=".xlsx,.xls,.csv" ${isGestor()?'':'disabled'}/></div>
      <div class="grid2"><div class="field"><label>Período de</label><input id="imp_from" type="date"/></div>
        <div class="field"><label>Período até</label><input id="imp_to" type="date"/></div></div>
      <div id="impPreview"></div>
    </div></div>
    <div class="panel"><div class="ph"><h3>Histórico de importações</h3></div><div class="pb" style="padding:0">
      <table><thead><tr><th>Quando</th><th>Arquivo</th><th>Linhas</th><th>Período</th></tr></thead>
      <tbody>${imports.map(i=>`<tr><td>${new Date(i.imported_at).toLocaleString('pt-BR')}</td><td>${esc(i.file_name||'—')}</td><td>${i.row_count}</td><td class="muted">${i.period_start||'—'} a ${i.period_end||'—'}</td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:16px">Nenhuma importação ainda.</td></tr>'}
      </tbody></table></div></div>
  </div>`;
  let parsed=[];
  $('#imp_file')?.addEventListener('change',async(ev)=>{
    const f=ev.target.files[0]; if(!f)return;
    const buf=await f.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    const norm=(k)=>k.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
    parsed=rows.map(r=>{const o={};for(const k in r)o[norm(k)]=r[k];
      return {name:(o.nome||o.funcionaria||o.colaborador||'').toString().trim(),
        balance:+`${o.saldo||o.bancodehoras||o.banco||0}`.replace(',','.')||0,
        positive:+`${o.horaspositivas||o.positivas||0}`.replace(',','.')||0,
        negative:+`${o.horasnegativas||o.negativas||0}`.replace(',','.')||0,
        absences:+o.faltas||0,lates:+o.atrasos||0,early:+o.saidasantecipadas||o.saidas||0,missing:+o.batidasfaltantes||o.batidas||0};
    }).filter(r=>r.name);
    const emps=await getAll('employees',b=>b.eq('is_simulation',false));
    const names=emps.map(e=>e.name.toLowerCase());
    const preview=parsed.map(p=>{const match=names.includes(p.name.toLowerCase());
      return `<tr><td>${match?'✅':'⚠️'} ${esc(p.name)}</td><td>${p.balance}h</td><td>${p.positive}/${p.negative}</td><td>${p.absences}/${p.lates}/${p.early}/${p.missing}</td></tr>`;}).join('');
    const unmatched=parsed.filter(p=>!names.includes(p.name.toLowerCase()));
    $('#impPreview').innerHTML=`<div class="section">
      ${unmatched.length?alert('warn',`${unmatched.length} nome(s) não batem com o cadastro: ${unmatched.map(u=>esc(u.name)).join(', ')}. Serão importados, mas sem vincular ao saldo da funcionária.`):alert('ok','Todos os nomes foram reconhecidos.')}
      <table><thead><tr><th>Funcionária</th><th>Saldo</th><th>+/−</th><th>Faltas/Atr/Saí/Bat</th></tr></thead><tbody>${preview}</tbody></table>
      <div class="toolbar" style="margin-top:12px"><button class="btn" id="confirmImp">Confirmar importação de ${parsed.length} linha(s)</button></div></div>`;
    $('#confirmImp').onclick=async()=>{ if(!gate())return;
      const imp=await T('time_bank_imports').insert({source:'planilha',file_name:f.name,period_start:$('#imp_from').value||null,period_end:$('#imp_to').value||null,row_count:parsed.length,imported_by:S.user.id}).select().single();
      if(imp.error){toast(imp.error.message);return;}
      const rowsToSave=parsed.map(p=>{const e=emps.find(x=>x.name.toLowerCase()===p.name.toLowerCase());
        return {import_id:imp.data.id,employee_id:e?e.id:null,employee_name:p.name,balance_hours:p.balance,positive_hours:p.positive,negative_hours:p.negative,absences:p.absences,lates:p.lates,early_leaves:p.early,missing_punches:p.missing,period_start:$('#imp_from').value||null,period_end:$('#imp_to').value||null};});
      await T('time_bank_balances').insert(rowsToSave);
      // atualiza saldo das funcionárias reconhecidas
      for(const p of parsed){const e=emps.find(x=>x.name.toLowerCase()===p.name.toLowerCase());
        if(e) await T('employees').update({time_bank_balance:p.balance,updated_at:new Date().toISOString()}).eq('id',e.id);}
      toast('Importação concluída e saldos atualizados.'); route();
    };
  });
};

// ---------- FÉRIAS ----------
ROUTES.ferias=async function(){
  const [emps,vacs]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),getAll('vacation_periods',b=>b.order('start_date',{ascending:false}))]);
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addVac" ${isGestor()?'':'disabled'}>+ Cadastrar férias</button></div>
  ${alert('info','Funcionárias em férias não recebem folga, não entram no rodízio de sábados nem em trocas — e o sistema reduz automaticamente o tamanho das folgas das demais.')}
  <div class="panel"><div class="pb" style="padding:0"><table>
    <thead><tr><th>Funcionária</th><th>Início</th><th>Fim</th><th>Observações</th><th></th></tr></thead>
    <tbody>${vacs.map(v=>`<tr><td><b>${esc(map[v.employee_id]||'—')}</b></td><td>${v.start_date}</td><td>${v.end_date}</td><td class="muted">${esc(v.notes||'')}</td>
      <td>${isGestor()?`<button class="btn ghost sm" style="color:var(--red)" data-delv="${v.id}">remover</button>`:''}</td></tr>`).join('')||'<tr><td colspan=5 class="muted" style="padding:16px">Nenhum período cadastrado.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addVac')?.addEventListener('click',()=>{
    openModal('Cadastrar férias',`
      <div class="field"><label>Funcionária</label><select id="v_emp">${emps.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label>Início</label><input id="v_start" type="date" value="${todayStr()}"/></div>
        <div class="field"><label>Fim</label><input id="v_end" type="date" value="${todayStr()}"/></div></div>
      <div class="field"><label>Observações</label><input id="v_notes"/></div>`,
      async()=>{ if(!gate())return false; const emp=$('#v_emp').value;
        const res=await T('vacation_periods').insert({employee_id:emp,start_date:$('#v_start').value,end_date:$('#v_end').value,notes:$('#v_notes').value});
        if(res.error){toast(res.error.message);return false;}
        await T('employees').update({status:'ferias'}).eq('id',emp);
        toast('Férias cadastradas. Status atualizado.'); route(); return true; });
  });
  $$('[data-delv]').forEach(b=>b.onclick=async()=>{ if(!gate())return; await T('vacation_periods').delete().eq('id',b.dataset.delv); route(); });
};

// ---------- MOTOR DE FOLGAS ----------
ROUTES.folgas=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1;
  const [emps,rules,vacs,reqs,blk]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('vacation_periods'), getAll('dayoff_requests'), getAll('blocked_dates')]);
  const refusals=reqs.filter(r=>r.request_type==='recusa_folga');
  $('#view').innerHTML=`
  <div class="toolbar">
    <button class="btn" id="gen" ${isGestor()?'':'disabled'}>⚡ Gerar sugestões (14 dias)</button>
    <button class="btn sec" id="regen">↻ Recalcular</button>
    <div class="spacer"></div><span class="muted" id="capInfo"></span>
  </div>
  <div id="folgaOut"><p class="muted">O sistema sugere — você aprova. Clique em “Gerar sugestões”.</p></div>`;
  async function run(){
    const out=Engine.suggestDayOffs({employees:emps,rules,vacations:vacs,requests:reqs,refusals,blockedDates:blk,year,month,horizonDays:14,startDate:todayStr(),history:{}});
    $('#capInfo').textContent=`Capacidade: ${out.capacity.level.replace('_',' ')} · folga máx ${out.capacity.maxHours}h`;
    const sugRows=out.suggestions.map((s,i)=>`<tr>
      <td><b>${esc(s.employee_name)}</b></td><td>${Engine.DOW[Engine.parse(s.date).getDay()]} ${s.date}</td>
      <td>${SHIFT_LABEL[s.shift]||s.shift}</td><td>${TYPE_LABEL[s.type]}</td><td>${s.hours}h</td>
      <td class="row-actions">${isGestor()?`<button class="btn sm" data-ap="${i}">Aprovar</button><button class="btn sec sm" data-rf="${i}">Recusar</button>`:'<span class="muted">—</span>'}</td>
    </tr><tr><td colspan="6"><div class="reason">${esc(s.reason)}</div></td></tr>`).join('');
    const logRows=out.logs.map(l=>`<div class="reason" style="border-left-color:${l.type==='bloqueio'?'var(--red)':l.type==='rodizio'?'var(--purple)':'var(--brand)'}">${l.type==='bloqueio'?'🚫':l.type==='rodizio'?'🔁':'✅'} ${esc(l.message)}</div>`).join('');
    $('#folgaOut').innerHTML=`
      ${out.suggestions.length?'':alert('warn','Nenhuma folga sugerida — verifique banco de horas mínimo, cobertura ou capacidade operacional (veja o log abaixo).')}
      <div class="panel"><div class="ph"><h3>Sugestões de folga</h3><span class="muted">${out.suggestions.length} sugestão(ões)</span></div>
        <div class="pb" style="padding:0"><table><thead><tr><th>Funcionária</th><th>Dia</th><th>Turno</th><th>Tipo</th><th>Horas</th><th>Ação</th></tr></thead><tbody>${sugRows||'<tr><td colspan=6 class="muted" style="padding:16px">Sem sugestões.</td></tr>'}</tbody></table></div></div>
      <div class="section panel"><div class="ph"><h3>🧠 Log de decisão</h3><span class="muted">por que cada decisão foi tomada</span></div><div class="pb">${logRows||'<span class="muted">Sem registros.</span>'}</div></div>`;
    $$('[data-ap]').forEach(b=>b.onclick=async()=>{ if(!gate())return; const s=out.suggestions[+b.dataset.ap];
      await saveApproval(s,year,month,'aprovado'); toast('Folga aprovada e registrada.'); });
    $$('[data-rf]').forEach(b=>b.onclick=async()=>{ if(!gate())return; const s=out.suggestions[+b.dataset.rf];
      const motivo=prompt('Motivo da recusa (registrado no histórico):','')||'';
      await T('dayoff_requests').insert({employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,shift:s.shift,type:s.type,request_type:'recusa_folga',reason:motivo,status:'recusado'});
      toast('Recusa registrada. Recalcule para nova sugestão.'); });
  }
  async function saveApproval(s,y,m,status){
    let sched=(await T('schedules').select('*').eq('is_simulation',S.sim).eq('year',y).eq('month',m).order('created_at',{ascending:false}).limit(1).maybeSingle()).data;
    if(!sched){ sched=(await T('schedules').insert({year:y,month:m,status:'sugerida',is_simulation:S.sim,created_by:S.user.id}).select().single()).data; }
    await T('schedule_items').insert({schedule_id:sched.id,employee_id:s.employee_id,employee_name:s.employee_name,date:s.date,shift:s.shift,type:s.type,hours:s.hours,status,reason:s.reason});
    await T('decision_logs').insert({schedule_id:sched.id,employee_id:s.employee_id,employee_name:s.employee_name,decision_type:'sugestao',message:s.reason,is_simulation:S.sim});
  }
  $('#gen')?.addEventListener('click',run); $('#regen').onclick=run;
};

// ---------- SÁBADOS ----------
ROUTES.sabados=async function(){
  const now=new Date(), year=now.getFullYear(), month=now.getMonth()+1;
  const [emps,rules,rot]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim)),
    T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),
    getAll('saturday_rotation',b=>b.order('saturday_date',{ascending:false}).limit(12))]);
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="genSat" ${isGestor()?'':'disabled'}>⚡ Gerar rodízio de ${MONTHS[month-1]}</button>
    <div class="spacer"></div><span class="muted">2 primeiros sábados · ${rules.saturday_start||'14:00'}–${rules.saturday_end||'17:00'}</span></div>
  <div id="satOut"></div>
  <div class="section panel"><div class="ph"><h3>Histórico de sábados</h3></div><div class="pb" style="padding:0">
    <table><thead><tr><th>Data</th><th>Sábado</th><th>Funcionária</th><th>Status</th></tr></thead>
    <tbody>${rot.map(r=>`<tr><td>${r.saturday_date||'—'}</td><td>${r.saturday_number}º</td><td><b>${esc(r.employee_name||'')}</b></td><td><span class="pill ativa">${r.status}</span></td></tr>`).join('')||'<tr><td colspan=4 class="muted" style="padding:16px">Sem histórico.</td></tr>'}
    </tbody></table></div></div>`;
  $('#genSat')?.addEventListener('click',async()=>{
    const out=Engine.saturdayRotation(emps,rules,year,month,{});
    const rows=out.assignments.map(a=>`<tr><td><b>${a.saturday_number}º sábado</b></td><td>${a.saturday_date}</td><td>${esc(a.employee_name)}</td></tr>`).join('');
    const logs=out.logs.map(l=>`<div class="reason" style="border-left-color:var(--purple)">🔁 ${esc(l.message)}</div>`).join('');
    $('#satOut').innerHTML=`<div class="panel"><div class="ph"><h3>Escala dos sábados — ${MONTHS[month-1]} ${year}</h3>
      ${isGestor()?`<button class="btn sm" id="saveSat">Salvar rodízio</button>`:''}</div>
      <div class="pb"><table><thead><tr><th>Sábado</th><th>Data</th><th>Escalada</th></tr></thead><tbody>${rows||'<tr><td colspan=3 class="muted">Sem sábados elegíveis.</td></tr>'}</tbody></table>
      <div class="section">${logs}</div></div></div>`;
    $('#saveSat')?.addEventListener('click',async()=>{ if(!gate())return;
      const payload=out.assignments.map(a=>({month,year,saturday_number:a.saturday_number,saturday_date:a.saturday_date,employee_id:a.employee_id,employee_name:a.employee_name,worked:true,status:'aprovado',reason:'Rodízio automático'}));
      const res=await T('saturday_rotation').insert(payload); if(res.error){toast(res.error.message);return;}
      toast('Rodízio salvo.'); route(); });
  });
};

// ---------- CALENDÁRIO ----------
ROUTES.calendario=async function(){
  const now=new Date(); let year=now.getFullYear(), month=now.getMonth()+1;
  async function draw(){
    const first=new Date(year,month-1,1), startDow=first.getDay(), dim=Engine.daysInMonth(year,month);
    const [items,vacs,rules,blk]=await Promise.all([
      getAll('schedule_items',b=>b.gte('date',`${year}-${String(month).padStart(2,'0')}-01`).lte('date',`${year}-${String(month).padStart(2,'0')}-${dim}`)),
      getAll('vacation_periods'),T('store_rules').select('*').eq('id',1).maybeSingle().then(r=>r.data||{}),getAll('blocked_dates')]);
    const sats=Engine.saturdaysOfMonth(year,month).slice(0,rules.saturday_open_count||2).map(Engine.fmt);
    let cells='';
    for(let i=0;i<startDow;i++) cells+=`<div class="day out"></div>`;
    for(let d=1;d<=dim;d++){
      const ds=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`; const dow=new Date(year,month-1,d).getDay();
      let ev='';
      items.filter(x=>x.date===ds).forEach(x=>ev+=`<span class="ev ${x.status==='aprovado'?'folga':'sug'}">${x.status==='aprovado'?'✓':'•'} ${esc((x.employee_name||'').split(' ')[0])}</span>`);
      vacs.filter(v=>ds>=v.start_date&&ds<=v.end_date).forEach(()=>ev+=`<span class="ev fer">férias</span>`);
      if(sats.includes(ds)) ev+=`<span class="ev sab">sábado</span>`;
      if(blk.some(b=>b.date===ds)) ev+=`<span class="ev blk">bloqueio</span>`;
      cells+=`<div class="day ${dow===6?'sat':''}"><span class="dn">${d}</span>${ev}</div>`;
    }
    $('#view').innerHTML=`
    <div class="toolbar"><button class="btn sec sm" id="prev">←</button>
      <b style="min-width:170px;text-align:center">${MONTHS[month-1]} ${year}</b>
      <button class="btn sec sm" id="next">→</button><div class="spacer"></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Aprovada</span><span><i class="dot" style="background:var(--brand)"></i>Sugerida</span><span><i class="dot" style="background:var(--amber)"></i>Férias</span><span><i class="dot" style="background:var(--purple)"></i>Sábado</span><span><i class="dot" style="background:var(--red)"></i>Bloqueio</span></div></div>
    <div class="panel"><div class="pb">
      <div class="cal">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<div class="dow">${d}</div>`).join('')}${cells}</div>
    </div></div>`;
    $('#prev').onclick=()=>{month--;if(month<1){month=12;year--;}draw();};
    $('#next').onclick=()=>{month++;if(month>12){month=1;year++;}draw();};
  }
  draw();
};

// ---------- PEDIDOS & EXCEÇÕES ----------
ROUTES.pedidos=async function(){
  const [emps,reqs]=await Promise.all([getAll('employees',b=>b.eq('is_simulation',S.sim).order('name')),getAll('dayoff_requests',b=>b.order('created_at',{ascending:false}).limit(50))]);
  const map=Object.fromEntries(emps.map(e=>[e.id,e.name]));
  $('#view').innerHTML=`
  <div class="toolbar"><button class="btn" id="addReq" ${isGestor()?'':'disabled'}>+ Registrar pedido / exceção</button></div>
  <div class="panel"><div class="pb" style="padding:0"><table>
    <thead><tr><th>Funcionária</th><th>Data</th><th>Tipo</th><th>Motivo</th><th>Status</th><th></th></tr></thead>
    <tbody>${reqs.map(r=>`<tr><td><b>${esc(r.employee_name||map[r.employee_id]||'—')}</b></td><td>${r.date||'—'}</td>
      <td>${reqTypeLabel(r.request_type)}</td><td class="muted">${esc(r.reason||'')}</td>
      <td><span class="pill ${r.status==='aprovado'?'ativa':r.status==='recusado'?'afastada':'ferias'}">${r.status}</span></td>
      <td class="row-actions">${isGestor()&&r.status==='pendente'?`<button class="btn sm" data-ap="${r.id}">Aprovar</button><button class="btn sec sm" data-rf="${r.id}">Recusar</button>`:''}</td>
    </tr>`).join('')||'<tr><td colspan=6 class="muted" style="padding:16px">Nenhum pedido registrado.</td></tr>'}
    </tbody></table></div></div>`;
  $('#addReq')?.addEventListener('click',()=>{
    openModal('Registrar pedido / exceção',`
      <div class="field"><label>Funcionária</label><select id="q_emp">${emps.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label>Data</label><input id="q_date" type="date" value="${todayStr()}"/></div>
        <div class="field"><label>Tipo</label><select id="q_type">
          <option value="pedido_folga">Pedido de folga</option><option value="troca_folga">Troca de folga</option>
          <option value="falta">Falta</option><option value="atestado">Atestado</option>
          <option value="saida_antecipada">Saída antecipada</option><option value="atraso">Atraso</option></select></div></div>
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
  const [emps,items,reqs,rot,vacs]=await Promise.all([
    getAll('employees',b=>b.eq('is_simulation',S.sim)),getAll('schedule_items'),
    getAll('dayoff_requests'),getAll('saturday_rotation'),getAll('vacation_periods')]);
  const fair=Engine.fairnessIndex(emps,{});
  const ballColor={justo:'var(--green)',aceitavel:'var(--brand)',atencao:'var(--amber)',desequilibrado:'var(--red)'}[fair.status];
  const perEmp=emps.map(e=>{
    const folgas=items.filter(i=>i.employee_id===e.id&&i.status==='aprovado').length;
    const sabados=rot.filter(r=>r.employee_id===e.id).length;
    const faltas=reqs.filter(r=>r.employee_id===e.id&&r.request_type==='falta').length;
    const recusas=reqs.filter(r=>r.employee_id===e.id&&r.request_type==='recusa_folga').length;
    return {e,folgas,sabados,faltas,recusas};
  });
  $('#view').innerHTML=`
  <div class="cards">
    <div class="card"><h3>Índice de justiça</h3><div class="fair" style="font-size:20px"><span class="ball" style="background:${ballColor}"></span>${fair.status} · ${fair.score}</div><div class="reason">${esc(fair.reason)}</div></div>
    <div class="card"><h3>Folgas aprovadas no período</h3><div class="kpi">${items.filter(i=>i.status==='aprovado').length}</div></div>
    <div class="card"><h3>Sábados trabalhados</h3><div class="kpi">${rot.length}</div></div>
    <div class="card"><h3>Funcionárias em férias</h3><div class="kpi">${emps.filter(e=>e.status==='ferias').length}</div></div>
  </div>
  <div class="section panel"><div class="ph"><h3>Resumo por funcionária — ${MONTHS[month-1]} ${year}</h3></div><div class="pb" style="padding:0">
    <table><thead><tr><th>Funcionária</th><th>Banco atual</th><th>Folgas</th><th>Sábados</th><th>Faltas</th><th>Recusas</th></tr></thead>
    <tbody>${perEmp.map(p=>`<tr><td><b>${esc(p.e.name)}</b></td><td>${(+p.e.time_bank_balance||0).toFixed(0)}h</td><td>${p.folgas}</td><td>${p.sabados}</td><td>${p.faltas}</td><td>${p.recusas}</td></tr>`).join('')||'<tr><td colspan=6 class="muted" style="padding:16px">Sem dados.</td></tr>'}
    </tbody></table></div></div>`;
};

// ---------- SIMULAÇÃO ----------
ROUTES.simulacao=async function(){
  $('#view').innerHTML=`
  ${alert('info','<b>Modo simulação.</b> Crie funcionárias fictícias (Ana, Bruna, Carla, Daniela, Elisa, Fernanda) e teste cenários sem tocar nos dados reais. Ative o botão “Simulação” no topo para navegar pelo sistema com esses dados.')}
  <div class="toolbar">
    <button class="btn" id="seedSim" ${isGestor()?'':'disabled'}>🌱 Criar/Resetar funcionárias fictícias</button>
    <button class="btn sec" id="clearSim" ${isGestor()?'':'disabled'}>🗑️ Limpar dados de simulação</button>
  </div>
  <div class="section panel"><div class="ph"><h3>Cenários prontos</h3></div><div class="pb">
    <div class="cards">${Engine.SCENARIOS.map((s,i)=>`<div class="card"><h3>${esc(s.name)}</h3>
      <button class="btn sm" data-scn="${i}" style="margin-top:6px" ${isGestor()?'':'disabled'}>Aplicar cenário</button></div>`).join('')}</div>
    <div id="scnOut" class="section"></div>
  </div></div>`;
  $('#seedSim')?.addEventListener('click',async()=>{ if(!gate())return;
    await T('employees').delete().eq('is_simulation',true);
    const rows=Engine.simEmployees().map(e=>({...e,is_simulation:true}));
    const res=await T('employees').insert(rows); if(res.error){toast(res.error.message);return;}
    toast('6 funcionárias fictícias criadas. Ative o modo Simulação no topo.'); S.sim=true; renderSimToggle(); });
  $('#clearSim')?.addEventListener('click',async()=>{ if(!gate())return; if(!confirm('Apagar todos os dados de simulação?'))return;
    await T('employees').delete().eq('is_simulation',true);
    await T('schedules').delete().eq('is_simulation',true);
    toast('Dados de simulação removidos.'); });
  $$('[data-scn]').forEach(b=>b.onclick=async()=>{
    const scn=Engine.SCENARIOS[+b.dataset.scn];
    let emps=await getAll('employees',b=>b.eq('is_simulation',true));
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
      <div class="section"><b>🧠 Log de decisão</b>${out.logs.map(l=>`<div class="reason" style="border-left-color:${l.type==='bloqueio'?'var(--red)':'var(--brand)'}">${l.type==='bloqueio'?'🚫':'✅'} ${esc(l.message)}</div>`).join('')}</div>
      </div></div>`;
  });
};

// ---------- Modal helper ----------
function openModal(title,body,onSave){
  const root=$('#modalRoot');
  root.innerHTML=`<div class="modal-bg"><div class="modal">
    <div class="mh"><h3>${esc(title)}</h3><button class="x" id="mClose">×</button></div>
    <div class="mb">${body}</div>
    <div class="mf"><button class="btn sec" id="mCancel">Cancelar</button><button class="btn" id="mSave">Salvar</button></div>
  </div></div>`;
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
if(sb) boot(); else { $('#login').style.display='flex'; $('#loginErr').innerHTML=alert('err','config.js não configurado. Preencha SUPABASE_URL e SUPABASE_ANON_KEY.'); }
})();
