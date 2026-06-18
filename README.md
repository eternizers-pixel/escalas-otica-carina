# 👓 Escalas · Ótica Carina

Sistema de gestão de escalas, folgas, banco de horas e rodízio de sábados, com sugestões inteligentes e justas, alimentado pelos dados do TiqueTaque (importação de planilha) e persistido no Supabase.

## Arquivos
| Arquivo | Função |
|---|---|
| `index.html` | Estrutura e estilo da interface |
| `config.js` | **Suas chaves do Supabase** (preencher) |
| `engine.js` | Motor de decisão (folgas, capacidade, sábados, justiça) |
| `app.js` | Aplicação (login, módulos, CRUD) |
| `schema.sql` | Banco de dados completo (rodar no Supabase) |

## Como publicar (resumo)
1. **Supabase** → crie um projeto → SQL Editor → cole `schema.sql` → Run.
2. **config.js** → preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (em Project Settings → API).
3. **GitHub** → crie um repositório → suba os 5 arquivos.
4. **Vercel** → Import do repositório → framework "Other" (estático) → Deploy.
5. Abra o site → **Criar conta** (o primeiro usuário vira **Gestor** automaticamente).

## Perfis de acesso
- **Gestor**: importa dados, altera regras, aprova folgas, edita escala. (1º cadastro)
- **Visualização**: vê tudo, não altera. (demais cadastros — promova a gestor no banco se quiser)

## Importação TiqueTaque
Exporte do TiqueTaque um relatório de banco de horas em **Excel ou CSV**. Colunas reconhecidas (qualquer ordem, acentos opcionais): `nome`, `saldo`, `horas_positivas`, `horas_negativas`, `faltas`, `atrasos`, `saidas_antecipadas`, `batidas_faltantes`. O sistema valida, identifica pelo nome, mostra erros e atualiza os saldos.

## Segurança
- Senhas nunca são armazenadas pelo sistema — autenticação é feita pelo Supabase Auth.
- RLS (Row Level Security) ativo em todas as tabelas: só o Gestor escreve.
- Nenhuma credencial do TiqueTaque é guardada.
