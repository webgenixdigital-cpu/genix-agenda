-- =====================================================================
-- GENIX AGENDA — 53: Cupom de lançamento (LANCAMENTO2026)
-- Aditiva. Rodar ANTES do merge (o código novo lê as tabelas e funções
-- daqui). Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   • cupons (coupons) com preço por plano (coupon_prices). O de lançamento
--     é automático: assinaturas Profissional e Equipe feitas até
--     31/12/2026 23:59 (America/Sao_Paulo) pagam o preço de lançamento por
--     12 meses a partir do 1º vencimento; depois volta ao preço cheio.
--     Extra do Equipe sem desconto. Básico e planos antigos sem cupom;
--   • 1 desconto por espaço (subscription_discounts) + histórico para
--     auditoria (subscription_discount_log): quem, plano, início, fim;
--   • billing_quote ganha p_ref (vencimento da cobrança): o preço depende do
--     VENCIMENTO, nunca de "hoje". O Asaas gera cada cobrança 40 dias antes,
--     então a 12ª (com desconto) e a 13ª (cheia) convivem pendentes;
--   • launch_offer(): o cupom automático no prazo, para as páginas públicas;
--   • assinaturas Profissional/Equipe que já existem ganham o desconto a
--     partir da próxima cobrança ainda não paga (ficam "pendente" para o
--     próximo webhook ou o "Sincronizar agora" do /genix ajustar o Asaas).
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Cupons e preços por plano
-- =====================================================================
create table if not exists coupons (
  code             text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,40}$'),
  label            text not null,                       -- ex.: "Preço de lançamento"
  auto_apply       boolean not null default false,       -- true = vale sem digitar o código
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz not null,                  -- assinaturas feitas até aqui
  duration_months  smallint not null check (duration_months between 1 and 36),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists coupon_prices (
  code        text not null references coupons(code) on delete cascade,
  plan_id     text not null references plans(id),
  base_price  numeric(10,2) not null check (base_price >= 0),
  primary key (code, plan_id)
);

alter table coupons enable row level security;
alter table coupon_prices enable row level security;
-- leitura só pela Genix; o resto lê por launch_offer / billing_quote
drop policy if exists "genix le cupons" on coupons;
create policy "genix le cupons" on coupons for select to authenticated using (is_platform_admin());
drop policy if exists "genix le precos de cupom" on coupon_prices;
create policy "genix le precos de cupom" on coupon_prices for select to authenticated using (is_platform_admin());

insert into coupons (code, label, auto_apply, starts_at, ends_at, duration_months)
values ('LANCAMENTO2026', 'Preço de lançamento', true, '2026-11-01 00:00:00-03', '2026-12-31 23:59:59.999999-03', 12)
on conflict (code) do nothing;

insert into coupon_prices (code, plan_id, base_price) values
  ('LANCAMENTO2026', 'profissional_mensal',  48.70),
  ('LANCAMENTO2026', 'profissional_anual',  487.00),
  ('LANCAMENTO2026', 'equipe_mensal',        98.70),
  ('LANCAMENTO2026', 'equipe_anual',        987.00)
on conflict (code, plan_id) do nothing;


-- =====================================================================
-- PARTE 2 — Desconto de cada espaço (1 por espaço) + histórico
-- status: ativo (vale até ends_on) | encerrado (já voltou ao cheio)
--         | anulado (1ª fatura nunca paga: o cupom não foi "gasto")
-- Cobrança com vencimento < ends_on sai com desconto.
-- =====================================================================
create table if not exists subscription_discounts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  coupon_code  text not null references coupons(code),
  plan_id      text not null references plans(id),   -- plano em que o desconto começou
  starts_on    date not null,                         -- 1º vencimento com desconto
  ends_on      date not null,                         -- 1º vencimento SEM desconto
  status       text not null default 'ativo' check (status in ('ativo', 'encerrado', 'anulado')),
  applied_by   uuid references auth.users(id) on delete set null,  -- null = migration / sistema
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  voided_at    timestamptz,
  check (ends_on > starts_on)
);
create unique index if not exists subscription_discounts_one_per_business
  on subscription_discounts (business_id) where status <> 'anulado';

create table if not exists subscription_discount_log (
  id           bigint generated always as identity primary key,
  discount_id  uuid not null references subscription_discounts(id) on delete cascade,
  business_id  uuid not null references businesses(id) on delete cascade,
  event        text not null check (event in ('aplicado', 'reaproveitado', 'troca_plano', 'valor', 'virada', 'anulado')),
  plan_id      text references plans(id),
  old_amount   numeric(10,2),
  new_amount   numeric(10,2),
  due_date     date,                                   -- vencimento afetado (valor/virada)
  actor        uuid references auth.users(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists subscription_discount_log_business on subscription_discount_log (business_id, created_at desc);

alter table subscription_discounts enable row level security;
alter table subscription_discount_log enable row level security;
-- sem políticas de escrita: só o servidor (service role) grava
drop policy if exists "matriz e genix leem desconto" on subscription_discounts;
create policy "matriz e genix leem desconto" on subscription_discounts
  for select to authenticated using (is_business_owner(business_id) or is_platform_admin());
drop policy if exists "matriz e genix leem historico do desconto" on subscription_discount_log;
create policy "matriz e genix leem historico do desconto" on subscription_discount_log
  for select to authenticated using (is_business_owner(business_id) or is_platform_admin());


-- =====================================================================
-- PARTE 3 — Preço de um plano para um vencimento
-- 1) desconto do espaço (ativo, plano com preço no cupom, vencimento < fim);
-- 2) espaço que nunca usou desconto + cupom automático no prazo: preço do
--    cupom (cotação de quem vai assinar; a data final nasce ao assinar);
-- 3) senão, o preço cheio.
-- =====================================================================
create or replace function auto_coupon_code()
returns text
language sql stable security definer set search_path = public
as $$
  select code from coupons
   where active and auto_apply and now() >= starts_at and now() <= ends_at
   order by ends_at, code
   limit 1;
$$;
revoke all on function auto_coupon_code() from public, anon, authenticated;
grant execute on function auto_coupon_code() to service_role;

create or replace function plan_price_for(bid uuid, p_plan text, p_ref date)
returns json
language sql stable security definer set search_path = public
as $$
  with d as (
    select * from subscription_discounts where business_id = bid and status <> 'anulado' limit 1
  ),
  own as (   -- desconto do espaço
    select cp.base_price, co.code, co.label, co.duration_months, d.ends_on
      from d
      join coupons co on co.code = d.coupon_code
      join coupon_prices cp on cp.code = d.coupon_code and cp.plan_id = p_plan
     where d.status = 'ativo' and p_ref < d.ends_on
  ),
  fresh as ( -- quem nunca usou desconto, com o cupom automático no prazo
    select cp.base_price, co.code, co.label, co.duration_months, null::date as ends_on
      from coupons co
      join coupon_prices cp on cp.code = co.code and cp.plan_id = p_plan
     where co.code = auto_coupon_code() and not exists (select 1 from d)
  ),
  pick as (select * from own union all select * from fresh limit 1)
  select json_build_object(
    'full_price',      p.base_price,
    'price',           coalesce((select base_price from pick), p.base_price),
    'discounted',      exists (select 1 from pick),
    'coupon_code',     (select code from pick),
    'coupon_label',    (select label from pick),
    'discount_months', (select duration_months from pick),
    'discount_ends_on',(select ends_on from pick)
  )
  from plans p where p.id = p_plan;
$$;
revoke all on function plan_price_for(uuid, text, date) from public, anon, authenticated;
grant execute on function plan_price_for(uuid, text, date) to service_role;


-- =====================================================================
-- PARTE 4 — billing_quote com o vencimento (p_ref)
-- p_ref nulo = próxima cobrança: current_period_end (assinante em dia ou em
-- atraso) → pending_due_date (1ª fatura) → current_period_end → hoje.
-- base_price/total = valor COBRADO (com desconto, se houver);
-- full_base_price/full_total = preço cheio. Extra sempre sem desconto.
-- =====================================================================
drop function if exists billing_quote(uuid, text, int);

create or replace function billing_quote(bid uuid, p_plan text default null, p_professionals int default null, p_ref date default null)
returns json
language sql stable security definer set search_path = public
as $$
  with s as (select * from subscriptions where business_id = bid),
  r as (
    select coalesce(
      p_ref,
      (select (current_period_end at time zone 'America/Sao_Paulo')::date from s where status in ('active', 'past_due')),
      (select pending_due_date from s),
      (select (current_period_end at time zone 'America/Sao_Paulo')::date from s),
      (now() at time zone 'America/Sao_Paulo')::date
    ) as ref
  )
  select json_build_object(
    'plan',                p.id,
    'cycle',               p.billing_cycle,
    'kind',                p.kind,
    'base_price',          (pp->>'price')::numeric,
    'full_base_price',     p.base_price,
    'included',            p.included_professionals,
    'professionals',       c.n,
    'extra_professionals', greatest(c.n - p.included_professionals, 0),
    'extra_price',         p.extra_professional_price,
    'total',               (pp->>'price')::numeric + greatest(c.n - p.included_professionals, 0) * p.extra_professional_price,
    'full_total',          p.base_price + greatest(c.n - p.included_professionals, 0) * p.extra_professional_price,
    'discounted',          (pp->>'discounted')::boolean,
    'coupon_code',         pp->>'coupon_code',
    'coupon_label',        pp->>'coupon_label',
    'discount_months',     (pp->>'discount_months')::int,
    'discount_ends_on',    pp->>'discount_ends_on',
    'ref_date',            r.ref
  )
  from plans p,
       r,
       lateral (select plan_price_for(bid, p.id, r.ref) as pp) x,
       (select coalesce(p_professionals,
                        (select count(*)::int from professionals where business_id = bid and active)) as n) c
  where p.id = coalesce(p_plan, (select coalesce(s.scheduled_plan_id, s.plan_id) from s));
$$;
revoke all on function billing_quote(uuid, text, int, date) from public, anon, authenticated;
grant execute on function billing_quote(uuid, text, int, date) to service_role;

-- mesma conta, com a checagem de membro (tela de planos)
create or replace function subscription_quote(bid uuid, p_plan text)
returns json
language sql stable security definer set search_path = public
as $$
  select billing_quote(bid, p_plan) where is_business_member(bid);
$$;
grant execute on function subscription_quote(uuid, text) to authenticated;


-- =====================================================================
-- PARTE 5 — Registrar, reaproveitar e anular o desconto (só o servidor)
-- subscription_discount_claim: ao assinar ou ao passar para Profissional/
-- Equipe. Já tem desconto (ativo/encerrado)? devolve o mesmo (mesma data
-- final). Senão, com o cupom automático no prazo e o plano no cupom, cria
-- com início = 1º vencimento e fim = início + duração. Devolve o id ou null.
-- =====================================================================
create or replace function subscription_discount_claim(bid uuid, p_plan text, p_first_due date, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
  v_months int;
  v_id uuid;
begin
  select id into v_id from subscription_discounts where business_id = bid and status <> 'anulado';
  if v_id is not null then
    insert into subscription_discount_log (discount_id, business_id, event, plan_id, actor)
    values (v_id, bid, 'reaproveitado', p_plan, p_actor);
    return v_id;
  end if;

  v_code := auto_coupon_code();
  if v_code is null or p_first_due is null then return null; end if;
  if not exists (select 1 from coupon_prices where code = v_code and plan_id = p_plan) then return null; end if;
  select duration_months into v_months from coupons where code = v_code;

  insert into subscription_discounts (business_id, coupon_code, plan_id, starts_on, ends_on, applied_by)
  values (bid, v_code, p_plan, p_first_due, (p_first_due + make_interval(months => v_months))::date, p_actor)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then   -- corrida: outro pedido criou no mesmo instante
    select id into v_id from subscription_discounts where business_id = bid and status <> 'anulado';
    return v_id;
  end if;

  insert into subscription_discount_log (discount_id, business_id, event, plan_id, new_amount, due_date, actor)
  values (v_id, bid, 'aplicado', p_plan, (select base_price from coupon_prices where code = v_code and plan_id = p_plan),
          p_first_due, p_actor);
  return v_id;
end;
$$;
revoke all on function subscription_discount_claim(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function subscription_discount_claim(uuid, text, date, uuid) to service_role;

-- 1ª fatura nunca paga e a assinatura foi desfeita: o cupom não foi usado
create or replace function subscription_discount_void(bid uuid, p_actor uuid default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  update subscription_discounts set status = 'anulado', voided_at = now()
   where business_id = bid and status = 'ativo'
  returning id into v_id;
  if v_id is null then return false; end if;
  insert into subscription_discount_log (discount_id, business_id, event, actor, note)
  values (v_id, bid, 'anulado', p_actor, '1ª fatura não paga');
  return true;
end;
$$;
revoke all on function subscription_discount_void(uuid, uuid) from public, anon, authenticated;
grant execute on function subscription_discount_void(uuid, uuid) to service_role;


-- =====================================================================
-- PARTE 6 — Oferta pública (/ e /para): cupom automático no prazo
-- =====================================================================
create or replace function launch_offer()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'code',            co.code,
    'label',           co.label,
    'ends_at',         co.ends_at,
    'duration_months', co.duration_months,
    'prices',          (select json_object_agg(cp.plan_id, cp.base_price) from coupon_prices cp where cp.code = co.code)
  )
  from coupons co where co.code = auto_coupon_code();
$$;
grant execute on function launch_offer() to anon, authenticated;


-- =====================================================================
-- PARTE 7 — Assinaturas Profissional/Equipe que já existem
-- Desconto a partir da próxima cobrança ainda não paga (só com o cupom no
-- prazo). Marca "pendente": o próximo webhook ou o /genix ajusta o Asaas.
-- =====================================================================
with alvo as (
  select s.business_id, s.plan_id,
         coalesce(
           case when s.status in ('active', 'past_due') then (s.current_period_end at time zone 'America/Sao_Paulo')::date end,
           s.pending_due_date
         ) as first_due
    from subscriptions s
   where s.asaas_subscription_id is not null
     and s.status in ('active', 'past_due', 'trialing', 'expired')
     and exists (select 1 from coupon_prices cp where cp.code = auto_coupon_code() and cp.plan_id = s.plan_id)
     and not exists (select 1 from subscription_discounts d where d.business_id = s.business_id and d.status <> 'anulado')
),
novo as (
  insert into subscription_discounts (business_id, coupon_code, plan_id, starts_on, ends_on)
  select a.business_id, auto_coupon_code(), a.plan_id, a.first_due,
         (a.first_due + make_interval(months => (select duration_months from coupons where code = auto_coupon_code())))::date
    from alvo a
   where a.first_due is not null
  on conflict do nothing
  returning id, business_id, plan_id, starts_on
),
log as (
  insert into subscription_discount_log (discount_id, business_id, event, plan_id, due_date, note)
  select id, business_id, 'aplicado', plan_id, starts_on, 'migration 53: assinatura que já existia'
    from novo
  returning business_id
)
update subscriptions s set billing_sync_status = 'pendente', billing_sync_error = 'Cupom de lançamento: ajustar o valor no Asaas.'
 where s.business_id in (select business_id from log);

commit;


-- =====================================================================
-- CONFERIR
-- =====================================================================
-- select launch_offer();
-- select business_id, plan_id, starts_on, ends_on, status from subscription_discounts order by created_at;
-- select billing_quote('<business_id>'::uuid, 'profissional_mensal', null, '2027-01-10');


-- =====================================================================
-- REVERSÃO (rodar inteira; antes, volte o código)
-- =====================================================================
-- begin;
-- drop function if exists launch_offer();
-- drop function if exists subscription_discount_void(uuid, uuid);
-- drop function if exists subscription_discount_claim(uuid, text, date, uuid);
-- drop function if exists billing_quote(uuid, text, int, date);
-- create or replace function billing_quote(bid uuid, p_plan text default null, p_professionals int default null)
-- returns json
-- language sql stable security definer set search_path = public
-- as $$
--   select json_build_object(
--     'plan',                p.id,
--     'cycle',               p.billing_cycle,
--     'kind',                p.kind,
--     'base_price',          p.base_price,
--     'included',            p.included_professionals,
--     'professionals',       c.n,
--     'extra_professionals', greatest(c.n - p.included_professionals, 0),
--     'extra_price',         p.extra_professional_price,
--     'total',               p.base_price + greatest(c.n - p.included_professionals, 0) * p.extra_professional_price
--   )
--   from plans p,
--        (select coalesce(p_professionals,
--                         (select count(*)::int from professionals where business_id = bid and active)) as n) c
--   where p.id = coalesce(p_plan, (select coalesce(s.scheduled_plan_id, s.plan_id) from subscriptions s where s.business_id = bid));
-- $$;
-- revoke all on function billing_quote(uuid, text, int) from public, anon, authenticated;
-- grant execute on function billing_quote(uuid, text, int) to service_role;
-- create or replace function subscription_quote(bid uuid, p_plan text)
-- returns json
-- language sql stable security definer set search_path = public
-- as $$
--   select billing_quote(bid, p_plan) where is_business_member(bid);
-- $$;
-- grant execute on function subscription_quote(uuid, text) to authenticated;
-- drop function if exists plan_price_for(uuid, text, date);
-- drop function if exists auto_coupon_code();
-- drop table if exists subscription_discount_log;
-- drop table if exists subscription_discounts;
-- drop table if exists coupon_prices;
-- drop table if exists coupons;
-- commit;
-- (o valor das assinaturas no Asaas NÃO volta sozinho: depois de reverter,
--  use "Sincronizar agora" no /genix → Assinaturas em cada espaço que tinha desconto.)
