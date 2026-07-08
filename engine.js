// ============================================================
// MOTOR DE DECISÃO — Sistema de Escalas Ótica Carina
// Funções puras (sem banco). Recebem dados, devolvem sugestões + logs.
// Toda decisão é explicada (log de decisão) e mensurada (índice de justiça).
// ============================================================
window.Engine = (function () {

  const DOW = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
  const fmt = (d) => d.toISOString().slice(0,10);
  const parse = (s) => { const [y,m,dd]=s.split("-").map(Number); return new Date(y,m-1,dd); };

  // ---- utilidades de calendário ----
  function saturdaysOfMonth(year, month /*1-12*/) {
    const out=[]; const d=new Date(year, month-1, 1);
    while (d.getMonth()===month-1){ if(d.getDay()===6) out.push(new Date(d)); d.setDate(d.getDate()+1); }
    return out;
  }
  // sábados que abrem no mês conforme o modo escolhido
  function openSaturdays(year, month, mode){
    const all = saturdaysOfMonth(year, month);
    if (mode==='todos') return all.slice();
    if (mode==='primeiro_ultimo') return all.length<=1 ? all.slice() : [all[0], all[all.length-1]];
    return all.slice(0,2); // dois_primeiros (padrão)
  }
  function daysInMonth(year, month){ return new Date(year, month, 0).getDate(); }
  function nthWeekdayOfMonth(year, month, weekday, n){ // month 1-12
    const d=new Date(year, month-1, 1); let c=0;
    while(d.getMonth()===month-1){ if(d.getDay()===weekday){ c++; if(c===n) return new Date(d); } d.setDate(d.getDate()+1); }
    return null;
  }
  function lastWeekdayOfMonth(year, month, weekday){
    const d=new Date(year, month, 0);
    while(d.getDay()!==weekday) d.setDate(d.getDate()-1);
    return new Date(d);
  }
  // Datas comemorativas de alto movimento (relevantes p/ varejo de ótica)
  function commemorativeDates(year){
    const out=[];
    const maes=nthWeekdayOfMonth(year,5,0,2); if(maes) out.push({date:fmt(maes), name:'Dia das Mães'});
    out.push({date:fmt(new Date(year,5,12)), name:'Dia dos Namorados'});
    const pais=nthWeekdayOfMonth(year,8,0,2); if(pais) out.push({date:fmt(pais), name:'Dia dos Pais'});
    out.push({date:fmt(new Date(year,9,12)), name:'Dia das Crianças'});
    const bf=lastWeekdayOfMonth(year,11,5); if(bf) out.push({date:fmt(bf), name:'Black Friday'});
    out.push({date:fmt(new Date(year,11,25)), name:'Natal'});
    return out.sort((a,b)=>a.date<b.date?-1:1);
  }
  // se a data está na própria data comemorativa ou na semana que a antecede, devolve o nome
  function commemorativeBlock(dStr, leadDays, allowed){
    const y=+dStr.slice(0,4);
    const dates=[...commemorativeDates(y), ...commemorativeDates(y+1)];
    const target=parse(dStr);
    for(const c of dates){
      if(allowed && allowed.has && allowed.has(c.date)) continue; // semana liberada nas Configurações
      const diff=Math.round((parse(c.date)-target)/86400000);
      if(diff>=0 && diff<=leadDays) return c.name; // alvo é a data ou até leadDays antes
    }
    return null;
  }

  // ---- Capacidade Operacional ----
  // Quantas pessoas em férias/afastadas reduzem o tamanho das folgas liberadas.
  function operationalCapacity(employees, rules) {
    const active = employees.filter(e => e.status==='ativa');
    const away   = employees.filter(e => ['ferias','licenca','afastada'].includes(e.status));
    const min    = rules.min_per_shift || 4;
    let level, maxHours, note;
    const availableForShift = active.length;
    if (away.length===0 && availableForShift > min){ level='completa'; maxHours=rules.max_dayoff_hours||8;
      note='Equipe completa: pode liberar turno inteiro ou dia inteiro.'; }
    else if (away.length===1){ level='reduzida_1'; maxHours=Math.min(4, rules.max_dayoff_hours||8);
      note='1 pessoa ausente: priorizar meio turno ou poucas horas.'; }
    else if (away.length===2){ level='reduzida_2'; maxHours=Math.min(3, rules.max_dayoff_hours||8);
      note='2 pessoas ausentes: bloquear folgas longas.'; }
    else if (availableForShift <= min){ level='critica'; maxHours=0;
      note='Equipe no limite/abaixo do mínimo: folgas exigem aprovação manual.'; }
    else { level='reduzida_2'; maxHours=Math.min(3, rules.max_dayoff_hours||8);
      note='Várias ausências: folgas reduzidas.'; }
    return { level, maxHours, availableForShift, awayCount: away.length, minPerShift: min, note };
  }

  // ---- Índice de Justiça ----
  // Avalia o equilíbrio entre funcionárias com base em histórico.
  function fairnessIndex(employees, history) {
    // history: {employeeId:{dayoffs, saturdays, mondaysOff, fridaysOff, lastDayOffDays, compensated}}
    const active = employees.filter(e=>e.status==='ativa');
    if (active.length===0) return { status:'aceitavel', score:100, reason:'Sem funcionárias ativas.', rows:[] };
    const vals = active.map(e=>{
      const h = history[e.id]||{};
      return { id:e.id, name:e.name, dayoffs:h.dayoffs||0, saturdays:h.saturdays||0,
               fridaysOff:h.fridaysOff||0, integral:h.integral||0,
               lastDayOffDays:(h.lastDayOffDays==null?60:h.lastDayOffDays), bank:e.time_bank_balance||0 };
    });
    const spread = (arr)=>{ if(!arr.length) return 0; const mx=Math.max(...arr),mn=Math.min(...arr); return mx-mn; };
    const dSpread = spread(vals.map(v=>v.dayoffs));
    const sSpread = spread(vals.map(v=>v.saturdays));
    const fSpread = spread(vals.map(v=>v.fridaysOff));   // dispersão de sextas folgadas
    const iSpread = spread(vals.map(v=>v.integral));      // dispersão de folgas de dia inteiro
    const bSpread = spread(vals.map(v=>v.bank));
    // pontuação: começa 100, penaliza dispersões (inclui folgas "boas": sextas e dia inteiro)
    let score = 100 - dSpread*7 - sSpread*9 - fSpread*6 - iSpread*6 - Math.min(40, bSpread*1.5);
    score = Math.max(0, Math.round(score));
    let status, reason;
    if (score>=85){ status='justo'; reason='Folgas, sábados e banco de horas estão bem equilibrados.'; }
    else if (score>=70){ status='aceitavel'; reason='Pequenas diferenças entre as funcionárias, dentro do tolerável.'; }
    else if (score>=50){ status='atencao'; reason='Diferenças relevantes — vale priorizar quem está atrás.'; }
    else { status='desequilibrado'; reason='Distribuição desigual de folgas/sábados/banco entre a equipe.'; }
    // motivos detalhados
    if (dSpread>=3) reason += ` Diferença de ${dSpread} folgas entre quem mais e menos folgou.`;
    if (sSpread>=2) reason += ` Diferença de ${sSpread} sábados trabalhados.`;
    if (fSpread>=2) reason += ` Diferença de ${fSpread} sextas folgadas.`;
    return { status, score, reason, rows:vals.sort((a,b)=>b.bank-a.bank) };
  }

  // ---- Rodízio de Sábados ----
  // 1º sábado costuma ter MAIS gente (pós-pagamento, mais movimento): padrão 3.
  // 2º sábado: padrão 2. Quem trabalha no 1º não trabalha no 2º (revezamento).
  // Exceção: se uma data comemorativa cai perto do 2º sábado, inverte (3 no 2º, 2 no 1º).
  function saturdayRotation(employees, rules, year, month, history) {
    const sats = openSaturdays(year, month, rules.saturday_open_mode);
    const eligible = employees.filter(e => e.status==='ativa');
    const logs=[]; const assignments=[];
    const hhmm=`${rules.saturday_start||'14:00'}–${rules.saturday_end||'17:00'}`;
    if (eligible.length===0){
      logs.push({type:'rodizio', message:'Nenhuma funcionária ativa para o rodízio de sábados.'});
      return { saturdays: sats.map(fmt), assignments, logs };
    }
    let firstCount = rules.saturday_first_count ?? 3;
    let secondCount = rules.saturday_second_count ?? 2;
    // reforço escolhido na tela de sábados: 'auto' | 'primeiro' | 'segundo'
    const reinforce = rules.saturday_reinforce || 'auto';
    const big = Math.max(firstCount, secondCount), small = Math.min(firstCount, secondCount);

    let inverted=false, commName=null;
    if (reinforce==='primeiro'){ firstCount=big; secondCount=small; }       // gestor: mais no 1º
    else if (reinforce==='segundo'){ firstCount=small; secondCount=big; }   // gestor: mais no 2º (vice-versa)
    else if (sats.length>=2){
      // automático: comemorativa perto do 2º sábado -> inverte o reforço
      const sat2=sats[1];
      for (const c of commemorativeDates(year)){
        if (Math.abs(Math.round((parse(c.date)-sat2)/86400000))<=3){ inverted=true; commName=c.name; break; }
      }
      if (inverted){ const t=firstCount; firstCount=secondCount; secondCount=t; }
    }
    // 1º sábado = firstCount; demais = secondCount (vale p/ 2, primeiro+último ou todos)
    const counts = sats.map((_,i)=> i===0 ? firstCount : secondCount);

    // ordena por menos sábados no histórico (quem deve mais trabalha primeiro)
    const ranked = [...eligible].sort((a,b)=>{
      const ha=(history[a.id]?.saturdays)||0, hb=(history[b.id]?.saturdays)||0;
      if(ha!==hb) return ha-hb;
      return (b.manual_priority||0)-(a.manual_priority||0);
    });

    const isExp = e => !!e.is_expert; // especialista em atendimento de ótica
    const experts = ranked.filter(isExp);
    const usedAny = new Set();          // evita repetir a mesma pessoa em sábados diferentes do mês
    const monthCount = {};              // quantos sábados deste mês a pessoa já pegou (p/ espalhar as especialistas)
    const expLoad = e => (history[e.id]?.saturdays||0) + (monthCount[e.id]||0);
    const picks = sats.map(()=>[]);     // pessoas escolhidas por sábado

    // FASE 1 — garante ao menos 1 ESPECIALISTA em CADA sábado (espalha pelo histórico; só repete a mesma se faltar especialista)
    sats.forEach((satDate, idx)=>{
      if ((counts[idx]||0) < 1 || experts.length===0) return;
      let cand = experts.filter(e=>!usedAny.has(e.id));
      if (!cand.length) cand = experts.slice();   // acabaram as especialistas → reusa p/ nenhum sábado ficar sem
      cand.sort((a,b)=> expLoad(a)-expLoad(b) || (b.manual_priority||0)-(a.manual_priority||0));
      const exp = cand[0];
      picks[idx].push(exp); usedAny.add(exp.id); monthCount[exp.id]=(monthCount[exp.id]||0)+1;
    });

    // FASE 2 — completa as vagas (justiça + ao menos 1 que sabe menos quando há 2+ vagas)
    sats.forEach((satDate, idx)=>{
      const need=counts[idx]||0; const pick=picks[idx];
      const has=id=>pick.some(e=>e.id===id);
      // ao menos 1 que SABE MENOS, se ainda não houver e sobra vaga
      if (need>=2 && pick.length<need && !pick.some(e=>!isExp(e))){
        const nx = ranked.find(e=>!isExp(e) && !usedAny.has(e.id) && !has(e.id));
        if (nx){ pick.push(nx); usedAny.add(nx.id); }
      }
      // completa pelo ranking de justiça, sem repetir entre sábados
      for (const e of ranked){ if(pick.length>=need) break; if(has(e.id)||usedAny.has(e.id)) continue; pick.push(e); usedAny.add(e.id); }
      // se ainda faltou gente sem repetir → permite repetir entre sábados
      for (const e of ranked){ if(pick.length>=need) break; if(has(e.id)) continue; pick.push(e); }
      picks[idx]=pick.slice(0,need);
    });

    // registra atribuições + monta os logs
    sats.forEach((satDate, idx)=>{
      const need=counts[idx]||0; const finalPick=picks[idx];
      finalPick.forEach(e=>{
        assignments.push({ saturday_number: idx+1, saturday_date: fmt(satDate), employee_id:e.id, employee_name:e.name });
      });
      const nomes = finalPick.map(e=>e.name).join(', ') || '—';
      let nota = '';
      if (idx===0) nota = inverted ? ` Reduzido para ${need} (reforço foi para o 2º por causa de ${commName}).` : ' (1º sábado: mais movimento, pós-pagamento.)';
      else nota = inverted ? ` Reforço para ${need} por causa de ${commName}.` : '';
      let alerta='';
      if (!finalPick.some(isExp)) alerta=' ⚠️ Nenhuma especialista cadastrada — marque quem tem mais conhecimento em Funcionárias.';
      else if (need>=2 && !finalPick.some(e=>!isExp(e))) alerta=' (Ninguém do grupo que sabe menos disponível neste sábado.)';
      logs.push({type:'rodizio',
        message:`${idx+1}º sábado (${fmt(satDate)}, ${hhmm}): ${need} pessoa(s) — ${nomes}.${nota}${alerta}`});
    });
    return { saturdays: sats.map(fmt), assignments, logs, counts, inverted, commName };
  }

  // ---- Motor de Sugestão de Folgas ----
  // Gera sugestões para os próximos dias úteis com base em banco de horas,
  // tempo sem folgar, cobertura mínima, férias, pedidos e recusas.
  function suggestDayOffs(opts) {
    const { employees, rules, vacations, requests=[], refusals=[], history={},
            blockedDates=[], horizonDays=14, startDate, existing=[], weekdays } = opts;
    // dias da semana onde o motor PODE distribuir folga (1=seg … 5=sex). Padrão: seg a sex.
    const allowDow = (Array.isArray(weekdays) && weekdays.length) ? weekdays.map(Number) : [1,2,3,4,5];
    const cap = operationalCapacity(employees, rules);
    const logs=[]; const suggestions=[];
    const minBank = rules.min_time_bank_for_dayoff ?? 6;
    const minPer  = rules.min_per_shift || 4;
    const maxPerDay = Math.max(1, rules.max_dayoffs_per_day ?? 2); // teto de folgas no mesmo dia
    const active  = employees.filter(e=>e.status==='ativa');
    const expertIds = new Set(active.filter(e=>e.is_expert).map(e=>e.id)); // funções essenciais (mais experientes)
    const requireExpert = rules.require_expert!==false; // sempre manter ao menos 1 especialista presente no dia
    const onVac = (e, dStr) => vacations.some(v => v.employee_id===e.id && dStr>=v.start_date && dStr<=v.end_date);
    const blocked = (dStr) => blockedDates.some(b=>b.date===dStr);
    const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
    const fmtHoras = (v)=>{ v=+v||0; const neg=v<0; let m=Math.round(Math.abs(v)*60); const h=Math.floor(m/60); m=m%60; return (neg?'-':'')+h+'h'+(m?String(m).padStart(2,'0')+'min':''); };
    const todayISO = fmt(new Date());

    // limiares de banco alto (configuráveis em Regras): atenção / alta / máxima / crítico
    const tAt=rules.bank_alert_atencao??8, tAlta=rules.bank_alert_alta??12, tMax=rules.bank_alert_maxima??16, tCrit=rules.bank_alert_critico??20;
    const bankUrgency=(bank)=> bank>=tCrit?60 : bank>=tMax?40 : bank>=tAlta?25 : bank>=tAt?12 : 0;
    const scoreOf = (e)=>{
      const h=history[e.id]||{};
      const bank=e.time_bank_balance||0;
      const since=(h.lastDayOffDays==null?45:h.lastDayOffDays);
      const recentPenalty=(h.lastDayOffDays!=null && h.lastDayOffDays<7)?15:0;
      // justiça histórica: penaliza quem já teve mais folgas "boas" (sexta/segunda/dia inteiro) e mais folgas no total
      const boas=(h.fridaysOff||0)*3 + (h.mondaysOff||0)*2 + (h.integral||0)*3;
      // pesos: banco (alto) + urgência de banco alto (alto, escalonado) + tempo sem folgar (alto)
      //        + prioridade manual (médio) − folgas no total − folgas boas − folgou há pouco
      return bank*1.4 + bankUrgency(bank) + since*0.9 + (e.manual_priority||0)*5 - (h.dayoffs||0)*4 - boas - recentPenalty;
    };

    // equipe abaixo do mínimo: nem gera (exige aprovação manual)
    if (cap.maxHours===0){
      logs.push({type:'bloqueio', message:cap.note+' Geração de folgas suspensa até a equipe voltar ao mínimo.'});
      return { suggestions, logs, capacity:cap };
    }
    // elegíveis: banco PREVISTO (já descontando as folgas aprovadas) acima do mínimo configurado
    const futHrsPool = {};
    (existing||[]).forEach(it=>{ if(it&&it.employee_id) futHrsPool[it.employee_id]=(futHrsPool[it.employee_id]||0)+(+it.hours||0); });
    const projBank = e => (e.time_bank_balance||0) - (futHrsPool[e.id]||0);
    let pool = active.filter(e => projBank(e) >= minBank);
    if (pool.length===0){
      logs.push({type:'bloqueio', message:`Ninguém tem banco de horas acima de ${fmtHoras(minBank)} agora — não há horas a compensar com folga. (Esse mínimo é ajustável em Regras da loja.)`});
      return { suggestions, logs, capacity:cap };
    }

    const start = startDate ? parse(startDate) : new Date();
    const startStr = fmt(start);
    const horizonEnd = new Date(start); horizonEnd.setDate(horizonEnd.getDate()+horizonDays);
    const horizonEndStr = fmt(horizonEnd);
    // folgas de cada pessoa NESTA semana (conta as já aprovadas) — base do ciclo justo
    // e banco de horas RESTANTE (já descontando as folgas aprovadas) — ninguém folga além do que tem em banco
    const genCount = {}; const bankLeft = {}; const assignedDates = {}; const usedKind = {};
    active.forEach(e=>{ bankLeft[e.id] = (e.time_bank_balance||0); });
    for (const it of existing){
      if (!it || !it.employee_id || !it.date) continue;
      // adjacência: TODAS as folgas aprovadas contam (inclusive de outras semanas) — evita sexta + segunda seguinte
      (assignedDates[it.employee_id]=assignedDates[it.employee_id]||[]).push(it.date);
      // banco: TODA folga aprovada futura reduz o banco disponível (mesmo de outra semana) — o sistema se adequa
      bankLeft[it.employee_id] = (bankLeft[it.employee_id]||0) - (+it.hours||0);
      if (it.date < startStr || it.date > horizonEndStr) continue; // genCount (teto por semana) só da semana planejada
      genCount[it.employee_id] = (genCount[it.employee_id]||0) + 1;
      // rodízio entrar/sair: registra o tipo já usado na semana
      if (it.type==='entrada_tarde'||it.type==='saida_antecipada'){ (usedKind[it.employee_id]=usedKind[it.employee_id]||new Set()).add(it.type); }
    }
    // distância (em dias) do dia até a folga mais próxima que a pessoa já tem na semana — usado para espalhar
    const dayNum=ds=>Math.floor(parse(ds).getTime()/86400000);
    const minDist=(id,ds)=>{ const arr=assignedDates[id]; if(!arr||!arr.length) return Infinity; const t=dayNum(ds); return Math.min(...arr.map(x=>Math.abs(dayNum(x)-t))); };
    const maxBank = Math.max(0, ...pool.map(e=>e.time_bank_balance||0));
    // tags curtas que justificam a escolha (no máx. 3)
    const tagsFor = (e, dow, round, friRot) => {
      const t=[]; const bank=e.time_bank_balance||0; const h=history[e.id]||{};
      if (bank>0 && bank>=maxBank) t.push('Maior banco de horas');
      else if (maxBank>0 && bank>=maxBank*0.7) t.push('Banco alto');
      if (h.lastDayOffDays==null) t.push('Há mais tempo sem folgar');
      else if (h.lastDayOffDays>=14) t.push('Faz tempo sem folgar');
      if ((h.dayoffs||0)===0 && h.lastDayOffDays!=null) t.push('Poucas folgas no histórico');
      if (dow===5 && friRot) t.push('Revezamento de sexta'); // só quando há rodízio de sexta de fato
      if ((e.manual_priority||0)>0) t.push('Prioridade definida');
      return t.slice(0,3);
    };
    const mode = rules.dayoff_mode || 'saida_antecipada';
    const maxPerWeek = Math.max(1, rules.max_dayoffs_per_week ?? 2); // teto de folgas por pessoa na semana
    const want = rules.early_leave_hours ?? 3;
    const hours = Math.max(1, Math.min(want, cap.maxHours));          // custo (h) de cada folga parcial
    const ALL=['tarde_sair','manha_entrar','tarde_entrar','manha_sair'];
    const SLOT={tarde_sair:'tarde_fim', manha_entrar:'manha_ini', tarde_entrar:'tarde_ini', manha_sair:'manha_fim'};
    const MAP={ tarde_sair:{shift:'tarde',type:'saida_antecipada'}, manha_entrar:{shift:'manha',type:'entrada_tarde'},
                tarde_entrar:{shift:'tarde',type:'entrada_tarde'}, manha_sair:{shift:'manha',type:'saida_antecipada'} };
    // opções que a LOJA permite (configurável em Regras). Vazio/ausente = todas as 4.
    const storeAllowed = String(rules.allowed_dayoff_types||'').split(',').map(s=>s.trim()).filter(c=>ALL.includes(c));
    const STORE = storeAllowed.length ? storeAllowed : ALL.slice();
    const slotsOf=(it)=>{
      if(it.type==='entrada_tarde') return it.shift==='manha'?['manha_ini']:['tarde_ini'];
      if(it.type==='saida_antecipada') return it.shift==='manha'?['manha_fim']:['tarde_fim'];
      if(it.type==='meio_turno') return it.shift==='manha'?['manha_ini','manha_fim']:['tarde_ini','tarde_fim'];
      return [];
    };
    const leadDays = rules.high_traffic_lead_days ?? 7;
    const allowedHol = new Set(String(rules.holidays_allowed||'').split(',').map(s=>s.trim()).filter(Boolean));

    // exceções registradas (falta/atestado/afastamento) tiram a pessoa do dia, igual a uma folga integral
    const reqAbsentByDate={};
    requests.filter(r=>['falta','atestado','afastamento'].includes(r.request_type) && (r.status==='aprovado'||!r.status) && r.date)
      .forEach(r=>{ (reqAbsentByDate[r.date]=reqAbsentByDate[r.date]||new Set()).add(r.employee_id); });
    // monta os dias úteis abertos da janela já com a cobertura das folgas JÁ aprovadas
    const openDays=[];
    for (let i=0;i<=horizonDays;i++){
      const d=new Date(start); d.setDate(d.getDate()+i);
      const dStr=fmt(d); const dow=d.getDay();
      if (dStr<todayISO || !allowDow.includes(dow) || blocked(dStr)) continue;
      const comm = (rules.block_commemorative!==false) ? commemorativeBlock(dStr, leadDays, allowedHol) : null;
      if (comm){ logs.push({type:'bloqueio', message:`${DIAS[dow]} (${dStr}): sem folga — semana de ${comm} (alto movimento). As folgas ficam para depois da data.`}); continue; }
      const existToday = existing.filter(it=>it.date===dStr);
      // dia inteiro fora: folga integral, falta, atestado, afastamento (qualquer um tira a pessoa do dia)
      const FULLDAY_OUT=['integral','falta','atestado','afastamento'];
      const reqOut = reqAbsentByDate[dStr] || new Set();
      const integralToday = existToday.filter(it=>FULLDAY_OUT.includes(it.type) || it.shift==='dia_inteiro').map(it=>it.employee_id).concat([...reqOut]);
      const availDay = active.filter(e=>!onVac(e,dStr) && !integralToday.includes(e.id));
      if (availDay.length < minPer){ logs.push({type:'bloqueio', message:`${DIAS[dow]} (${dStr}): só ${availDay.length} pessoa(s) disponível(is) e o mínimo da loja é ${minPer}.`}); continue; }
      const absent={}; existToday.forEach(it=>slotsOf(it).forEach(sl=>{ absent[sl]=(absent[sl]||0)+1; }));
      // função essencial: especialistas disponíveis no dia e quantos já estão de folga (das aprovadas)
      const expertsAvail = availDay.filter(e=>expertIds.has(e.id)).length;
      const expertOff = existToday.filter(it=>expertIds.has(it.employee_id)).length;
      // o teto de folgas por dia JÁ CONTA as folgas aprovadas neste dia (não oferece mais que o limite)
      openDays.push({dStr,dow,availDay,absent,doneToday:new Set([...existToday.map(it=>it.employee_id),...reqOut]),count:existToday.length,expertsAvail,expertOff});
    }
    // SEXTA primeiro SÓ quando há rodízio de sexta em jogo (alguém da fila tirou sexta recentemente e
    // seria bloqueada). Sem esse histórico, segue a ordem normal de data — a fila pega o primeiro dia liberado.
    const friDay = openDays.find(d=>d.dow===5);
    const fridayRotationNeeded = !!friDay && pool.some(e=>{ const iso=history[e.id]&&history[e.id].lastFridayISO; return iso && Math.round((parse(friDay.dStr)-parse(iso))/86400000) <= 10; });
    openDays.sort((a,b)=> fridayRotationNeeded ? ((b.dow===5?1:0)-(a.dow===5?1:0) || (a.dStr<b.dStr?-1:1)) : (a.dStr<b.dStr?-1:1));
    // bloqueia repetir a MESMA pessoa na segunda/sexta em semanas seguidas (pegou esse dia na ~última semana)
    const recentSameDow = (e, day)=>{
      const iso = day.dow===5 ? (history[e.id]&&history[e.id].lastFridayISO) : day.dow===1 ? (history[e.id]&&history[e.id].lastMondayISO) : null;
      if(!iso) return false;
      return Math.round((parse(day.dStr)-parse(iso))/86400000) <= 10;
    };
    // "ponte de fim de semana": mesma pessoa não folga sexta + a segunda seguinte (vira fim de semana prolongado)
    const weekendBridge = (e, day)=>{
      const arr = assignedDates[e.id]; if(!arr||!arr.length) return false;
      const t = parse(day.dStr).getTime();
      if(day.dow===1) return arr.some(d=>{ const x=parse(d); return x.getDay()===5 && Math.round((t-x.getTime())/86400000)===3; }); // segunda: bloqueia quem folga na sexta anterior
      if(day.dow===5) return arr.some(d=>{ const x=parse(d); return x.getDay()===1 && Math.round((x.getTime()-t)/86400000)===3; }); // sexta: bloqueia quem folga na segunda seguinte
      return false;
    };
    // a pessoa consegue um horário PREFERIDO dela livre neste dia? (usado pra preservar os horários disputados
    // para quem precisa deles, deixando quem é flexível preencher o resto)
    const canPref = (e, day)=>{
      let al=String(e.dayoff_pref||'').split(',').map(s=>s.trim()).filter(c=>ALL.includes(c));
      if(!al.length) al=STORE.slice(); else al=al.filter(c=>STORE.includes(c));
      if(!al.length) al=STORE.slice();
      return al.some(code => (day.absent[SLOT[code]]||0)===0 && (day.availDay.length-1) >= minPer);
    };

    // FILA, DIA A DIA: preenche cada dia com as de MAIOR prioridade até o teto do dia, antes de passar ao próximo.
    // Sexta vem primeiro (rodízio). Mantém banco, cobertura mínima, especialista, sem dias seguidos e rodízio entrar/sair.
    const costFull = cap.maxHours>=7?Math.min(8,cap.maxHours): cap.maxHours>=4?4:cap.maxHours;
    for (const day of openDays){
      const isFri = day.dow===5;
      let dguard=0;
      while (day.count < maxPerDay && dguard++ < 60){
        if (mode!=='saida_antecipada' && day.count>=1) break; // modo completo: no máx 1 folga/dia
        const cands = pool.filter(e=>
            (genCount[e.id]||0) < maxPerWeek &&
            !day.doneToday.has(e.id) &&
            !onVac(e,day.dStr) &&
            !refusals.some(r=>r.employee_id===e.id && r.date===day.dStr) &&
            !recentSameDow(e,day) &&   // não repete a mesma pessoa na segunda/sexta em semanas seguidas
            !weekendBridge(e,day) &&   // não folga sexta + segunda seguinte (fim de semana prolongado)
            !existing.some(it=>it.employee_id===e.id && it.date===day.dStr))
          .sort((a,b)=>{
            const ga=genCount[a.id]||0, gb=genCount[b.id]||0; if(ga!==gb) return ga-gb;       // 1) menos folgas na semana primeiro
            if (isFri){ const fa=(history[a.id]?.fridaysOff)||0, fb=(history[b.id]?.fridaysOff)||0; if(fa!==fb) return fa-fb; } // 2) revezamento de sexta: quem pegou menos sextas primeiro
            const ca=canPref(a,day)?1:0, cb=canPref(b,day)?1:0; if(ca!==cb) return cb-ca;        // 3) quem consegue um horário preferido livre hoje vai primeiro (preserva os horários disputados)
            const da=minDist(a.id,day.dStr), db=minDist(b.id,day.dStr);
            const adA=da<=1?1:0, adB=db<=1?1:0; if(adA!==adB) return adA-adB;                  // 3) evita dia colado à própria folga (deixa por último)
            const la=history[a.id]?.lastDayOffDays??9999, lb=history[b.id]?.lastDayOffDays??9999; if(la!==lb) return lb-la; // 4) há mais tempo sem folgar primeiro
            if(da!==db) return db-da;                                                          // 5) mais longe da própria folga (espalha)
            return scoreOf(b)-scoreOf(a);                                                       // 6) banco/justiça (ordem da fila)
          });
        let placedThis=false;

        if (mode !== 'saida_antecipada'){
          // MODO COMPLETO (integral / meio turno): no máximo 1 por dia
          if (day.availDay.length-1 < minPer) break;
          let chosen=null;
          for (const e of cands){ const h=history[e.id]||{};
            if(day.dow===5 && (h.fridaysOff||0)>=2) continue;
            if(((bankLeft[e.id]||0) - costFull) < minBank) continue; // não deixa o banco cair abaixo do mínimo
            if(requireExpert && expertIds.has(e.id) && (day.expertsAvail-day.expertOff-1) < 1) continue; // manteria a loja sem especialista
            chosen=e; break; }
          if(chosen){
            const round=genCount[chosen.id]||0;
            let type,hours2,shift;
            if (cap.maxHours>=7){ type='integral'; hours2=Math.min(8,cap.maxHours); shift='dia_inteiro'; }
            else if (cap.maxHours>=4){ type='meio_turno'; hours2=4; shift='tarde'; }
            else { type='saida_antecipada'; hours2=cap.maxHours; shift='tarde'; }
            const acao = type==='integral'?`folgar ${DIAS[day.dow]} (${day.dStr}) o dia inteiro`
                       : type==='meio_turno'?`folgar meio turno (${shift==='tarde'?'tarde':'manhã'}) de ${DIAS[day.dow]} (${day.dStr})`
                       : `sair ${hours2}h mais cedo à tarde de ${DIAS[day.dow]} (${day.dStr})`;
            const h=history[chosen.id]||{}; const ld=h.lastDayOffDays;
            const since=(ld==null?'não folga há bastante tempo':ld===0?'folgou por último hoje':ld===1?'última folga foi ontem':`não folga há ${ld} dias`);
            const reason=`${chosen.name} pode ${acao} — tem ${fmtHoras(chosen.time_bank_balance)} de banco de horas, ${since}, e a loja ainda fica com ${day.availDay.length-1} pessoas no dia (mínimo ${minPer}).`;
            suggestions.push({ employee_id:chosen.id, employee_name:chosen.name, date:day.dStr, shift, type, hours:hours2, reason, tags:tagsFor(chosen,day.dow,round,fridayRotationNeeded), score:Math.round(scoreOf(chosen)) });
            logs.push({type:'sugestao', employee_id:chosen.id, employee_name:chosen.name, message:reason});
            genCount[chosen.id]=round+1; bankLeft[chosen.id]=(bankLeft[chosen.id]||0)-hours2; (assignedDates[chosen.id]=assignedDates[chosen.id]||[]).push(day.dStr); if(expertIds.has(chosen.id)) day.expertOff++; day.count++; placedThis=true;
          }
        } else {
          // MODO PARCIAL: coloca a próxima da fila neste dia (até o teto do dia)
          for (const e of cands){
            const hh=history[e.id]||{};
            if (day.dow===5 && (hh.fridaysOff||0)>=2){
              logs.push({type:'bloqueio', employee_id:e.id, employee_name:e.name, message:`${e.name} não recebe esta sexta: já folgou 2 sextas no mês — passando a vez para manter o equilíbrio.`}); continue;
            }
            if (((bankLeft[e.id]||0) - hours) < minBank){
              logs.push({type:'bloqueio', employee_id:e.id, employee_name:e.name, message:`${e.name} não recebe folga: ficaria com ${fmtHoras((bankLeft[e.id]||0)-hours)} de banco, abaixo do mínimo de ${fmtHoras(minBank)}.`});
              continue;
            }
            if (requireExpert && expertIds.has(e.id) && (day.expertsAvail-day.expertOff-1) < 1){
              logs.push({type:'bloqueio', employee_id:e.id, employee_name:e.name, message:`${e.name} (mais experiente) não folga ${DIAS[day.dow]} (${day.dStr}): deixaria a loja sem ninguém com mais conhecimento no dia.`});
              continue;
            }
            // opções permitidas: preferência da funcionária ∩ o que a LOJA permite (Regras). Sem interseção → usa o da loja.
            let allowed=String(e.dayoff_pref||'').split(',').map(s=>s.trim()).filter(c=>ALL.includes(c));
            if(!allowed.length) allowed=STORE.slice(); else allowed=allowed.filter(c=>STORE.includes(c));
            if(!allowed.length) allowed=STORE.slice();
            // cada HORÁRIO (slot) só pode ter UMA folga no dia: duas pessoas no mesmo dia, mas NUNCA no mesmo horário.
            // Se o horário PREFERIDO dela já está ocupado neste dia, tenta qualquer horário livre da loja
            // (preferência não é garantida) — assim ela folga em vez de ficar sem, sem colidir horário.
            let validos=allowed.filter(code=> (day.absent[SLOT[code]]||0)===0 && (day.availDay.length-1) >= minPer);
            if(!validos.length) validos=STORE.filter(code=> (day.absent[SLOT[code]]||0)===0 && (day.availDay.length-1) >= minPer);
            if(!validos.length) continue; // nenhum horário livre no dia → vai para outro dia
            // rodízio entrar/sair: se já teve "entrar mais tarde" nesta semana, a próxima é "sair mais cedo" (e vice-versa)
            const jaUsou = usedKind[e.id] || new Set();
            let opts = validos.filter(code=> !jaUsou.has(MAP[code].type));
            if(!opts.length) opts = validos; // já teve os dois tipos (ou só sobra repetido)
            let bestCode=null, bestLoad=Infinity;
            for (const code of opts){ const load=day.absent[SLOT[code]]||0; if (load < bestLoad){ bestCode=code; bestLoad=load; } }
            if(!bestCode) continue;
            const slot=SLOT[bestCode]; day.absent[slot]=(day.absent[slot]||0)+1;
            const {shift,type}=MAP[bestCode];
            (usedKind[e.id]=usedKind[e.id]||new Set()).add(type); // registra o tipo usado p/ o rodízio
            const round=genCount[e.id]||0;
            const periodoTxt = shift==='manha' ? 'de manhã' : 'à tarde';
            const acao = type==='entrada_tarde' ? `entrar ${hours}h mais tarde ${periodoTxt} de ${DIAS[day.dow]} (${day.dStr})` : `sair ${hours}h mais cedo ${periodoTxt} de ${DIAS[day.dow]} (${day.dStr})`;
            const ld=hh.lastDayOffDays;
            const since=(ld==null?'não folga há bastante tempo':ld===0?'folgou por último hoje':ld===1?'última folga foi ontem':`não folga há ${ld} dias`);
            const reason=`${e.name} pode ${acao} — tem ${fmtHoras(e.time_bank_balance)} de banco de horas, ${since}. Nesse horário a loja segue com ${day.availDay.length-day.absent[slot]} pessoa(s) (mínimo ${minPer}).`;
            suggestions.push({ employee_id:e.id, employee_name:e.name, date:day.dStr, shift, type, hours, reason, tags:tagsFor(e,day.dow,round,fridayRotationNeeded), score:Math.round(scoreOf(e)) });
            logs.push({type:'sugestao', employee_id:e.id, employee_name:e.name, message:reason});
            genCount[e.id]=round+1; bankLeft[e.id]=(bankLeft[e.id]||0)-hours; (assignedDates[e.id]=assignedDates[e.id]||[]).push(day.dStr); if(expertIds.has(e.id)) day.expertOff++; day.doneToday.add(e.id); day.count++; placedThis=true;
            break; // colocou 1 nesta vaga; o while preenche a próxima vaga do mesmo dia
          }
        }
        if(!placedThis) break; // nada mais encaixa neste dia → próximo dia
      }
    }

    // tag "2ª folga da semana" em ordem CRONOLÓGICA real (conta folgas já aprovadas antes na semana)
    const porFunc={};
    suggestions.forEach(s=>{ (porFunc[s.employee_id]=porFunc[s.employee_id]||[]).push(s); });
    for(const id in porFunc){
      const exDatas=existing.filter(it=>it.employee_id===id && it.date>=startStr && it.date<=horizonEndStr).map(it=>it.date);
      const lista=porFunc[id].sort((a,b)=> a.date<b.date?-1:1);
      lista.forEach(s=>{
        s.tags=(s.tags||[]).filter(t=>!/da semana/i.test(t)); // limpa qualquer marca antiga
        const antes=exDatas.filter(d=>d<s.date).length + lista.filter(x=>x.date<s.date).length;
        if(antes>0){ s.tags.unshift('2ª folga da semana'); s.tags=s.tags.slice(0,3); } // garante que apareça
      });
    }

    requests.filter(r=>r.status==='pendente' && r.request_type==='pedido_folga').forEach(r=>{
      logs.push({type:'sugestao', employee_id:r.employee_id, employee_name:r.employee_name,
        message:`Pedido de folga de ${r.employee_name} em ${r.date||'data a definir'} aguarda sua aprovação.`});
    });
    return { suggestions, logs, capacity:cap };
  }

  // ---- Cenários prontos de simulação ----
  function simEmployees() {
    return [
      {name:'Ana',      cargo:'Vendedora',     status:'ativa', time_bank_balance:18, preferences:'Prefere folgar 2ª', restrictions:'', manual_priority:0},
      {name:'Bruna',    cargo:'Vendedora',     status:'ativa', time_bank_balance:6,  preferences:'', restrictions:'Estuda à noite', manual_priority:0},
      {name:'Carla',    cargo:'Caixa',         status:'ativa', time_bank_balance:22, preferences:'Prefere meio turno', restrictions:'', manual_priority:1},
      {name:'Daniela',  cargo:'Óptica',        status:'ativa', time_bank_balance:9,  preferences:'', restrictions:'Não pode sábado', manual_priority:0},
      {name:'Elisa',    cargo:'Vendedora',     status:'ativa', time_bank_balance:3,  preferences:'Prefere sexta', restrictions:'', manual_priority:0},
      {name:'Fernanda', cargo:'Gerente',       status:'ativa', time_bank_balance:14, preferences:'', restrictions:'Função essencial', manual_priority:2},
    ];
  }
  const SCENARIOS = [
    {key:'completa',   name:'1. Equipe completa', apply:(emps)=>emps},
    {key:'ferias1',    name:'2. Uma em férias',    apply:(emps)=>{emps[0].status='ferias';return emps;}},
    {key:'ferias2',    name:'3. Duas em férias',   apply:(emps)=>{emps[0].status='ferias';emps[3].status='ferias';return emps;}},
    {key:'bancoalto',  name:'4. Banco muito alto', apply:(emps)=>{emps[2].time_bank_balance=40;return emps;}},
    {key:'conflito',   name:'5. Pedido em dia ocupado', apply:(emps)=>emps},
    {key:'falta',      name:'6. Falta inesperada', apply:(emps)=>{emps[1].status='afastada';return emps;}},
    {key:'sabado',     name:'7. Semana com sábado', apply:(emps)=>emps},
    {key:'altomov',    name:'8. Mês de alto movimento', apply:(emps)=>emps},
    {key:'escala5x2',  name:'9. Teste escala 5x2', apply:(emps)=>emps},
    {key:'recusa',     name:'10. Recusa de folga', apply:(emps)=>emps},
  ];

  // FILA DE JUSTIÇA: ordena quem está na frente para folgar e explica o porquê.
  // Considera as folgas JÁ APROVADAS: desconta do banco previsto e quem já tem folga marcada
  // "passa a vez" (desce na fila) — assim a ordem gira a cada semana.
  // Critérios: elegível (banco previsto ≥ mínimo) → ainda sem folga marcada → maior banco previsto
  //            → mais tempo sem folgar → menos folgas "boas".
  function dayoffQueue(employees, rules, history={}, existing=[]){
    const fH = v=>{ v=+v||0; const neg=v<0; let m=Math.round(Math.abs(v)*60); const h=Math.floor(m/60); m=m%60; return (neg?'-':'')+h+'h'+(m?String(m).padStart(2,'0'):''); };
    const minBank = rules.min_time_bank_for_dayoff ?? 6;
    const folgaCost = Math.max(1, rules.early_leave_hours ?? 3); // custo (h) de uma folga parcial
    const active = employees.filter(e=>e.status==='ativa');
    // folgas já aprovadas (futuras): horas a descontar e quantas marcadas por pessoa
    const futH={}, futN={};
    (existing||[]).forEach(it=>{ if(!it||!it.employee_id) return; futH[it.employee_id]=(futH[it.employee_id]||0)+(+it.hours||0); futN[it.employee_id]=(futN[it.employee_id]||0)+1; });
    const good = x => x.fri*2 + x.mon + x.integral*2;   // folgas "boas" no histórico
    const rows = active.map(e=>{ const h=history[e.id]||{}; const bank=+e.time_bank_balance||0; const proj=bank-(futH[e.id]||0);
      return { id:e.id, name:e.name, bank, proj, marcadas:futN[e.id]||0, elig:(proj-folgaCost)>=minBank,
        last:(h.lastDayOffDays==null?null:h.lastDayOffDays), fri:h.fridaysOff||0, mon:h.mondaysOff||0,
        integral:h.integral||0, dayoffs:h.dayoffs||0 }; });
    const maxProj = Math.max(0, ...rows.map(r=>r.proj));
    rows.sort((a,b)=>{
      if(a.elig!==b.elig) return a.elig?-1:1;
      if((a.marcadas>0)!==(b.marcadas>0)) return a.marcadas>0?1:-1;   // quem já tem folga marcada passa a vez
      if(b.proj!==a.proj) return b.proj-a.proj;                       // maior banco previsto
      const la=a.last==null?99999:a.last, lb=b.last==null?99999:b.last;
      if(lb!==la) return lb-la;
      if(good(a)!==good(b)) return good(a)-good(b);
      return (a.name||'').localeCompare(b.name||'');
    });
    rows.forEach((x,i)=>{ x.position=i+1; const w=[];
      if(!x.elig){ const pv=x.marcadas>0?'previsto ':'';
        if(x.proj < minBank) w.push(`sem saldo p/ folga · banco ${pv}de ${fH(x.proj)} — faltam ${fH(minBank-x.proj)} pro mínimo de ${fH(minBank)}`);
        else w.push(`sem saldo p/ folga · banco ${pv}de ${fH(x.proj)} — uma folga (${fH(folgaCost)}) deixaria abaixo do mínimo de ${fH(minBank)}`); }
      else {
        if(x.marcadas>0) w.push(`já tem ${x.marcadas} folga(s) marcada(s) — passou a vez`);
        w.push((x.proj>0&&x.proj>=maxProj) ? `maior banco${x.marcadas>0?' previsto':''} (${fH(x.proj)})` : `banco${x.marcadas>0?' previsto':''} de ${fH(x.proj)}`);
        if(x.last==null) w.push('ainda não folgou no período');
        else if(x.last>=14) w.push(`há ${x.last} dias sem folgar`);
        else w.push(`última folga há ${x.last} dia(s)`);
        if(good(x)===0 && x.dayoffs>0 && x.marcadas===0) w.push('poucas folgas boas (sexta/segunda)');
      }
      x.why = w.join(' · ');
      // versão curta para a funcionária (sem "passou a vez"/recência): só folgas marcadas + banco previsto
      const ws=[];
      if(x.elig){ if(x.marcadas>0) ws.push(`já tem ${x.marcadas} folga${x.marcadas>1?'s':''} marcada${x.marcadas>1?'s':''}`);
        ws.push(`banco${x.marcadas>0?' previsto':''} de ${fH(x.proj)}`); }
      else ws.push(`sem saldo p/ folga · banco de ${fH(x.proj)}`);
      x.whyShort = ws.join(' · ');
    });
    return rows;
  }

  return { saturdaysOfMonth, openSaturdays, daysInMonth, operationalCapacity, fairnessIndex,
           saturdayRotation, suggestDayOffs, dayoffQueue, simEmployees, SCENARIOS, DOW, fmt, parse,
           commemorativeDates, commemorativeBlock };
})();
