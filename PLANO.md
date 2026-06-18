# Plano técnico — Sistema de Escalas Ótica Carina

## 1. Estratégia de integração com o TiqueTaque

Pesquisa realizada: o TiqueTaque **exporta relatórios em Excel (.xlsx), CSV e PDF** (espelho de ponto, horas extras, banco de horas, com filtro por funcionário/unidade) e **possui API aberta oficial** (registro de ponto, cadastros, afastamentos), com integrações já existentes (Convenia, Comunitive).

Decisão de arquitetura, em camadas de segurança e robustez:

| Fase | Método | Por quê |
|---|---|---|
| **Agora (MVP)** | Importação manual de planilha/CSV exportada do TiqueTaque | Seguro, zero senha armazenada, sem scraping frágil, funciona hoje |
| **Evolução** | Integração via API aberta do TiqueTaque | Oficial e estável; elimina o passo manual |
| **Alternativa** | Relatório por e-mail com anexo processado | Útil se a API não for liberada para o plano contratado |
| **Descartado** | Automação de navegador / scraping do TiqueTaque | Frágil, quebra a cada mudança de layout, risco de violar termos |

A camada de importação (`esc_time_bank_imports` + `esc_time_bank_balances`) é **agnóstica à origem**: o mesmo formato de dados serve para planilha hoje e API amanhã, sem refazer o resto do sistema.

## 2. Arquitetura geral

- **Front-end**: app single-file (HTML + JS modular: `config` / `engine` / `app`), responsivo, sem build — publica direto na Vercel. Migração para React+Vite é possível depois reaproveitando 100% do `engine.js`.
- **Banco/Auth**: Supabase (Postgres + Auth + RLS). Todas as tabelas com prefixo `esc_`, isoladas de qualquer outro sistema.
- **Hospedagem**: Vercel (estático), versionado no GitHub.
- **Persistência real**: nada de localStorage para dados de produção — tudo no Supabase.

## 3. Modelo de dados (resumo)

`esc_profiles` (perfis/roles) · `esc_employees` · `esc_time_bank_imports` · `esc_time_bank_balances` · `esc_store_rules` · `esc_blocked_dates` · `esc_vacation_periods` · `esc_schedules` · `esc_schedule_items` · `esc_absence_records` · `esc_dayoff_requests` · `esc_shift_swap_requests` · `esc_saturday_rotation` · `esc_fairness_scores` · `esc_decision_logs` · `esc_simulation_scenarios` · `esc_simulation_employees` · `esc_audit_logs`.

## 4. Regras de negócio implementadas

- **Cobertura mínima**: nunca sugerir folga que deixe a loja abaixo do mínimo por turno.
- **Banco de horas**: só sugere folga acima do mínimo configurado; prioriza maior saldo.
- **Tempo sem folgar**: quem está há mais tempo sem compensar sobe no ranking.
- **Anti-repetição**: penaliza quem folgou nos últimos 7 dias; evita 3ª sexta de folga no mês.
- **Capacidade operacional**: equipe completa → folga integral; 1 em férias → meio turno; 2 em férias → folgas curtas; abaixo do mínimo → bloqueia e exige aprovação manual.
- **Férias**: bloqueiam folga, rodízio e troca da pessoa; reduzem a capacidade das demais.
- **Rodízio de sábados**: 2 primeiros sábados, quem trabalha no 1º não trabalha no 2º, equilíbrio por histórico.
- **Justiça histórica**: índice que mede dispersão de folgas, sábados e banco entre a equipe.
- **Aprovação manual**: o sistema **sugere**, o gestor **aprova/edita/recusa**. Nada é aplicado automaticamente.
- **Log de decisão**: toda sugestão e todo bloqueio recebem explicação em linguagem clara.

## 5. Algoritmo de sugestão (visão)

Para cada dia útil do horizonte: calcula candidatas elegíveis (banco ≥ mínimo, não em férias, sem recusa no dia) → ordena por `banco·1,4 + dias_sem_folgar·0,8 + prioridade·5 − penalidade_recente` → verifica se liberar mantém cobertura mínima → define turno/horas pela capacidade operacional → grava sugestão + motivo. Tudo auditável no log.

## 6. Escala 5x2 (futura)

A regra `scale_5x2_enabled` já existe em `esc_store_rules`. Quando ativada, o motor passa a organizar domingo fixo de folga + 1 dia rotativo, rodízio justo do 2º dia e equilíbrio entre segundas/sextas/sábados — reusando a mesma base de cobertura mínima e justiça.

## 7. Fases de entrega

1. **MVP (esta entrega)**: funcionárias, importação de planilha, férias, regras, motor de folgas + log, calendário, rodízio de sábados, simulação, Supabase, deploy Vercel, login por perfil.
2. **Fase 2**: integração via API do TiqueTaque; solicitações feitas pelas próprias funcionárias; relatórios avançados (PDF).
3. **Fase 3**: escala 5x2 completa; app mobile; notificações.

## 8. Cuidado com mudanças sensíveis

Antes de alterar regras críticas (cobertura mínima, capacidade, rodízio) ou rodar algo que afete dados reais, o sistema separa **simulação** de **produção** (flag `is_simulation`) e exige **aprovação manual** do gestor para qualquer folga entrar na escala.
