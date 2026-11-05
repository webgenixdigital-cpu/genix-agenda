# Auditoria de desempenho — Genix Agenda

Data: 05/11/2026 · branch `feat/whatsapp-intervalo-variavel` · Next.js 14.2.35 · **só diagnóstico**.
Nada foi alterado no código ou no banco: nenhum SQL rodado, nenhum PR. As medições usaram `next build` +
`next start` na porta 3100, o login da `/demo` (viewer) e consultas REST de leitura com a sessão da demo.

## Resumo em 4 linhas

1. **O gargalo é a quantidade de idas ao Supabase em sequência, não o banco.** Cada consulta isolada leva
   **~160–180 ms**, e quase tudo é rede: `niches limit 1` leva o mesmo tempo que `customer_summary`. Com o volume
   de hoje, o Postgres responde em poucos ms.
2. **O painel paga ~1 s fixo antes de mostrar qualquer coisa.** São 5 a 8 idas em sequência no middleware,
   no `getAdminContext`, no `getPlanContext` e nos avisos do layout. A página mais leve do painel
   (`/financeiro/contador`) já leva **~1,05 s**.
3. **A vitrine faz cerca de 19 consultas por visita.** A `loadVitrine` roda duas vezes, uma no `generateMetadata`
   e outra na página, e nada fica em cache.
4. **Pacote JS:** recharts (112 kB gz) no Financeiro, e supabase-js (~67 kB gz) carregado na vitrine, no cadastro,
   no login e no layout do painel só para 1 chamada cada.

## Tempos medidos (localhost → Supabase de produção)

TTFB do servidor, mediana de 8 medições depois de 1 aquecimento (curl com a sessão da demo).
No navegador do app, o `load` ficou de 10 a 600 ms acima do TTFB (a Agenda é a que mais demora para hidratar).

| Rota | TTFB mediana | mín–máx | HTML | Navegador (load) |
|---|---|---|---|---|
| `/admin` (Início) | **1.399 ms** | 1.357–1.937 (1ª rodada: 2,4 s) | 39 kB | 1,2–1,7 s |
| `/admin/agenda` (dia) | **1.090 ms** | 821–1.203 | 63 kB | 1,25–1,5 s |
| `/admin/clientes` | **1.137 ms** | 881–1.300 | 134 kB | 0,95–1,28 s |
| `/v/luminabelle` | **805 ms** | 572–831 | 73 kB | 0,73–0,93 s |
| `/admin/financeiro/contador` (referência mínima do painel) | 1.049 ms | 1.010–1.076 | — | — |
| `/` (ISR, comparação) | 167 ms | 163–181 | 101 kB | — |

Observações:
- A demo é `viewer`, então o layout **pula** 3 consultas que a **matriz (owner)** faz: o limite do Grátis, o status
  do WhatsApp e a avulsa vencida. **Para um dono real, o painel tende a ser 300–500 ms mais lento** que os
  números acima.
- Consulta REST isolada com a sessão da demo: de 153 a 194 ms para todas, incluindo `customer_summary` e
  `public_plan_info`. Um `getUser` no Auth leva 172 ms.

## 1. Build — First Load JS por rota

Build sem erros. Base compartilhada: **87,7 kB**. As 5 maiores:

| # | Rota | First Load | O que pesa |
|---|---|---|---|
| 1 | `/admin/financeiro` | **297 kB** | **recharts** (chunk 6536: 404 kB brutos / **112 kB gz**) importado direto em `components/admin/financeiro/revenue-chart.tsx` |
| 2 | `/v/[slug]` | **230 kB** | **supabase-js** (5283 + 44530001: ~67 kB gz), só para `rpc("get_available_slots")` no `booking-wizard.tsx:135`; **react-day-picker + date-fns** (chunk 147, 21 kB gz) pelo `Calendar`; o próprio wizard (25 kB / 8 kB gz) |
| 3 | `/cadastro` | 220 kB | supabase-js (`signup-form.tsx`) + radix (diálogos/select) |
| 4 | `/admin/agenda` | 209 kB | página com 80 kB brutos / 22 kB gz (`week-grid`, `month-calendar`, 3 diálogos com `Calendar`), react-day-picker, radix, sonner |
| 5 | `/redefinir-senha` | 196 kB | supabase-js (`reset-form.tsx`); o mesmo vale para `/admin/login` (187) e `/esqueci-senha` (186) |

Mais duas:
- **O layout do painel também baixa o supabase-js**, por causa do `EmailVerifyBanner` (`components/admin/email-verify-banner.tsx:7`,
  usado em `layout.tsx:110`), que só chama `signInWithOtp` ao clicar. A coluna do Next não soma os chunks do layout,
  então o peso real do painel é maior do que a tabela mostra.
- `/para/[nicho]` tem `revalidate = 3600`, mas sai como **ƒ (dinâmica)**. Ela usa o `createClient` do servidor
  (cookies, `para/[nicho]/page.tsx:54`), o mesmo item que já está no roadmap.

## 2. Consultas por página

### Base de todo o painel (layout + contexto)
| Ida | O quê | Arquivo |
|---|---|---|
| 1 | `auth.getUser()` no middleware (em **toda** requisição, inclusive em páginas públicas) | `lib/supabase/middleware.ts:28` |
| 2 | `auth.getUser()` de novo | `lib/admin.ts:25` |
| 3 | `business_members` + `businesses(*)` | `lib/admin.ts:28` |
| 4 | `professionals` (id do login), **em sequência**, sem depender da 3 além do `biz.id` | `lib/admin.ts:39` |
| 5 | `getPlanContext`: `access_tier` + `plan_kind` + `subscriptions` (3 em paralelo) | `lib/plan.ts:35` |
| 6–8 | Só para a matriz: limite e contagem, depois `whatsapp_panel_status`, depois a avulsa vencida, **3 awaits em sequência sem dependência entre si** | `layout.tsx:36-71` |

Assim, o painel faz **5 idas (viewer) a 8 idas (owner) em sequência, ~0,85–1,4 s**, antes do que a página pede.
Layout e página rodam em paralelo no App Router, mas os dois esperam o contexto (idas 2–5).

### Páginas medidas
| Página | Consultas | Em sequência que poderiam ser paralelas |
|---|---|---|
| `/admin` | base + 1 (`me`) + 4 (dashboard) + 3 (onboarding) + 1 (`autoConfirmed`) ≈ **9 próprias** | `me` (page.tsx:96), dashboard+onboarding (102) e `autoConfirmed` (111) formam **3 rodadas**; dá para fazer em 1 |
| `/admin/agenda` | 7 em paralelo (bookings, services, pros, blocks, hours, combo_items, plano) + `booking_package_info` + `professional_services` | `booking_package_info` (agenda-data.ts:89) e `professional_services` (101) dependem só da 1ª rodada e rodam **uma depois da outra**: podem ir juntas. Com `?calendario=`, `loadAgenda` roda 2× e repete services/pros/combo_items |
| `/admin/clientes` | 2 em paralelo (`customers` 300 + `customer_summary`) | nada a paralelizar. O `customer_summary` agrega **todos** os agendamentos do espaço, não só os 300 clientes mostrados |
| `/v/[slug]` | `generateMetadata`: `loadVitrine` (1 + 8) + `hiddenFromSearch` (1–2); página: `loadVitrine` de novo (1 + 8) ≈ **19–20** | `loadVitrine` sem `React.cache` → tudo **em dobro**; `hiddenFromSearch` relê `businesses` (`is_demo, search_hidden` cabem no select da 1ª consulta) |

### `force-dynamic`
- **Painel:** o `layout.tsx:19` já torna tudo dinâmico. Os `force-dynamic` das 13 páginas são **redundantes, sem
  custo**. Não precisam de mudança.
- **Desnecessário de fato:** `/v/[slug]` (`v/[slug]/page.tsx:14`). A disponibilidade de horários vem do cliente
  (`get_available_slots`), então a página pode virar ISR (ex.: `revalidate = 60`, mais `revalidatePath` nas actions que
  salvam vitrine/serviços/equipe/horários), lendo com o cliente público sem cookies (`lib/supabase/public.ts`).
  `/para/[nicho]` é o mesmo caso, sem o `force-dynamic` mas usando cookies.
- **Necessários:** `/espacos` e `/explorar/[nicho]` (usam `searchParams`), `/cadastro` e `/redefinir-senha`
  (leem o usuário), `/v/[slug]/avaliar/[id]`, `/genix`, rotas de API.

## 3. Índices

O que existe cobre bem as consultas principais:
- **Agenda:** `idx_bookings_agenda (business_id, booking_date, start_time)`.
- **Status:** `idx_bookings_status`.
- **Clientes:** `idx_customers_business_name`, `unique (business_id, phone)` e `idx_bookings_customer`.
- **Caixa e avaliações:** `idx_cash_business_date` e `idx_reviews_business`.
- **Vitrine:** `services`/`professionals` parciais por `active`, PK de `business_hours`, slug `unique`.

| Faltando / fraco | Consulta afetada | Sugestão (não executada) | Ganho hoje |
|---|---|---|---|
| `combo_items (business_id)` | vitrine e agenda filtram `combo_items` por `business_id`; só há PK `(combo_id, service_id)` e índice por `service_id`, o que leva a seq scan | `create index if not exists idx_combo_items_business on combo_items (business_id);` | baixo (tabela pequena), cresce com o uso |
| `bookings (business_id, professional_id, booking_date)` | agenda filtrada por profissional / login `staff`; `get_available_slots` | `create index if not exists idx_bookings_prof_date on bookings (business_id, professional_id, booking_date);` | baixo hoje, médio com equipes grandes |
| `professionals (business_id, user_id)` | `my_professional_id()` (chamada pelas policies **por linha**) e `getAdminContext` | `create index if not exists idx_professionals_user on professionals (business_id, user_id) where user_id is not null;` | baixo (o parcial por `active` já ajuda) |
| busca `ilike '%…%'` em `customers.name` | busca de Clientes | trigram/`unaccent`, que já está no roadmap (`name_search`) | só com milhares de clientes |

**Conclusão:** com o volume da fase de testes, índice **não** é o gargalo. O conjunto acima é prevenção barata.

## 4. Funções SQL chamadas por linha (RLS)

Todas as funções de apoio são `language sql stable **security definer**`. Funções `security definer` **não são
"inlined"** pelo planejador. Elas recebem a coluna da linha (`business_id`), e o padrão `(select fn())` não se aplica
direto, porque o argumento muda a cada linha. Na prática, **cada linha lida dispara 1 ou mais subconsultas**:

| Tabela / policy | Por linha | Arquivo |
|---|---|---|
| `bookings` "ve agendamentos" | `sees_whole_agenda(business_id)` → `member_role_of`; se falso, `can_manage_booking` → mais 2× `member_role_of` + `my_professional_id` | `10_papeis_equipe.sql:80` |
| `customers` "ve clientes" | `can_see_customer(id, business_id)` → `sees_whole_agenda`; para staff, `exists` em bookings + `my_professional_id` | `14_clientes.sql:184` |
| `booking_items` | `exists (bookings …)` + as mesmas funções | `31_editar_agendamento.sql:63` |
| `cash_entries` (escrita) | `member_role_of` + `access_tier` | `10_papeis_equipe.sql:151-161` |
| `customer_summary(bid)` | é `stable` **sem** `security definer`, então aplica a RLS de `bookings` a cada agendamento do espaço **e** a de `booking_items` a cada item do `lateral` | `31_editar_agendamento.sql:506` |

**Correção proposta (migration):** como **1 login = 1 espaço**, criar `my_business_id()` (`stable security definer`, sem
argumento) e reescrever as policies de leitura como `business_id = (select my_business_id()) and (select my_role()) in (…)`.
Assim o Postgres avalia **uma vez por consulta** (InitPlan), e não por linha. Para staff, `professional_id = (select my_professional_id_cur())`.
`customer_summary` pode virar `security definer` com o filtro de papel explícito (o mesmo que a policy faz).

**Ganho estimado:** hoje é pequeno, porque são poucas linhas e o tempo é dominado pela rede. Cresce de forma
linear: com ~10 mil agendamentos, `customer_summary` e a visão mês da agenda passam a gastar dezenas a centenas
de ms só nas funções. **Medir antes de decidir**, com o roteiro abaixo.

### Roteiro de medição para o SQL Editor (somente leitura, termina em `rollback`)

Troque `<UUID_DO_DONO>` pelo `user_id` de uma conta sua (owner) e `<UUID_DO_ESPACO>` pelo `business_id` dela.
Para o teste valer, use um espaço com **pelo menos ~1.000 agendamentos** (veja a contagem no passo 0). Com poucas
linhas, a diferença some no ruído.

```sql
-- 0) volume (fora da transação, leitura simples)
select count(*) from bookings where business_id = '<UUID_DO_ESPACO>';

begin;
-- simula o usuário logado, exatamente como o PostgREST faz
set local role authenticated;
set local request.jwt.claims = '{"sub":"<UUID_DO_DONO>","role":"authenticated"}';

-- A) como o painel lê hoje (RLS atual, funções por linha)
explain (analyze, buffers, verbose)
select id, booking_date, start_time, status, price
from bookings
where business_id = '<UUID_DO_ESPACO>'
  and booking_date between current_date - 30 and current_date + 30
order by booking_date, start_time;

-- B) customer_summary (o mais pesado da tela Clientes)
explain (analyze, buffers, verbose)
select * from customer_summary('<UUID_DO_ESPACO>');

rollback;
```

Para o "depois" sem criar nada, rode a mesma consulta como `postgres` (sem `set local role`, ou seja, **sem RLS**),
dentro de `begin … rollback`. A diferença entre A com RLS e A sem RLS é o **teto** do que a reescrita das policies
pode ganhar:

```sql
begin;
explain (analyze, buffers)
select id, booking_date, start_time, status, price
from bookings
where business_id = '<UUID_DO_ESPACO>'
  and booking_date between current_date - 30 and current_date + 30
order by booking_date, start_time;
rollback;
```

**Como ler o resultado:**
- Compare o `Execution Time` de A (com RLS) com o da versão sem RLS.
- No plano com `verbose`, o `Filter:` do `Index Scan` mostra `sees_whole_agenda(business_id) OR can_manage_booking(...)`.
  Isso indica avaliação **por linha**. `Rows Removed by Filter` e o tempo do nó dizem o custo.
- Na versão reescrita (depois da migration), deve aparecer `InitPlan 1 (returns $0)` uma única vez, e o filtro vira
  uma comparação simples com `$0`.
- Regra prática: se A com RLS custar **menos de 2× a versão sem RLS** e menos de ~20 ms, a migration das policies
  pode esperar.

## 5. Relatório por impacto × esforço

Ganho estimado em tempo de servidor por navegação, considerando ~165 ms por ida ao Supabase.

### A) Rápidas e seguras (só código, sem migration)

| # | Achado | Ganho estimado | Esforço | Risco | Arquivos | PR sugerido |
|---|---|---|---|---|---|---|
| A1 | **Contexto do painel em menos idas:** juntar `business_members`+`businesses`+`professionals` numa consulta só (embed `professionals!inner`/filtro por `user_id`) e iniciar `getPlanContext` em paralelo com ela | **−1 a −2 idas (≈170–330 ms) em todas as páginas do painel** | baixo | baixo | `lib/admin.ts`, `lib/plan.ts` | PR 1 "painel: menos idas" |
| A2 | **Layout:** os 3 awaits da matriz (limite e contagem, WhatsApp, avulsa vencida) num `Promise.all` | **−2 idas (≈330 ms) para o dono** | baixo | baixo | `admin/(painel)/layout.tsx:36-71` | PR 1 |
| A3 | **Início:** `me`, dashboard+onboarding e `autoConfirmed` numa só rodada | −2 idas (≈330 ms) | baixo | baixo | `admin/(painel)/page.tsx:96-121` | PR 1 |
| A4 | **Vitrine:** `React.cache` em `loadVitrine` + `is_demo, search_hidden` no select principal (sem `hiddenFromSearch`) | ~19 → ~9 consultas por visita; menos carga no Supabase; ~0–170 ms | baixo | baixo | `v/[slug]/page.tsx:21-101` | PR 2 "vitrine" |
| A5 | **Agenda:** `booking_package_info` e `professional_services` em paralelo; com `?calendario=`, reaproveitar services/pros/combo_items | −1 ida (≈170 ms); −4 consultas com o calendário aberto | baixo | baixo | `lib/agenda-data.ts:86-104`, `agenda/page.tsx:160` | PR 1 |
| A6 | **recharts sob demanda** (`next/dynamic` com `ssr:false` + skeleton) | Financeiro **297 → ~185 kB** First Load | baixo | baixo | `components/admin/financeiro/revenue-chart.tsx` e quem o importa | PR 3 "JS sob demanda" |
| A7 | **supabase-js fora do pacote inicial:** `EmailVerifyBanner` e `review-form` chamando server action; no `booking-wizard`, `import()` do client só quando abre o assistente (ou slots por server action/route) | **−~67 kB gz** no painel e na vitrine | médio | baixo-médio (assistente e Turnstile precisam de reteste) | `email-verify-banner.tsx`, `booking-wizard.tsx`, `review-form.tsx` | PR 3 |
| A8 | Diálogos pesados da Agenda (`new-booking-dialog`, `reschedule-dialog`) com `next/dynamic`, carregando ao abrir | −10 a −25 kB na Agenda | baixo | baixo | `components/admin/agenda/*` | PR 3 |
| A9 | **Vitrine em ISR** (`revalidate = 60` + `revalidatePath('/v/'+slug)` nas actions de configurações/serviços/equipe/horários; cliente público sem cookies). O mesmo vale para `/para/[nicho]` | vitrine **~800 ms → ~170 ms** (como a `/`) em visitas com cache | médio | médio (vitrine desatualizada se faltar algum `revalidatePath`; plano/selo e bloqueados vêm de `public_plan_info`) | `v/[slug]/page.tsx`, `lib/supabase/public.ts`, actions do painel | PR 4 "vitrine ISR" |
| A10 | **Middleware só onde precisa:** `matcher` restrito a `/admin`, `/genix`, `/cadastro`, `/redefinir-senha`, `/auth`, `/demo`; e/ou `getClaims()` no lugar de `getUser()` no contexto (validação local do JWT, **só se o projeto usar chaves de assinatura assimétricas** no Supabase) | −1 ida (≈170 ms) em páginas públicas com usuário logado; −1 ida no painel com `getClaims` | médio | **médio** (renovação de sessão e redirecionamentos do login; conferir as chaves JWT no painel do Supabase antes) | `middleware.ts`, `lib/supabase/middleware.ts`, `lib/admin.ts` | PR 5, separado, com teste de login/logout/expiração |

**Ganho somado de A1–A3 + A5:** de 4 a 6 idas a menos para o dono, cerca de **−0,6 a −0,9 s por navegação no painel**
(de ~1,4 s para ~0,6–0,8 s no Início).

### B) Precisam de migration

| # | Achado | Ganho estimado | Esforço | Risco | Migration | PR sugerido |
|---|---|---|---|---|---|---|
| B1 | **`get_panel_context()` numa só RPC** (`security definer`): papel, espaço, `professional_id`, `access_tier`, `plan_kind`, assinatura e os 3 avisos da matriz | painel com **~2 idas fixas** (getUser + RPC): mais −1 a −2 idas além de A1–A3 | médio | baixo-médio (aditiva; o código cai no caminho atual se a função não existir) | nova `36_contexto_painel.sql`, aditiva | PR 6 (depois do PR 1) |
| B2 | **Policies de leitura com InitPlan:** `my_business_id()`/`my_role()` sem argumento e `(select …)` nas policies de `bookings`, `customers`, `booking_items` e `cash_entries` | hoje pequeno; **linear com o volume**; medir antes com o roteiro da seção 4 | médio-alto | **alto** (RLS é a fonte da verdade; testar os 4 papéis + demo; reversível com o `drop/create` das policies antigas no rollback) | nova migration aditiva + script de reversão | PR 7, só se a medição justificar |
| B3 | **`customer_summary`** como `security definer` com o filtro de papel embutido, e opcionalmente com `p_ids uuid[]` para resumir só os clientes mostrados | Clientes: deixa de aplicar RLS em cada agendamento e item | baixo-médio | médio (replicar exatamente a regra do staff) | `create or replace function` | junto com B2 ou sozinho |
| B4 | **Índices preventivos:** `combo_items(business_id)`, `bookings(business_id, professional_id, booking_date)`, `professionals(business_id, user_id)` | baixo hoje; evita seq scan com o crescimento | baixo | baixo (`create index if not exists`; no Supabase, usar `concurrently` fora de transação se a tabela já for grande) | aditiva, reversível com `drop index` | PR 8, pode ir junto do B1 |

### Ordem sugerida dos PRs
1. **PR 1, painel com menos idas** (A1, A2, A3, A5): maior ganho percebido, só código, baixo risco.
2. **PR 2, vitrine sem consultas em dobro** (A4).
3. **PR 3, JS sob demanda** (A6, A7, A8).
4. **PR 4, vitrine em ISR** (A9).
5. **PR 6 + 8, RPC de contexto + índices** (B1, B4).
6. **PR 5, middleware/getClaims** (A10): à parte, por mexer em sessão.
7. **PR 7, RLS** (B2, B3): só depois da medição no SQL Editor.

## Anexos

- Saída completa do build e tempos brutos:
  `C:\Users\ADM\AppData\Local\Temp\claude\352bb00507f5a0b1\e66c8bbd-afe8-431a-b8af-16d3a01e2141\scratchpad\build.txt`
  e `C:\Users\ADM\AppData\Local\Temp\claude\352bb00507f5a0b1\e66c8bbd-afe8-431a-b8af-16d3a01e2141\scratchpad\tempos.txt`.
- **Limites desta medição:**
  - Foi feita só como `viewer`; o dono real tem 3 consultas a mais no layout.
  - Localhost em Windows → Supabase. Na Vercel (`gru1`, se a região do projeto for São Paulo), a ida ao Supabase
    pode ser bem menor, e o ganho absoluto de cada ida economizada cai na mesma proporção, mas a ordem das
    prioridades não muda.
  - O volume da demo é pequeno, então o custo de RLS e de índices não aparece.
