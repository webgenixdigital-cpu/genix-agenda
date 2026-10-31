# Genix Agenda — manual do projeto

> Leia este arquivo inteiro antes de qualquer tarefa. Ele registra as decisões de produto,
> as regras de segurança e os padrões do código. Em caso de dúvida, **pergunte antes de mudar**.

## 1. O que é

SaaS brasileiro (pt-BR) de **vitrine digital + agenda online + gestão** para quem atende com hora marcada:
beleza, estética e outros profissionais. Produto da Genix Sistemas Integrativos (Web Genix Digital).

- Produção: https://genixagenda.com.br (Vercel) · Repositório: github.com/webgenixdigital-cpu/genix-agenda
- Posicionamento: "Sua agenda cheia, sem viver no WhatsApp."
- Dono do produto: Leonardo. Prefere instruções passo a passo, uma etapa por vez, com aprovação antes de seguir.

## 2. Stack (não mudar sem justificativa e aprovação)

| Item | Versão / detalhe |
|---|---|
| Next.js | **14.2.x**, App Router, `src/` (migração para versão mais nova é etapa futura planejada) |
| React / TS | React 18, TypeScript strict |
| UI | Tailwind **3**, shadcn **2.3.0** (componentes em `src/components/ui`), lucide-react **1.x** |
| Banco/Auth | Supabase (Postgres + RLS + Auth), `@supabase/ssr` |
| Outros | recharts, sonner, date-fns, qrcode.react |
| Pagamentos | Asaas (assinaturas: Pix e cartão; boleto desativado por decisão) |
| E-mail | Resend via SMTP do Supabase, remetente `agenda@genixagenda.com.br` |
| Hospedagem | Vercel, domínio `genixagenda.com.br` (o `www` redireciona para o domínio sem www) |

Comandos: `npm run dev` · `npx tsc --noEmit` · `npm run lint` · `npm run build`.
**Antes de todo commit:** `tsc` e `lint` sem erros.

## 3. Variáveis de ambiente

| Variável | Onde | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador + servidor | públicas |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor** | usada em `src/lib/supabase/admin.ts` (webhook, convites) |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | só servidor | login da demonstração pública (`/demo`) |
| `ASAAS_API_URL` / `ASAAS_API_KEY` / `ASAAS_WEBHOOK_TOKEN` | só servidor | local = **sandbox**; Vercel = produção |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | navegador | Cloudflare Turnstile (site key pública); local usa as chaves de teste da Cloudflare |
| `TURNSTILE_SECRET_KEY` | **só servidor** | valida o token na server action da vitrine; local usa a secret de teste da Cloudflare |
| `CRON_SECRET` | **só servidor** | protege `/api/whatsapp/tick`; o mesmo valor fica no Vault do Supabase (`supabase/manual/whatsapp-cron.sql`) |
| `WHATSAPP_SEND_ENABLED` | só servidor | `1` liga os envios automáticos; sem ela nada sai (local fica desligado: o banco é o mesmo da produção) |
| `PLANS_PREVIEW` | só servidor, **só local** | `1` no `.env.local` + `npm run dev`: tabela de preços, Assinatura e actions tratam os planos novos (`gratis`, `profissional_*`, `equipe_*`) como ativos mesmo com `active = false`, para testar no sandbox do Asaas antes da 28b. Nunca liga com `NODE_ENV=production` (`next build`/`start`, Vercel); **não cadastrar na Vercel**. Lógica em `lib/plans-server.ts` |

- Nunca prefixar segredos com `NEXT_PUBLIC_`. Nunca importar `lib/supabase/admin.ts` em componente `"use client"`.
- No `.env.local`, a chave do Asaas começa com `$`: escrever `ASAAS_API_KEY=\$aact_...` (na Vercel, sem a barra).
- Local e produção usam **o mesmo banco Supabase**: testar assinatura no localhost só com contas próprias.

## 4. Decisões de produto (respeitar sempre)

- **Freemium — 3 planos** (migrations 28a/28b): toda conta nova ganha **15 dias do Equipe**; no fim do teste a oferta
  segue a equipe ativa (1 profissional → Profissional; 2+ → Equipe); sem pagamento, cai no **Grátis** (nada é apagado).
  - **Grátis** (para sempre): vitrine, agenda online com **6 agendamentos online/dia** (`plans.online_daily_limit`
    da linha `gratis`), **1 profissional**, selo "Feito com Genix Agenda", avaliações, remarcar, confirmação
    automática, ficha/histórico e a fila manual de Lembretes (wa.me). Bloqueios, Retornos, Financeiro, pacotes,
    recorrência e acessos de equipe ficam com cadeado + CTA.
  - **Profissional** (R$ 48,70/mês | R$ 487,00/ano): tudo pago para **1 profissional**, sem selo; sem acessos de equipe
    nem profissional extra.
  - **Equipe** (R$ 98,70/mês | R$ 987,00/ano): até 3 profissionais + R$ 19,90/mês (R$ 199,00/ano) por extra; acessos
    da equipe (recepção, profissional, "Meus ganhos"), comissões e salão-parceiro.
  - **Anual = 10 × mensal** ("2 meses grátis no plano anual"). Assinantes do antigo Completo (`mensal`/`anual`) contam
    como Equipe e mantêm o valor contratado.
  - Valores vêm da tabela `plans` e da função `subscription_quote` (não fixar no código).
  - Banco: `access_tier` (`completo`|`gratis`) separa pago × grátis; `plan_kind` diz qual plano; `plan_max_professionals`
    e o gatilho de `business_members` (só Equipe tem acessos) travam no banco. Acessos de equipe num plano sem equipe
    ficam **pausados**, nunca apagados.
  - Troca de plano: upgrade mensal na hora (novo valor na próxima cobrança); upgrade anual com cobrança avulsa
    proporcional; downgrade só no próximo ciclo (`subscriptions.scheduled_plan_id`).
- **Sem área da saúde nesta fase:** nada de prontuário, anamnese, alergias, medicamentos, gestação, dados clínicos.
  O segmento `psicologia_terapias` existe no banco mas **não é oferecido**. Campos de ficha técnica nunca de saúde.
  Os Termos/Privacidade publicados afirmam isso.
- **Segmentos fixos** (`beleza`, `estetica`, `outros`) e **nichos administrados pela Genix** (tabela `niches`, tela `/genix`).
  Categorias de **serviço** são livres por espaço.
- **Papéis** (`business_members.role`):
  - `owner` (Matriz): tudo.
  - `reception` (Recepção): agenda e clientes de todos; **sem** financeiro, serviços, equipe, configurações, assinatura.
  - `staff` (Profissional): só a própria agenda, bloqueios, clientes que já atendeu e "Meus ganhos". Preço/duração definidos pela matriz.
  - `viewer` (Demonstração): só leitura.
  - **1 login = 1 espaço** (índice único em `business_members.user_id`). Acessos individuais são recurso do Completo.
- **Demo pública** (`/demo`) entra no Lumina como `viewer`; ao salvar, o servidor redireciona com `?demo=bloqueado`.
- **Avaliações** próprias pós-atendimento (link único por atendimento concluído), não Google.
- **WhatsApp:** links `wa.me` (fila de um toque) + **lembrete automático beta via Z-API** (Completo, liberado pela Genix
  por espaço em `/genix?aba=whatsapp`; credenciais só no servidor; camada `lib/whatsapp/provider.ts`; relógio pg_cron →
  `/api/whatsapp/tick`). API oficial com cota mensal — etapa futura, como outra implementação do provider.
- Recebimento de **sinal via Pix** do cliente final: decisão adiada (avaliar subcontas Asaas).

## 5. Segurança e banco

- **RLS é a fonte da verdade.** Toda regra de permissão deve existir no banco, não só na tela.
- Funções de apoio: `member_role_of`, `my_professional_id`, `sees_whole_agenda`, `can_manage_booking`,
  `is_business_owner`, `access_tier` (`completo`|`gratis`), `plan_kind` (`gratis`|`profissional`|`equipe`),
  `plan_max_professionals`, `free_daily_limit`, `can_use_full_features`, `is_platform_admin`.
- Operações sensíveis via funções `security definer`: `get_available_slots`, `create_public_booking`,
  `complete_booking` (status + caixa), `create_business_for_user`, `submit_review`, `public_plan_info`.
- Trava de conflito de horário: constraint `no_overlap` em `bookings`. Caixa: 1 lançamento por atendimento.
- Clientes (`customers`) identificados por WhatsApp normalizado; trigger liga cada agendamento ao cliente.
  `booking_events` registra o histórico automaticamente (criado, confirmado, remarcado...).
- Webhook Asaas: `/api/asaas/webhook`, valida header `asaas-access-token`, idempotente (`asaas_webhook_events`).
- Migrations em `supabase/migrations` (01→17, já aplicadas). Novas: `18_...` em diante, **aditivas e reversíveis**.
  Nada destrutivo sem autorização. **Nunca rodar `supabase/seed` em produção.**

## 6. Padrões do código

- Textos da interface **em pt-BR**; moeda `brl()`, telefone `maskPhone()`, datas no fuso `America/Sao_Paulo` (`lib/dates.ts`).
- Todo botão, link, input e aba interativo com `data-testid` em kebab-case.
- Painel: páginas leem com `getAdminContext()`; páginas exclusivas usam `requireRoles([...])`;
  **server actions de escrita usam `getEditorContext()`** (bloqueia a demo).
- Server actions retornam `{ ok: true } | { ok: false; error: string }` com mensagem amigável em pt-BR.
- No cliente, depois de `await` de uma action: `if (!r) return;` (a demo redireciona e a action devolve `undefined`).
- Toque mínimo de 44 px; mobile-first; diálogos com `max-h-[92svh] overflow-y-auto`.
- Design: fundo `#FAF7F2`, texto `#1C1917`, primária terracota `#99582A`, destaque `#C47B47`/`#F2C078`;
  títulos Playfair Display, texto DM Sans (via `next/font`). WhatsApp verde `bg-whatsapp`.
- Em JSX, aspas no texto devem ser tipográficas (“ ”) — o lint barra aspas retas.

## 7. Armadilhas já conhecidas

- **lucide-react 1.x removeu ícones de marcas** (ex.: `Instagram`) e alguns aliases. Confirmar que o ícone existe.
- Asaas não segue redirecionamentos: webhook sempre em `https://genixagenda.com.br/...` (sem `www`).
- Asaas: sem chave Pix ativa, cobrança Pix vira boleto. Produção precisa da chave Pix cadastrada.
- Supabase Auth: "Confirm email" desligado (acesso livre); confirmação posterior via `signInWithOtp` + `/auth/confirm`.
  Templates (Reset, Magic Link, Invite) usam `{{ .RedirectTo }}?token_hash=...&type=...`.
- Variáveis novas na Vercel só valem após **redeploy**.

## 8. Mapa rápido

```
src/app/                     páginas públicas: / (página do profissional, com busca e nichos em destaque),
                             /espacos (diretório para clientes: ?q, ?nicho, ?seg), /explorar/[nicho], /para/[nicho],
                             /v/[slug], /v/[slug]/avaliar/[id], /cadastro, /esqueci-senha, /redefinir-senha, /termos,
                             /privacidade · /profissional → 301 para "/" (redirects no next.config.mjs)
                             rotas: /demo, /demo/sair, /auth/confirm (route.ts)
src/app/admin/login/         login do painel (page.tsx, login-form.tsx); admin/actions.ts na raiz
src/app/admin/(painel)/      layout.tsx e page.tsx (Início) na raiz; pastas com page.tsx + actions.ts:
                             agenda, clientes (+ [id]/page.tsx), lembretes, bloqueios, servicos, financeiro,
                             assinatura, configuracoes; profissionais (+ access-actions.ts);
                             ganhos (só page.tsx); onboarding (só actions.ts)
src/app/genix/               administração da plataforma (page.tsx, actions.ts, field-actions.ts)
src/app/api/asaas/webhook/   webhook de pagamento
src/components/              admin/* (por tela do painel), genix/, vitrine/, marketing/, auth/, ui/ (shadcn)
                             + componentes soltos (site-header, site-footer, business-card, niche-*...)
src/lib/                     admin, asaas, cash, cpf-cnpj, dates, format, legal, messages, niches, onboarding,
                             plan, plan-features, segments, types, utils;
                             supabase/{client,server,admin,public,middleware} (public = sem cookies, só dados públicos)
src/middleware.ts            sessão do Supabase e proteção das rotas
supabase/                    migrations, seed (não rodar em produção), manual
supabase-templates/          modelos de e-mail do Supabase
```

## 9. Roadmap pendente (em ordem)

**Prioritário:** cobrança de profissional extra acompanhar a equipe ativa (hoje o valor do Asaas não muda ao ativar
o 4º+ profissional no Equipe; só a assinatura nova ou a troca de plano recalculam pelo `subscription_quote`).

1. **N3.2 Retornos:** prazo de retorno por serviço (`services.return_after_days`) e fila "hora de voltar" com WhatsApp pronto.
2. **N4 Pacotes e recorrência:** pacotes de sessões (ex.: 10 drenagens) e agendamentos recorrentes.
3. **Agenda 2.0:** visão semanal/grade, **Remarcar** (botão com horários livres; arrastar só no desktop),
   busca de cliente no agendamento manual, proteção da vitrine contra robôs (Cloudflare Turnstile + limite por telefone).
4. **Confirmação automática:** 3 opções prontas (tudo automático / só clientes recorrentes / tudo manual), com motivo visível.
5. **Otimização e responsividade:**
   - `next/image` no lugar de `<img>` + upload de fotos no Supabase Storage (redimensionadas, WebP/AVIF);
   - carregar sob demanda bibliotecas pesadas (recharts no Financeiro ~297 kB, calendário, diálogos);
   - cache/ISR nas páginas públicas que hoje são `force-dynamic`; `loading.tsx` com skeletons no painel;
   - testes E2E (Playwright) em iPhone/Safari, Android, tablet e desktop; meta alta no Lighthouse;
   - avaliar atualização do Next.js depois que os testes E2E existirem.
6. Depois: WhatsApp API oficial (cota no Completo), comanda/comissões, lista de espera, sinal via Pix,
   busca de clientes sem acentos (unaccent + coluna name_search),
   cache da /para/[nicho] (cliente público sem cookies, como a /), sitemap e robots.

## 10. Como trabalhar neste projeto

1. Inspecionar antes de alterar; reutilizar componentes e funções existentes; evitar duplicidade.
2. Uma etapa por vez: explicar o plano, implementar, rodar `tsc` + `lint` (+ `build` em mudanças grandes), testar, resumir.
3. Mudança de banco = nova migration numerada + instruções para rodar no SQL Editor.
4. Não simular integrações como reais. Não expor segredos. Não criar dados fictícios em produção.

## 11. Fluxo de Git

1. Nunca fazer push direto no main nem fazer merge de PR — o merge é sempre do Leonardo.
2. Uma etapa = um branch (feat/..., fix/..., docs/...) = um PR.
3. Antes de abrir o PR: npx tsc --noEmit, npm run lint e npm run build sem erros.
4. Migration nova: SQL completo na descrição do PR. Regra geral: rodar ANTES do merge. Exceção: migration que REMOVE permissão usada pelo código atual (revoke) roda DEPOIS do deploy do código novo — o PR deve dizer isso em destaque.
5. Nunca commitar .env*, chaves ou dados de clientes.
