-- =====================================================================
-- GENIX AGENDA — 60: Nix (assistente) — acesso e cota diária
-- Aditiva. Rodar ANTES do merge (a rota /api/agente usa as funções
-- daqui). Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   • plans.ai_daily_limit / ai_trial_daily_limit: pedidos por dia à Nix
--     (linhas do Equipe, inclusive o antigo Completo mensal/anual: 500 e 20;
--     os outros planos: 0). Valores só aqui, não no código;
--   • agent_access(bid): 'pago' | 'teste' | null. Regra única (igual ao
--     agentAccess do código, lib/agente/access.ts):
--       – cortesia Equipe ativa → 'pago' (cortesia de outro plano → null);
--       – conta sem assinatura → null (contas de teste: cortesia Equipe);
--       – em teste (trialing, valendo): só nos ÚLTIMOS 3 DIAS → 'teste';
--       – assinatura de plano Equipe (Equipe, antigo Completo mensal/anual)
--         em active ou past_due, enquanto o sistema ainda trata o espaço
--         como Equipe (plan_kind = 'equipe', com a carência do past_due)
--         → 'pago';
--       – o resto (cancelada, expirada, Grátis, Básico, Profissional,
--         começo do teste, sem assinatura) → null.
--     NÃO basta plan_kind = 'equipe': conta sem assinatura também cai lá;
--   • ai_usage: pedidos e tokens por espaço e dia (no fuso do espaço);
--     a matriz lê; escrita só pelas funções;
--   • ai_usage_hit(bid): confere papel (matriz/recepção) e acesso e conta
--     1 pedido de forma atômica; devolve quantos restam; COTA_ESGOTADA sem
--     contar;
--   • ai_usage_refund(bid): devolve 1 pedido quando o Gemini falha;
--   • ai_usage_tokens(bid, n): soma os tokens da resposta (acompanhar custo).
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Limites por plano
-- =====================================================================
alter table plans add column if not exists ai_daily_limit int not null default 0;
alter table plans add column if not exists ai_trial_daily_limit int not null default 0;

update plans set ai_daily_limit = 500, ai_trial_daily_limit = 20
 where kind = 'equipe' and ai_daily_limit = 0 and ai_trial_daily_limit = 0;


-- =====================================================================
-- PARTE 2 — Quem tem a Nix
-- =====================================================================
create or replace function agent_access(bid uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grant  text;
  v_status text;
  v_trial  timestamptz;
  v_kind   text;
  v_found  boolean;
begin
  -- 1) cortesia: Equipe libera; cortesia de outro plano não
  v_grant := active_plan_grant(bid);
  if v_grant is not null then
    return case when v_grant = 'equipe' then 'pago' else null end;
  end if;

  select s.status::text, s.trial_ends_at, p.kind, true
    into v_status, v_trial, v_kind, v_found
    from subscriptions s left join plans p on p.id = s.plan_id
   where s.business_id = bid;

  -- 2) conta sem assinatura = bloqueada (contas de teste da Genix recebem cortesia Equipe)
  if not coalesce(v_found, false) then
    return null;
  end if;

  -- 3) teste valendo: só nos 3 últimos dias
  if v_status = 'trialing' and v_trial > now() then
    return case when v_trial <= now() + interval '3 days' then 'teste' else null end;
  end if;

  -- 4) assinatura de plano Equipe (Equipe ou antigo Completo) paga ou em atraso,
  --    enquanto o sistema ainda trata o espaço como Equipe (carência do past_due)
  if v_kind = 'equipe' and v_status in ('active', 'past_due') and plan_kind(bid) = 'equipe' then
    return 'pago';
  end if;

  return null;
end;
$$;

revoke all on function agent_access(uuid) from public, anon;
grant execute on function agent_access(uuid) to authenticated;


-- =====================================================================
-- PARTE 3 — Uso por dia
-- =====================================================================
create table if not exists ai_usage (
  business_id uuid not null references businesses(id) on delete cascade,
  day         date not null,
  requests    int not null default 0,
  tokens      int not null default 0,
  primary key (business_id, day)
);

alter table ai_usage enable row level security;
drop policy if exists "matriz ve uso da nix" on ai_usage;
create policy "matriz ve uso da nix" on ai_usage
  for select to authenticated using (coalesce(member_role_of(business_id) = 'owner', false));
-- sem políticas de escrita: só ai_usage_hit / ai_usage_tokens


-- =====================================================================
-- PARTE 4 — Contar 1 pedido (devolve quantos restam hoje)
-- =====================================================================
create or replace function ai_usage_hit(p_business uuid)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_access text;
  v_limit  int;
  v_day    date;
  v_used   int;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;

  v_access := agent_access(p_business);
  if v_access is null then
    raise exception 'PLANO_EQUIPE';
  end if;

  if v_access = 'teste' then
    select max(p.ai_trial_daily_limit) into v_limit from plans p where p.kind = 'equipe';
  else
    -- plano assinado (Equipe ou antigo Completo); cortesia ou conta sem assinatura: o maior do Equipe
    select p.ai_daily_limit into v_limit
      from subscriptions s join plans p on p.id = s.plan_id
     where s.business_id = p_business and p.kind = 'equipe';
    if v_limit is null or active_plan_grant(p_business) is not null then
      select max(p.ai_daily_limit) into v_limit from plans p where p.kind = 'equipe';
    end if;
  end if;
  v_limit := coalesce(v_limit, 0);
  if v_limit <= 0 then
    raise exception 'COTA_ESGOTADA';
  end if;

  select (now() at time zone coalesce(b.timezone, 'America/Sao_Paulo'))::date into v_day
    from businesses b where b.id = p_business;

  -- atômico: só soma enquanto estiver abaixo do limite (dois pedidos juntos não passam do teto)
  insert into ai_usage as u (business_id, day, requests) values (p_business, v_day, 1)
  on conflict (business_id, day) do update set requests = u.requests + 1
   where u.requests < v_limit
  returning u.requests into v_used;

  if v_used is null then
    raise exception 'COTA_ESGOTADA';
  end if;

  return greatest(v_limit - v_used, 0);
end;
$$;

revoke all on function ai_usage_hit(uuid) from public, anon;
grant execute on function ai_usage_hit(uuid) to authenticated;


-- =====================================================================
-- PARTE 4b — Devolver 1 pedido (o Gemini falhou: não conta na cota)
-- =====================================================================
create or replace function ai_usage_refund(p_business uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_day date;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;

  select (now() at time zone coalesce(b.timezone, 'America/Sao_Paulo'))::date into v_day
    from businesses b where b.id = p_business;

  update ai_usage set requests = greatest(requests - 1, 0)
   where business_id = p_business and day = v_day;
end;
$$;

revoke all on function ai_usage_refund(uuid) from public, anon;
grant execute on function ai_usage_refund(uuid) to authenticated;


-- =====================================================================
-- PARTE 5 — Somar tokens da resposta
-- =====================================================================
create or replace function ai_usage_tokens(p_business uuid, p_tokens int)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_day date;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_tokens is null or p_tokens <= 0 then
    return;
  end if;

  select (now() at time zone coalesce(b.timezone, 'America/Sao_Paulo'))::date into v_day
    from businesses b where b.id = p_business;

  update ai_usage set tokens = tokens + least(p_tokens, 1000000)
   where business_id = p_business and day = v_day;
end;
$$;

revoke all on function ai_usage_tokens(uuid, int) from public, anon;
grant execute on function ai_usage_tokens(uuid, int) to authenticated;

commit;

-- Conferência: TODAS as contas que recebem a Nix como 'pago' (revisar antes de ligar)
select b.name, b.slug, b.is_demo, s.status as assinatura, s.plan_id, active_plan_grant(b.id) as cortesia,
       plan_kind(b.id) as plano, agent_access(b.id) as nix
  from businesses b left join subscriptions s on s.business_id = b.id
 where agent_access(b.id) = 'pago'
 order by b.name;


-- =====================================================================
-- CONFERIR (depois de rodar)
-- =====================================================================
-- 1) Limites por plano (Equipe e antigo Completo: 500 e 20; os outros: 0):
-- select id, kind, ai_daily_limit, ai_trial_daily_limit from plans order by kind, id;
--
-- 2) Uma conta específica (troque o slug):
-- select b.name, plan_kind(b.id) as plano, agent_access(b.id) as nix
--   from businesses b where b.slug = 'SEU-SLUG';
--
-- 3) Uso de hoje por espaço:
-- select b.name, u.day, u.requests, u.tokens
--   from ai_usage u join businesses b on b.id = u.business_id
--  order by u.day desc, u.requests desc limit 20;

--
-- 4) OPCIONAL — cortesia Equipe VITALÍCIA para a SUA conta de teste (a Nix
--    não libera conta sem assinatura). Troque 'SEU-SLUG' e rode o bloco.
--    Trava: o slug precisa existir, não pode ser a demonstração e não pode
--    ter assinatura no Asaas (conta de cliente pagante). Nunca use em conta
--    de cliente. Para tirar depois: delete from plan_grants where business_id = ...
-- do $$
-- declare
--   v_slug text := 'SEU-SLUG';
--   v_bid  uuid;
--   v_name text;
-- begin
--   select b.id, b.name into v_bid, v_name from businesses b where b.slug = v_slug and not b.is_demo;
--   if v_bid is null then
--     raise exception 'Slug % não existe (ou é a demonstração). Nada foi feito.', v_slug;
--   end if;
--   if exists (select 1 from subscriptions s where s.business_id = v_bid and s.asaas_subscription_id is not null) then
--     raise exception 'O espaço % tem assinatura no Asaas (pode ser cliente). Nada foi feito.', v_name;
--   end if;
--   insert into plan_grants (business_id, kind, reason, granted_by, expires_at)
--   values (v_bid, 'equipe', 'Conta de teste da Genix (Nix, 60)', null, null)
--   on conflict (business_id) do update
--     set kind = 'equipe', reason = excluded.reason, expires_at = null, granted_at = now();
--   raise notice 'Cortesia Equipe vitalícia dada a % (%).', v_name, v_slug;
-- end $$;
-- select b.name, active_plan_grant(b.id) as cortesia, agent_access(b.id) as nix
--   from businesses b where b.slug = 'SEU-SLUG';


-- =====================================================================
-- REVERSÃO (rodar inteira; antes, volte o código)
-- =====================================================================
-- begin;
-- drop function if exists ai_usage_tokens(uuid, int);
-- drop function if exists ai_usage_refund(uuid);
-- drop function if exists ai_usage_hit(uuid);
-- drop table if exists ai_usage;
-- drop function if exists agent_access(uuid);
-- alter table plans drop column if exists ai_trial_daily_limit;
-- alter table plans drop column if exists ai_daily_limit;
-- commit;
