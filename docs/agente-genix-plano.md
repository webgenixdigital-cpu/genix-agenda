# Agente Genix (Gemini): plano da nova edição

> Documento de planejamento. Código da Nix ainda não está no repositório; as Metas (migration 58) vêm primeiro, no `feat/metas`.
> Base: `main` em `4562577` (PR #53), já com os novos planos (52a/52b).
> Regra do projeto: uma fase = um branch = um PR; o merge é sempre do Leonardo.

---

## 1. O que muda em relação à primeira versão

| | Versão 1 (patch de 18/11, não aplicado) | Nova edição |
|---|---|---|
| Papel | Tira dúvidas de uso (FAQ) | Assistente de **gestão e agendamentos** |
| Dados da conta | Não acessa | Lê agenda, clientes, caixa, pendências e metas **do próprio espaço** |
| Ações | Nenhuma | Propõe lançamentos, confirmações, agendamentos; **a pessoa confirma com um toque** |
| Proatividade | Só responde | Abre com um resumo do dia e sugestões ("3 pagamentos pendentes", "faturamento 18% abaixo do mês passado") |
| Base de conhecimento | `ajuda.ts` + planos fixos no texto | `ajuda.ts` + planos lidos da tabela `plans` (nada de preço no código) |
| Quem usa | Qualquer login | Matriz e Recepção, **só no Equipe pago** (e nos últimos 3 dias do teste); cada um só vê o que o papel permite |

O que se aproveita da versão 1: a rota `/api/chat-bot`, o componente `SupportChat` (botão flutuante + folha lateral), o módulo de contexto a partir de `src/content/ajuda.ts`, a validação de entrada e o tratamento de erros (429/400/502/503).

---

## 2. Estrutura do app (mapa para o agente)

### 2.1 Stack
Next.js 14.2 (App Router, `src/`) · React 18 · TypeScript strict · Tailwind 3 + shadcn 2.3 · Supabase (Postgres + RLS + Auth, `@supabase/ssr`) · Asaas · Resend · Vercel. **Novo:** `@google/genai` (modelo Flash estável em `GEMINI_MODEL`; o 2.5 Flash foi descontinuado).

### 2.2 Telas do painel (`src/app/admin/(painel)/`)
| Rota | O que é | Papéis | Plano |
|---|---|---|---|
| `/admin` | Início (quadros do dia) | todos | todos |
| `/admin/agenda` | Agenda dia/semana/mês, novo agendamento, encaixe, remarcar, concluir, pagamento pendente | owner, reception, staff (própria) | todos (encaixe/recorrência conforme plano) |
| `/admin/clientes` (+ `[id]`) | Lista e ficha do cliente, pacotes | owner, reception, staff (atendidos) | todos |
| `/admin/lembretes` | Fila manual wa.me | owner, reception | conforme plano |
| `/admin/bloqueios` | Folgas, feriados, almoço | owner, staff | pago |
| `/admin/servicos` | Serviços, combos, pacotes | owner | combos/pacotes pago |
| `/admin/profissionais` | Equipe, acessos, comissão | owner | Equipe |
| `/admin/financeiro` | Caixa (+ `faturamento`, `contador`) | owner | Básico em diante (novo briefing) |
| `/admin/ganhos` | Meus ganhos | staff | Equipe |
| `/admin/assinatura` | Plano, cobrança, cupom, indicação | owner | — |
| `/admin/configuracoes` | Vitrine, horários, WhatsApp, mensagens | owner | — |

### 2.3 Funções de dados já existentes (o agente reusa, não duplica)
| Área | Leitura | Escrita (server action) |
|---|---|---|
| Contexto/papel | `getAdminContext()`, `getEditorContext()` (bloqueia demo), `requireRoles()` — `lib/admin.ts` | — |
| Plano | `getPlanContext()`, `hasTeamFeatures()` — `lib/plan.ts` | — |
| Início | `loadHome()` — `lib/dashboard-data.ts` | — |
| Agenda | `loadAgenda()`, `loadPendingPayments()` — `lib/agenda-data.ts`; `listManualSlots`, `searchCustomers`, `lookupCustomer` | `createManualBooking`, `updateBookingStatus`, `completeBooking`, `registerBookingPayment`, `rescheduleBooking` — `agenda/actions.ts` |
| Caixa | `loadCashEntries()`, `loadCashSummary()`, `loadCashMonthly()` — `lib/cash-data.ts`; períodos em `lib/cash-period.ts` | `addCashEntry` — `financeiro/actions.ts` |
| Faturamento | `loadBilling()`, `loadLimits()` — `lib/faturamento-data.ts` | — |
| Ajuda | `AJUDA` — `src/content/ajuda.ts` | — |

**Segurança:** toda leitura usa o `createClient()` com a sessão da pessoa. A RLS do Supabase já filtra por espaço e papel, então o agente **nunca** usa `lib/supabase/admin.ts` (service role).

---

## 3. Arquitetura do agente

```
SupportChat (navegador)
   │  POST /api/agente { message, history, conversationId? }
   ▼
route.ts ──► getAdminContext() ─ papel + plano + espaço
   │         checa cota diária (ai_usage)
   │         monta systemInstruction (persona + regras + ajuda + planos do banco + data/fuso)
   │         declara só as ferramentas permitidas p/ papel e plano
   ▼
Gemini (function calling) ──► pede ferramenta ──► executor roda a função de leitura (RLS)
   ▲                                              └─ devolve JSON resumido
   └──────────── laço até 5 rodadas ──────────────┘
   │
   ▼ resposta: { reply, proposals?: Acao[] }
SupportChat mostra texto + cartões “Confirmar / Cancelar”
   │  toque em Confirmar → chama a server action existente (getEditorContext)
   ▼
Resultado volta ao chat (“Lançado no caixa ✓”)
```

### 3.0 Acesso por plano — assistente **Nix** (decidido 20/11/2026)
| Situação | Nix |
|---|---|
| **Equipe pago** (assinatura, cortesia `plan_grants` equipe ou antigo Completo) | Liberada, **sem cota diária visível** |
| Teste de 15 dias do Equipe (conta nova) | Liberada **só nos últimos 3 dias do teste**, com cota diária |
| Grátis (6 meses), inclusive os últimos 3 dias | **Não libera** (decidido 20/11: a janela gratuita é só a do teste) |
| Restante do teste · Grátis · Básico · Profissional | Botão com cadeado + “A Nix está disponível no plano Equipe” (padrão `LockedFeature`); não chama a API |

Regra única no servidor, `agentAccess(plan, hoje)` em `lib/agente/access.ts`, usada pela rota (403) e pelo layout (cadeado ou chat); repetida no banco em `ai_usage_hit`. Usa `plan.status`/`trialDaysLeft` (já no `main`).
Na janela gratuita valem as travas do plano naquele momento (no teste = Equipe, então caixa e metas funcionam).

**Papéis:** Matriz tudo · Recepção tudo menos **caixa** (metas sim) · Profissional (`staff`) não usa · Demo não usa.

### 3.1 Regra de ouro: o agente nunca grava sozinho
Ferramentas de **leitura** rodam direto. Ferramentas de **escrita** só devolvem uma **proposta** (`{ tipo, dados, resumo }`). A gravação acontece quando a pessoa toca em **Confirmar**, pela mesma server action que a tela usa: mesmas validações, mesma trava da demo, mesmo histórico (`booking_events`). Nenhuma regra de negócio nova fica escondida no agente.

### 3.2 Ferramentas (function declarations)

**Leitura**
| Ferramenta | Reusa | Papéis | Plano |
|---|---|---|---|
| `resumo_do_dia(data?)` | `loadHome` | owner, reception | todos |
| `consultar_agenda(de, ate, profissional?)` | `loadAgenda` | owner, reception | todos |
| `horarios_livres(servico, data)` | `listManualSlots` | owner, reception | todos |
| `buscar_cliente(nome_ou_whatsapp)` | `searchCustomers` | owner, reception | todos |
| `pagamentos_pendentes()` | `loadPendingPayments` | owner, reception | pago |
| `resumo_caixa(de, ate)` | `loadCashSummary` | owner | Básico+ |
| `comparar_periodos(periodo_a, periodo_b)` | `loadCashSummary` ×2 + contagem de atendimentos | owner | Básico+ |
| `faturamento_mensal(ate)` | `loadCashMonthly` | owner | Básico+ |
| `consultar_metas()` | `goals_with_progress` (58) | owner, reception | Profissional, Equipe |
| `ajuda_do_sistema(tema)` | `AJUDA` | todos | todos |

**Escrita (só proposta)**
| Ferramenta | Confirma por | Papéis |
|---|---|---|
| `propor_lancamento_caixa(tipo, categoria, valor, forma, data, descricao)` | `addCashEntry` | owner |
| `propor_confirmar_agendamento(id)` | `updateBookingStatus` | owner, reception |
| `propor_registrar_pagamento(id, forma, valor)` | `registerBookingPayment` | owner, reception |
| `propor_agendamento(cliente, servico, data, hora, profissional)` | `createManualBooking` | owner, reception |
| `propor_meta(tipo, valor, periodo, profissional?)` | `saveGoal` (`metas/actions.ts`) | owner, reception |

Fora do escopo inicial (exigem mais cuidado): cancelar, remarcar, excluir lançamento, mexer em assinatura/configurações, mandar WhatsApp.

### 3.3 Proatividade
- **Ao abrir o chat:** o servidor chama `resumo_do_dia` e o agente cumprimenta com 2–3 pontos acionáveis (pedidos a confirmar, pagamentos pendentes, aniversariantes, comparação com a semana passada).
- **Comparações:** ao comparar períodos, ele aponta a maior variação e uma ação concreta ("terças caíram 30%: que tal abrir encaixes ou mandar lembrete aos clientes sumidos?").
- **Metas:** mostra o progresso ("faltam R$ 1.240 em 9 dias úteis, cerca de R$ 138/dia").
- Sem notificação ou e-mail por enquanto: proativo só dentro do chat.

### 3.4 Instrução de sistema (resumo)
Você é a **Nix**, assistente de gestão do Genix Agenda para `{nome do espaço}`; hoje é `{data}` (fuso do espaço); quem fala é `{papel}`, no plano `{plano}`. Fala pt-BR, cordial e objetivo. Usa números só das ferramentas (nunca inventa). Para gravar, propõe e espera a confirmação. Recurso fora do plano: explica e indica a Assinatura. Pedido fora do papel: diz que só a matriz pode. Nada de dados de saúde. Não pede senha nem cartão.

---

## 4. Banco (novas migrations, aditivas e reversíveis)

### 60_agente_uso.sql (Fase 1; o 57 ficou com “trocar serviço principal” e o 59 com a vitrine)
```sql
create table public.ai_usage (
  business_id uuid not null references businesses(id) on delete cascade,
  day date not null,
  requests int not null default 0,
  tokens int not null default 0,
  primary key (business_id, day)
);
alter table public.ai_usage enable row level security;
create policy ai_usage_read on public.ai_usage for select
  using (is_business_owner(business_id));
-- incremento atômico, chamado pela rota (security definer, confere o membro)
-- função ai_usage_hit(p_business uuid, p_tokens int) returns int  (devolve o total do dia)
-- rollback: drop function ai_usage_hit; drop table ai_usage;
```
Cota: **só na janela gratuita** (últimos 3 dias do teste): 20 pedidos/dia por espaço (ajustável na tabela `plans`, coluna `ai_daily_limit`). No Equipe pago não há cota visível; fica só um teto técnico anti-abuso alto (ex.: 500/dia), que a pessoa normal nunca atinge, para proteger a conta do Google de um robô ou de um login vazado.

### 58_metas.sql (1ª entrega, `feat/metas`, antes da Nix)
Arquivo completo em `supabase/migrations/58_metas.sql`. Resumo:
- `business_goals` (`kind` faturamento | atendimentos | ticket_medio | clientes_novos, `target > 0`, período até 366 dias,
  `professional_id` só no Equipe, `updated_at` com `set_updated_at()`).
- RLS só de leitura (owner, reception, viewer + `plan_allows(bid,'profissional')`); escrita só por `save_goal` /
  `delete_goal`, que conferem papel, plano e que a meta é do espaço (`where id = p_id and business_id = p_business`,
  senão `NAO_ENCONTRADO`: as funções são `security definer` e passam por cima da RLS).
- `goals_with_progress(bid)`: cada meta com o realizado, **só totais** (a recepção vê o total, nunca os lançamentos).
  - faturamento = entradas do caixa pela **data do pagamento** (igual ao Financeiro);
  - atendimentos = concluídos pela **data do atendimento** (atendido 30/11 e pago 02/12 → atendimento em novembro,
    dinheiro em dezembro);
  - ticket médio = média das entradas ligadas a atendimento;
  - clientes novos = 1º atendimento concluído do espaço dentro do período;
  - meta de profissional: só entradas de atendimentos dele (sem venda de pacote/produto).
- Ritmo em dias corridos, contando hoje (folgas ficam para depois).

A tela de Metas (`/admin/metas`, fora do Financeiro para a Recepção poder abrir; planos **Profissional e Equipe**) existe por si só; a Nix só a consulta e propõe metas.

### 61_agente_conversas.sql (opcional, Fase 5)
`ai_conversations` / `ai_messages` para guardar o histórico entre sessões, com retenção de 90 dias. Até lá o histórico vive só na página.

---

## 5. Configuração (passo a passo)

### 5.1 Chave do Gemini
1. Em https://aistudio.google.com → **Get API key**, crie a chave **num projeto do Google Cloud com faturamento ativo** (veja 5.2).
2. `.env.local`: `GEMINI_API_KEY=...` (nunca `NEXT_PUBLIC_`).
3. Vercel → Settings → Environment Variables → `GEMINI_API_KEY` (Production e Preview) → **redeploy**.
4. Opcional: `AGENTE_ENABLED=1` como chave liga/desliga, no mesmo padrão do `WHATSAPP_SEND_ENABLED`. Sem ela, o botão não aparece.

### 5.2 Privacidade (LGPD): ponto de atenção
- O agente manda ao Google nomes de clientes, horários e valores. No **nível gratuito** da API Gemini, o Google pode usar o conteúdo para melhorar os produtos dele; no **nível pago**, não usa. Para dados de clientes, use **só o nível pago**. Confira os termos atuais da API Gemini antes de ligar.
- Minimizar: as ferramentas devolvem só o necessário (primeiro nome, serviço, hora, valor); nada de telefone completo, CPF/CNPJ ou dado fiscal.
- Atualizar Termos/Privacidade: mencionar o assistente de IA e o Google como suboperador.

### 5.3 Custo
`gemini-2.5-flash` é barato, mas cada conversa com ferramentas consome vários pedidos. A cota diária (`ai_usage`) e o limite de 5 rodadas por mensagem seguram o custo. Acompanhe pelo console do Google Cloud nas primeiras semanas.

---

## 6. Fases (um PR cada)

| Fase | Branch | Entrega | Banco |
|---|---|---|---|
| **0. Metas** | `feat/metas` | Tela `/admin/metas` (Profissional e Equipe; matriz e recepção; meta por profissional no Equipe) | 58 |
| **1. Base** | `feat/agente-base` | Rota `/api/agente` + `NixChat` (escrito do zero: a versão 1 não estava no repositório), só owner/reception, `agentAccess` (Equipe pago + 3 últimos dias do teste), cadeado + CTA nos outros planos, planos lidos de `plans`, cota diária, `AGENTE_ENABLED`, escondido na demo | 60 |
| **2. Leitura** | `feat/agente-leitura` | Function calling com as ferramentas de leitura; resumo ao abrir; comparação de períodos | — |
| **3. Ações** | `feat/agente-acoes` | Propostas + cartões de confirmação (caixa, confirmar, pagamento, agendamento) | — |
| **4. Metas na Nix** | `feat/agente-metas` | Ferramentas `consultar_metas`/`propor_meta` sobre a 58 | — |
| **5. Memória** | `feat/agente-historico` | Histórico salvo entre sessões | 61 |

Cada fase: `npx tsc --noEmit` + `npm run lint` + `npm run build` + `test:responsivo` no painel (o botão flutuante não pode cobrir alvos nem causar rolagem lateral) + `data-testid` em tudo + ponto de Ajuda "Assistente" em `ajuda.ts`.

**Ordem:** o PR de novos planos já está no `main`. As Metas (Fase 0) vêm primeiro; a Fase 1 pode começar em seguida.

---

## 7. Esqueleto de código da Fase 1–2

### Parte A — `src/lib/agente/tools.ts` (declarações + permissões)
```ts
import { Type, type FunctionDeclaration } from "@google/genai";
import type { AdminContext } from "@/lib/admin";
import type { PlanContext } from "@/lib/plan";

type Tool = {
  decl: FunctionDeclaration;
  roles: AdminContext["role"][];
  paid?: boolean; // exige plano com financeiro
};

export const TOOLS: Record<string, Tool> = {
  resumo_caixa: {
    roles: ["owner"],
    paid: true,
    decl: {
      name: "resumo_caixa",
      description: "Entradas, saídas e saldo do caixa entre duas datas (AAAA-MM-DD).",
      parameters: {
        type: Type.OBJECT,
        properties: { de: { type: Type.STRING }, ate: { type: Type.STRING } },
        required: ["de", "ate"],
      },
    },
  },
  // consultar_agenda, pagamentos_pendentes, comparar_periodos...
};

export function toolsFor(ctx: AdminContext, plan: PlanContext) {
  // a rota só chega aqui se agentAccess(plan, hoje) liberou (Equipe ou janela do Grátis)
  return Object.entries(TOOLS)
    .filter(([, t]) => t.roles.includes(ctx.role) && (!t.paid || plan.tier !== "gratis"))
    .map(([name, t]) => ({ name, decl: t.decl }));
}
```

### Parte B — `src/lib/agente/executor.ts` (roda a ferramenta com RLS)
```ts
import { createClient } from "@/lib/supabase/server";
import { loadCashSummary } from "@/lib/cash-data";
import type { AdminContext } from "@/lib/admin";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function runTool(name: string, args: Record<string, unknown>, ctx: AdminContext) {
  const db = createClient(); // sessão da pessoa: a RLS filtra
  switch (name) {
    case "resumo_caixa": {
      const de = String(args.de), ate = String(args.ate);
      if (!ISO.test(de) || !ISO.test(ate)) return { erro: "Datas inválidas" };
      return loadCashSummary(db, ctx.business.id, { de, ate } as never);
    }
    default:
      return { erro: "Ferramenta desconhecida" };
  }
}
```

### Parte C — laço do function calling em `src/app/api/agente/route.ts`
```ts
const tools = toolsFor(ctx, plan);
let contents: Content[] = [...historico, { role: "user", parts: [{ text: message }] }];

for (let rodada = 0; rodada < 5; rodada++) {
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: montarInstrucao(ctx, plan, planosDoBanco),
      tools: [{ functionDeclarations: tools.map((t) => t.decl) }],
      temperature: 0.3,
    },
  });
  const chamadas = res.functionCalls ?? [];
  if (chamadas.length === 0) return NextResponse.json({ reply: res.text, proposals });

  contents.push(res.candidates![0].content!);
  for (const c of chamadas) {
    if (!tools.some((t) => t.name === c.name)) continue; // nunca roda ferramenta fora do papel/plano
    const out = c.name!.startsWith("propor_")
      ? registrarProposta(c, proposals)        // escrita: só vira cartão
      : await runTool(c.name!, c.args ?? {}, ctx);
    contents.push({ role: "user", parts: [{ functionResponse: { name: c.name, response: { out } } }] });
  }
}
```

### Parte D — cartão de proposta no `SupportChat`
```tsx
{p.tipo === "lancamento_caixa" && (
  <div className="rounded-xl border bg-card p-3 text-sm" data-testid="agente-proposta">
    <p className="font-medium">{p.resumo}</p>
    <div className="mt-2 flex gap-2">
      <Button className="h-11" data-testid="agente-confirmar"
        onClick={async () => { const r = await addCashEntry(p.dados); if (!r) return; /* toast + mensagem */ }}>
        Confirmar
      </Button>
      <Button variant="outline" className="h-11" data-testid="agente-cancelar">Cancelar</Button>
    </div>
  </div>
)}
```

---

## 7b. Ajustes da conferência com o código (20/11)
- **Janela do teste:** no `trialing`, o `plan_kind` já devolve `'equipe'`, então a Nix tem regra própria (rota, layout e `ai_usage_hit`): Equipe pago liberado; `status = 'trialing'` só com `trialDaysLeft ≤ 3`. Conferir em `src/lib/plan.ts:75` se “3 últimos dias” = 3/2/1 ou 2/1/0.
- **Cotas no banco:** linhas do Equipe em `plans` ganham `ai_daily_limit` (500, teto técnico) e `ai_trial_daily_limit` (20); Básico e Profissional com 0.
- **Metas × recepção:** a RLS barra `cash_entries` para a recepção, então `goal_progress` é `security definer` e devolve só os totais (realizado × meta), nunca os lançamentos. Efeito: a recepção vê o total faturado do período da meta.
- **Trava das Metas:** `plan_allows(bid, 'profissional')` no banco, não só na tela.
- **Ordem:** Metas não dependem da Nix e podem vir antes. O PR de novos planos já está no `main`.
- **Migrations:** 57 (trocar serviço) e 59a/59b (vitrine) foram usadas por outros PRs; a Nix fica com 60 (uso) e 61 (conversas). Metas = 58.

## 8. Decisões
- ✅ Nome: **Nix**.
- ✅ Só no **Equipe pago**; no teste de 15 dias, só nos **últimos 3 dias**, com cota diária.
- ✅ Cota só na janela gratuita; no Equipe pago, sem cota (teto técnico anti-abuso).
- ✅ Recepção usa, com metas e sem caixa. Profissional (`staff`) não usa.
- ✅ Metas: faturamento, atendimentos, ticket médio, clientes novos; tela nos planos **Profissional e Equipe**; **meta por profissional só no Equipe**.
- ✅ Metas: faturamento vem das entradas do caixa; cliente novo = 1º atendimento concluído no período; a recepção vê só os totais.
- ✅ Metas saem antes da Nix (PR próprio, migration 58).
- ✅ Cortesia Equipe (`plan_grants`) e antigo Completo (`mensal`/`anual`) contam como Equipe pago e recebem a Nix.
- ✅ Grátis de 6 meses **não** libera a Nix: a janela gratuita é só a dos últimos 3 dias do teste.
