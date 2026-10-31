-- =====================================================================
-- GENIX AGENDA — Cobrança do profissional extra acompanha a equipe ativa
-- Rodar ANTES do merge. Pode rodar de novo sem erro. Só acrescenta.
--
-- O que faz:
--   • billing_quote(bid, plano?, profissionais?): o valor da assinatura
--     calculado no banco, usável pelo servidor (webhook, sem usuário logado).
--     subscription_quote passa a usar a mesma conta.
--   • Colunas de sincronia na assinatura ("a sincronizar", trava, extras já
--     cobrados no período anual) e o histórico das mudanças de valor.
--   • Gatilho: ativar/desativar/cadastrar/excluir profissional marca a
--     assinatura como "a sincronizar" (nenhum caminho escapa do recálculo).
--   • Avulsa de extra vencida: bloqueia novas ativações; após 15 dias, os
--     extras não pagos saem do agendamento ONLINE (agenda manual continua,
--     nada é desativado). Ao pagar, volta na hora.
--   • Novas ativações bloqueadas com troca para o Profissional agendada.
-- Reversão comentada no final.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Colunas da assinatura
-- =====================================================================
alter table subscriptions
  add column if not exists billing_sync_status        text not null default 'ok',   -- 'ok' | 'pendente'
  add column if not exists billing_sync_error         text,
  add column if not exists billing_synced_at          timestamptz,
  add column if not exists billing_lock_until         timestamptz,                  -- trava por assinatura
  add column if not exists billed_extra_professionals smallint not null default 0,  -- anual: extras já cobrados no período
  add column if not exists billing_auto               boolean not null default true; -- webhook corrige o valor sozinho

alter table subscriptions drop constraint if exists subscriptions_billing_sync_valid;
alter table subscriptions add constraint subscriptions_billing_sync_valid check (billing_sync_status in ('ok', 'pendente'));


-- =====================================================================
-- PARTE 2 — Histórico das mudanças de valor e avulsas de extra
-- Só o servidor grava; a matriz lê o do próprio espaço.
-- =====================================================================
create table if not exists subscription_billing_changes (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  kind                text not null check (kind in ('valor', 'avulsa')),
  reason              text not null,               -- ativou | desativou | cadastrou | excluiu | webhook | genix | sincronia
  professionals       smallint,
  extra_professionals smallint,
  old_amount          numeric(10,2),
  new_amount          numeric(10,2),
  -- avulsa (anual): quem entrou como extra, para a regra da vitrine
  professional_ids    uuid[] not null default '{}',
  payment_id          text unique,
  payment_value       numeric(10,2),
  payment_due_date    date,
  payment_status      text check (payment_status in ('PENDING', 'OVERDUE', 'PAID', 'CANCELED')),
  invoice_url         text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_billing_changes_business on subscription_billing_changes (business_id, created_at desc);
create index if not exists idx_billing_changes_open on subscription_billing_changes (business_id)
  where kind = 'avulsa' and payment_status in ('PENDING', 'OVERDUE');

alter table subscription_billing_changes enable row level security;

drop policy if exists "matriz le historico de cobranca" on subscription_billing_changes;
create policy "matriz le historico de cobranca" on subscription_billing_changes
  for select to authenticated
  using (is_business_owner(business_id) or is_platform_admin());


-- =====================================================================
-- PARTE 3 — Valor da assinatura (uma conta só)
-- p_plan nulo = plano da próxima renovação (troca agendada ou atual).
-- p_professionals nulo = profissionais ativos agora (simulação para o aviso).
-- Só o servidor chama direto; o painel usa subscription_quote.
-- =====================================================================
create or replace function billing_quote(bid uuid, p_plan text default null, p_professionals int default null)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'plan',                p.id,
    'cycle',               p.billing_cycle,
    'kind',                p.kind,
    'base_price',          p.base_price,
    'included',            p.included_professionals,
    'professionals',       c.n,
    'extra_professionals', greatest(c.n - p.included_professionals, 0),
    'extra_price',         p.extra_professional_price,
    'total',               p.base_price + greatest(c.n - p.included_professionals, 0) * p.extra_professional_price
  )
  from plans p,
       (select coalesce(p_professionals,
                        (select count(*)::int from professionals where business_id = bid and active)) as n) c
  where p.id = coalesce(p_plan, (select coalesce(s.scheduled_plan_id, s.plan_id) from subscriptions s where s.business_id = bid));
$$;
revoke all on function billing_quote(uuid, text, int) from public, anon, authenticated;
grant execute on function billing_quote(uuid, text, int) to service_role;

-- mesma conta, com a checagem de membro (tela de planos)
create or replace function subscription_quote(bid uuid, p_plan text)
returns json
language sql stable security definer set search_path = public
as $$
  select billing_quote(bid, p_plan) where is_business_member(bid);
$$;
grant execute on function subscription_quote(uuid, text) to authenticated;


-- =====================================================================
-- PARTE 4 — Trava por assinatura (duas ativações seguidas não se cruzam)
-- Prazo de 30 s: se o servidor cair no meio, a trava vence sozinha.
-- =====================================================================
create or replace function billing_try_lock(bid uuid, p_seconds int default 30)
returns boolean
language sql volatile security definer set search_path = public
as $$
  with u as (
    update subscriptions
       set billing_lock_until = now() + make_interval(secs => p_seconds)
     where business_id = bid and (billing_lock_until is null or billing_lock_until < now())
    returning 1
  )
  select exists (select 1 from u);
$$;
revoke all on function billing_try_lock(uuid, int) from public, anon, authenticated;
grant execute on function billing_try_lock(uuid, int) to service_role;


-- =====================================================================
-- PARTE 5 — Mudou a equipe ativa → assinatura "a sincronizar"
-- =====================================================================
create or replace function mark_billing_pending()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bid uuid := coalesce(new.business_id, old.business_id);
begin
  if tg_op = 'UPDATE' and new.active is not distinct from old.active then return null; end if;
  if tg_op = 'INSERT' and not new.active then return null; end if;
  if tg_op = 'DELETE' and not old.active then return null; end if;

  update subscriptions set billing_sync_status = 'pendente'
   where business_id = v_bid and asaas_subscription_id is not null and billing_sync_status <> 'pendente';
  return null;
end;
$$;

drop trigger if exists trg_professionals_billing on professionals;
create trigger trg_professionals_billing
after insert or update of active or delete on professionals
for each row execute function mark_billing_pending();


-- =====================================================================
-- PARTE 6 — Avulsa de extra vencida
-- =====================================================================

-- 6.1 Há avulsa de extra vencida e não paga? (bloqueia novas ativações)
create or replace function billing_extra_overdue(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subscription_billing_changes
     where business_id = bid and kind = 'avulsa' and payment_status in ('PENDING', 'OVERDUE')
       and payment_due_date < (now() at time zone 'America/Sao_Paulo')::date
  );
$$;

-- 6.2 Extras com avulsa vencida há mais de 15 dias: fora do agendamento online
create or replace function billing_blocked_professionals(bid uuid)
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(distinct pid), '{}')
    from subscription_billing_changes c, unnest(c.professional_ids) pid
   where c.business_id = bid and c.kind = 'avulsa' and c.payment_status in ('PENDING', 'OVERDUE')
     and c.payment_due_date < (now() at time zone 'America/Sao_Paulo')::date - 15;
$$;

revoke all on function billing_extra_overdue(uuid)         from public, anon;
revoke all on function billing_blocked_professionals(uuid) from public, anon;
grant execute on function billing_extra_overdue(uuid)         to authenticated, service_role;
grant execute on function billing_blocked_professionals(uuid) to authenticated, service_role;


-- =====================================================================
-- PARTE 7 — Limite ao ativar profissional (versão da 28a + 2 regras)
--   • avulsa de extra vencida → EXTRA_EM_ABERTO
--   • troca para o Profissional agendada e já há 1 ativo → TROCA_AGENDADA
-- Só vale ao cadastrar/ativar: quem já está ativo não é desativado.
-- =====================================================================
create or replace function enforce_free_professional_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_max   int;
  v_count int;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' then
    if old.active then return new; end if;                       -- já estava ativo
  end if;

  select count(*) into v_count from professionals
   where business_id = new.business_id and active and id <> new.id;

  if billing_extra_overdue(new.business_id) then
    raise exception 'EXTRA_EM_ABERTO';
  end if;

  if v_count >= 1 and exists (
    select 1 from subscriptions s join plans p on p.id = s.scheduled_plan_id
     where s.business_id = new.business_id and p.kind = 'profissional'
  ) then
    raise exception 'TROCA_AGENDADA';
  end if;

  v_max := plan_max_professionals(new.business_id);
  if v_max is null then return new; end if;

  if v_count >= v_max then
    if plan_kind(new.business_id) = 'gratis' then
      raise exception 'LIMITE_PLANO_GRATIS';
    else
      raise exception 'LIMITE_PLANO_PROFISSIONAL';
    end if;
  end if;
  return new;
end;
$$;
-- o gatilho trg_free_professional_limit (06) continua apontando para esta função


-- =====================================================================
-- PARTE 8 — Horários da vitrine (versão da 28a + extras bloqueados)
-- Muda só: v_blocked e o filtro "not (p.id = any(v_blocked))".
-- create_public_booking usa esta função, então a regra vale no envio também.
-- =====================================================================
create or replace function get_available_slots(
  p_slug            text,
  p_service_id      uuid,
  p_date            date,
  p_professional_id uuid default null
)
returns table (slot_time text, professional_ids uuid[])
language plpgsql stable security definer set search_path = public
as $$
declare
  b         businesses;
  s         services;
  h         business_hours;
  v_now     timestamp;
  v_today   date;
  t         time;
  v_end     time;
  ids       uuid[];
  v_only    uuid;          -- plano com 1 profissional: único que recebe agendamentos
  v_count   int;
  v_blocked uuid[];        -- extras com avulsa vencida há mais de 15 dias
begin
  select * into b from businesses where slug = p_slug and is_published;
  if not found then return; end if;

  if access_tier(b.id) = 'gratis' then
    select count(*) into v_count from bookings
     where business_id = b.id and booking_date = p_date
       and source = 'online' and status <> 'cancelled';
    if v_count >= free_daily_limit() then return; end if;
  end if;

  if plan_max_professionals(b.id) = 1 then
    select id into v_only from professionals
     where business_id = b.id and active order by sort_order, name limit 1;
  end if;

  v_blocked := billing_blocked_professionals(b.id);

  select * into s from services
   where id = p_service_id and business_id = b.id and active and bookable_online;
  if not found then return; end if;

  v_now   := now() at time zone b.timezone;
  v_today := v_now::date;
  if p_date < v_today or p_date > v_today + 60 then return; end if;

  select * into h from business_hours
   where business_id = b.id and weekday = extract(dow from p_date)::int;
  if not found or h.closed then return; end if;

  t := h.open_time;
  loop
    v_end := t + make_interval(mins => s.duration_min);
    exit when v_end > h.close_time or v_end <= t;

    if (p_date + t) >= v_now + make_interval(mins => b.booking_notice_min) then
      select array_agg(p.id order by p.sort_order, p.name) into ids
        from professionals p
       where p.business_id = b.id
         and p.active
         and (v_only is null or p.id = v_only)
         and not (p.id = any(v_blocked))
         and (p_professional_id is null or p.id = p_professional_id)
         and ( not exists (select 1 from professional_services ps where ps.professional_id = p.id)
               or exists (select 1 from professional_services ps
                           where ps.professional_id = p.id and ps.service_id = s.id) )
         and not slot_conflicts_block(b.id, p.id, p_date, t, v_end)
         and not exists (
           select 1 from bookings bk
            where bk.professional_id = p.id
              and bk.status in ('pending', 'confirmed')
              and bk.period && tsrange(p_date + t, p_date + v_end, '[)')
         );

      if ids is not null then
        slot_time        := to_char(t, 'HH24:MI');
        professional_ids := ids;
        return next;
      end if;
    end if;

    t := t + make_interval(mins => b.slot_step_min);
    exit when t >= h.close_time or t <= h.open_time;
  end loop;
end;
$$;


-- =====================================================================
-- PARTE 9 — Informações públicas do plano (versão da 28a + extras bloqueados)
-- =====================================================================
create or replace function public_plan_info(p_slug text, p_date date default null)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_tier  text;
  v_only  uuid;
  v_full  boolean := false;
begin
  select id into v_id from businesses where slug = p_slug and is_published;
  if v_id is null then return null; end if;

  v_tier := access_tier(v_id);

  if plan_max_professionals(v_id) = 1 then
    select id into v_only from professionals
     where business_id = v_id and active order by sort_order, name limit 1;
  end if;

  if v_tier = 'gratis' and p_date is not null then
    select count(*) >= free_daily_limit() into v_full from bookings
     where business_id = v_id and booking_date = p_date
       and source = 'online' and status <> 'cancelled';
  end if;

  return json_build_object(
    'tier',                     v_tier,
    'show_badge',               v_tier = 'gratis',
    'only_professional_id',     v_only,
    'day_full',                 v_full,
    'blocked_professional_ids', billing_blocked_professionals(v_id)
  );
end;
$$;

grant execute on function public_plan_info(text, date) to anon, authenticated;


-- =====================================================================
-- PARTE 10 — Visão da Genix (/genix → Assinaturas)
-- =====================================================================
create or replace function genix_billing_overview()
returns table (
  business_id uuid, name text, slug text, status text, plan_id text, billing_type text,
  asaas_subscription_id text, amount numeric, expected numeric, professionals int, extra_professionals int,
  sync_status text, sync_error text, synced_at timestamptz,
  open_extras bigint, overdue_extras bigint, blocked_professionals int, open_invoice_url text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select b.id, b.name, b.slug::text, s.status::text, s.plan_id, s.billing_type,
         s.asaas_subscription_id, s.amount,
         (q.j->>'total')::numeric,
         (q.j->>'professionals')::int,
         (q.j->>'extra_professionals')::int,
         s.billing_sync_status, s.billing_sync_error, s.billing_synced_at,
         (select count(*) from subscription_billing_changes c
           where c.business_id = b.id and c.kind = 'avulsa' and c.payment_status in ('PENDING', 'OVERDUE')),
         (select count(*) from subscription_billing_changes c
           where c.business_id = b.id and c.kind = 'avulsa' and c.payment_status in ('PENDING', 'OVERDUE')
             and c.payment_due_date < (now() at time zone 'America/Sao_Paulo')::date),
         coalesce(array_length(billing_blocked_professionals(b.id), 1), 0),
         (select c.invoice_url from subscription_billing_changes c
           where c.business_id = b.id and c.kind = 'avulsa' and c.payment_status in ('PENDING', 'OVERDUE')
           order by c.payment_due_date limit 1)
    from subscriptions s
    join businesses b on b.id = s.business_id
    cross join lateral (select billing_quote(s.business_id) as j) q
   where s.asaas_subscription_id is not null
      or s.billing_sync_status = 'pendente'
      or exists (select 1 from subscription_billing_changes c
                  where c.business_id = s.business_id and c.kind = 'avulsa' and c.payment_status in ('PENDING', 'OVERDUE'))
   order by (s.billing_sync_status = 'pendente') desc,
            (s.amount is distinct from (q.j->>'total')::numeric) desc,
            b.name;
end;
$$;
revoke all on function genix_billing_overview() from public, anon;
grant execute on function genix_billing_overview() to authenticated;


-- =====================================================================
-- PARTE 11 — Conferência
-- =====================================================================
select column_name from information_schema.columns
 where table_name = 'subscriptions' and column_name like 'bill%' order by column_name;
select routine_name from information_schema.routines
 where routine_name in ('billing_quote', 'billing_try_lock', 'billing_extra_overdue', 'billing_blocked_professionals',
                        'mark_billing_pending', 'genix_billing_overview')
 order by routine_name;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; antes, volte o código)
-- =====================================================================
-- 1) Cole e rode, de 28a_planos_profissional_equipe.sql, as PARTES 5
--    (enforce_free_professional_limit), 7 (get_available_slots) e
--    8 (public_plan_info) — create or replace.
-- 2) subscription_quote volta à versão da 05:
-- create or replace function subscription_quote(bid uuid, p_plan text)
-- returns json language sql stable security definer set search_path = public as $$
--   select json_build_object(
--     'plan', p.id, 'base_price', p.base_price, 'professionals', c.n,
--     'extra_professionals', greatest(c.n - p.included_professionals, 0),
--     'extra_price', p.extra_professional_price,
--     'total', p.base_price + greatest(c.n - p.included_professionals, 0) * p.extra_professional_price)
--   from plans p, (select count(*)::int as n from professionals where business_id = bid and active) c
--   where p.id = p_plan and is_business_member(bid);
-- $$;
-- 3) Depois:
-- drop function if exists genix_billing_overview();
-- drop trigger  if exists trg_professionals_billing on professionals;
-- drop function if exists mark_billing_pending();
-- drop function if exists billing_blocked_professionals(uuid);
-- drop function if exists billing_extra_overdue(uuid);
-- drop function if exists billing_try_lock(uuid, int);
-- drop function if exists billing_quote(uuid, text, int);
-- drop table    if exists subscription_billing_changes;
-- alter table subscriptions drop constraint if exists subscriptions_billing_sync_valid;
-- alter table subscriptions drop column if exists billing_auto, drop column if exists billed_extra_professionals,
--   drop column if exists billing_lock_until, drop column if exists billing_synced_at,
--   drop column if exists billing_sync_error, drop column if exists billing_sync_status;
-- =====================================================================
