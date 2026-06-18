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
  function daysInMonth(year, month){ return new Date(year, month, 0).getDate(); }

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
               lastDayOffDays:(h.lastDayOffDays==null?60:h.lastDayOffDays), bank:e.time_bank_balance||0 };
    });
    const spread = (arr)=>{ if(!arr.length) return 0; const mx=Math.max(...arr),mn=Math.min(...arr); return mx-mn; };
    const dSpread = spread(vals.map(v=>v.dayoffs));
    const sSpread = spread(vals.map(v=>v.saturdays));
    const bSpread = spread(vals.map(v=>v.bank));
    // pontuação: começa 100, penaliza dispersões
    let score = 100 - dSpread*7 - sSpread*9 - Math.min(40, bSpread*1.5);
    score = Math.max(0, Math.round(score));
    let status, reason;
    if (score>=85){ status='justo'; reason='Folgas, sábados e banco de horas estão bem equilibrados.'; }
    else if (score>=70){ status='aceitavel'; reason='Pequenas diferenças entre as funcionárias, dentro do tolerável.'; }
    else if (score>=50){ status='atencao'; reason='Diferenças relevantes — vale priorizar quem está atrás.'; }
    else { status='desequilibrado'; reason='Distribuição desigual de folgas/sábados/banco entre a equipe.'; }
    // motivos detalhados
    if (dSpread>=3) reason += ` Diferença de ${dSpread} folgas entre quem mais e menos folgou.`;
    if (sSpread>=2) reason += ` Diferença de ${sSpread} sábados trabalhados.`;
    return { status, score, reason, rows:vals.sort((a,b)=>b.bank-a.bank) };
  }

  // ---- Rodízio de Sábados ----
  // 2 primeiros sábados; quem trabalha no 1º não trabalha no 2º; equilibra histórico.
  function saturdayRotation(employees, rules, year, month, history) {
    const sats = saturdaysOfMonth(year, month).slice(0, rules.saturday_open_count||2);
    const eligible = employees.filter(e => e.status==='ativa');
    const logs=[]; const assignments=[];
    if (eligible.length===0){
      logs.push({type:'rodizio', message:'Nenhuma funcionária ativa para o rodízio de sábados.'});
      return { saturdays: sats.map(fmt), assignments, logs };
    }
    // ordena por menos sábados no histórico (mais "devendo" trabalha primeiro)
    const ranked = [...eligible].sort((a,b)=>{
      const ha=(history[a.id]?.saturdays)||0, hb=(history[b.id]?.saturdays)||0;
      if(ha!==hb) return ha-hb;
      return (b.manual_priority||0)-(a.manual_priority||0);
    });
    sats.forEach((satDate, idx)=>{
      // escala a próxima na fila que não foi escalada no sábado anterior deste mês
      const prev = idx>0 ? assignments[idx-1]?.employee_id : null;
      const pick = ranked.find(e => e.id!==prev && !assignments.some(a=>a.employee_id===e.id))
                 || ranked.find(e => e.id!==prev) || ranked[0];
      assignments.push({
        saturday_number: idx+1, saturday_date: fmt(satDate),
        employee_id: pick.id, employee_name: pick.name
      });
      const others = ranked.filter(e=>e.id!==pick.id).map(e=>e.name).join(', ');
      logs.push({type:'rodizio', employee_id:pick.id, employee_name:pick.name,
        message:`${pick.name} foi escalada no ${idx+1}º sábado (${DOW[6]} ${fmt(satDate)}, ${rules.saturday_start||'14:00'}–${rules.saturday_end||'17:00'}) por ter menos sábados no histórico. Fora do rodízio neste sábado: ${others||'—'}.`});
    });
    return { saturdays: sats.map(fmt), assignments, logs };
  }

  // ---- Motor de Sugestão de Folgas ----
  // Gera sugestões para os próximos dias úteis com base em banco de horas,
  // tempo sem folgar, cobertura mínima, férias, pedidos e recusas.
  function suggestDayOffs(opts) {
    const { employees, rules, vacations, requests=[], refusals=[], history={},
            blockedDates=[], horizonDays=14, startDate } = opts;
    const cap = operationalCapacity(employees, rules);
    const logs=[]; const suggestions=[];
    const minBank = rules.min_time_bank_for_dayoff ?? 6;
    const minPer  = rules.min_per_shift || 4;
    const active  = employees.filter(e=>e.status==='ativa');
    const onVac = (e, dStr) => vacations.some(v => v.employee_id===e.id && dStr>=v.start_date && dStr<=v.end_date);
    const blocked = (dStr) => blockedDates.some(b=>b.date===dStr);
    const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
    const fmtHoras = (v)=>{ v=+v||0; const neg=v<0; let m=Math.round(Math.abs(v)*60); const h=Math.floor(m/60); m=m%60; return (neg?'-':'')+h+'h'+(m?String(m).padStart(2,'0')+'min':''); };
    const todayISO = fmt(new Date());

    const scoreOf = (e)=>{
      const h=history[e.id]||{};
      const bank=e.time_bank_balance||0;
      const since=(h.lastDayOffDays==null?45:h.lastDayOffDays);
      const recentPenalty=(h.lastDayOffDays!=null && h.lastDayOffDays<7)?20:0;
      return bank*1.4 + since*0.8 + (e.manual_priority||0)*5 - recentPenalty;
    };

    // equipe abaixo do mínimo: nem gera (exige aprovação manual)
    if (cap.maxHours===0){
      logs.push({type:'bloqueio', message:cap.note+' Geração de folgas suspensa até a equipe voltar ao mínimo.'});
      return { suggestions, logs, capacity:cap };
    }
    // elegíveis: banco acima do mínimo configurado
    let pool = active.filter(e => (e.time_bank_balance||0) >= minBank);
    if (pool.length===0){
      logs.push({type:'bloqueio', message:`Ninguém tem banco de horas acima de ${fmtHoras(minBank)} agora — não há horas a compensar com folga. (Esse mínimo é ajustável em Regras da loja.)`});
      return { suggestions, logs, capacity:cap };
    }

    const start = startDate ? parse(startDate) : new Date();
    const used = new Set(); // no máximo 1 folga por pessoa nesta geração
    for (let i=0;i<=horizonDays;i++){
      const d=new Date(start); d.setDate(d.getDate()+i);
      const dStr=fmt(d); const dow=d.getDay();
      if (dStr<=todayISO) continue;                 // não sugere hoje nem dias que já passaram
      if (dow===0) continue;                        // domingo: loja fechada
      if (dow===6) continue;                        // sábado: controlado pelo Rodízio de sábados
      if (blocked(dStr)) continue;                  // dia bloqueado para folga

      // disponíveis de fato nesse dia (ativas e não de férias)
      const availDay = active.filter(e=>!onVac(e,dStr));
      const cands = pool
        .filter(e=>!used.has(e.id) && !onVac(e,dStr))
        .filter(e=>!refusals.some(r=>r.employee_id===e.id && r.date===dStr))
        .sort((a,b)=>scoreOf(b)-scoreOf(a));
      if (cands.length===0) continue;

      // liberar 1 folga nesse dia deixa quantos na loja?
      if (availDay.length - 1 < minPer){
        logs.push({type:'bloqueio',
          message:`${DIAS[dow]} (${dStr}): não dá para liberar folga — só ${availDay.length} pessoa(s) disponível(is) e o mínimo da loja é ${minPer}.`});
        continue;
      }

      // maior prioridade que não esbarre na regra das sextas
      let chosen=null;
      for (const e of cands){
        const h=history[e.id]||{};
        if (dow===5 && (h.fridaysOff||0)>=2){
          logs.push({type:'bloqueio', employee_id:e.id, employee_name:e.name,
            message:`${e.name} não recebe esta sexta: já folgou 2 sextas no mês — passando a vez para manter o equilíbrio.`});
          continue;
        }
        chosen=e; break;
      }
      if (!chosen) continue;

      const remaining = availDay.length - 1;
      let type, hours, shift;
      if (cap.maxHours>=7){ type='integral'; hours=Math.min(8,cap.maxHours); shift='dia_inteiro'; }
      else if (cap.maxHours>=4){ type='meio_turno'; hours=4; shift='tarde'; }
      else { type='saida_antecipada'; hours=cap.maxHours; shift='tarde'; }
      const quando = type==='integral' ? 'o dia inteiro' : (shift==='tarde' ? 'à tarde' : 'de manhã');
      const h=history[chosen.id]||{};
      const since=(h.lastDayOffDays==null?'há bastante tempo':`há ${h.lastDayOffDays} dias`);
      const reason=`${chosen.name} pode folgar ${DIAS[dow]} (${dStr}), ${quando} — tem ${fmtHoras(chosen.time_bank_balance)} de banco de horas, não folga ${since}, e a loja ainda fica com ${remaining} pessoas no dia (mínimo ${minPer}).`;
      suggestions.push({ employee_id:chosen.id, employee_name:chosen.name, date:dStr, shift, type, hours, reason, score:Math.round(scoreOf(chosen)) });
      logs.push({type:'sugestao', employee_id:chosen.id, employee_name:chosen.name, message:reason});
      used.add(chosen.id);
      if (used.size>=pool.length) break;            // todas as elegíveis já têm uma folga
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

  return { saturdaysOfMonth, daysInMonth, operationalCapacity, fairnessIndex,
           saturdayRotation, suggestDayOffs, simEmployees, SCENARIOS, DOW, fmt, parse };
})();
