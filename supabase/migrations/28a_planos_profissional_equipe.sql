-- =====================================================================
-- GENIX AGENDA — Planos Grátis / Profissional / Equipe (PARTE A)
-- Rodar ANTES do merge. Pode rodar de novo sem erro. Só acrescenta.
-- A PARTE B (28b_planos_ativar.sql) roda DEPOIS do deploy do código novo:
-- ela ativa os planos novos, tira os antigos da tela e muda o Grátis para 6/dia.
-- Até lá, nada muda para os clientes (planos novos ficam inativos e o
-- limite do Grátis continua 10).
--
-- Regras:
--   • access_tier continua 'completo' | 'gratis' (pago/teste × grátis);
--     as checagens existentes seguem valendo para os dois planos pagos.
--   • plan_kind(bid) diz QUAL plano: 'gratis' | 'profissional' | 'equipe'.
--     Teste de 15 dias, conta interna e assinantes antigos = 'equipe'.
--   • Assinantes atuais (planos 'mensal'/'anual') viram Equipe mantendo o
--     valor contratado: nada muda na cobrança.
-- Reversão comentada no final.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Colunas novas em plans
-- =====================================================================
alter table plans add column if not exists kind text not null default 'equipe';
alter table plans drop constraint if exists plans_kind_valid;
alter table plans add constraint plans_kind_valid check (kind in ('gratis', 'profissional', 'equipe'));

-- máximo de profissionais ativos (null = sem limite; extras cobrados no Equipe)
alter table plans add column if not exists max_professionals smallint;
-- agendamentos online por dia (só o Grátis usa; null = ilimitado)
alter table plans add column if not exists online_daily_limit smallint;


-- =====================================================================
-- PARTE 2 — Planos (novos nascem INATIVOS; a PARTE B ativa)
-- Anual = 10 × mensal (2 meses grátis).
-- =====================================================================
insert into plans (id, name, billing_cycle, base_price, included_professionals, extra_professional_price,
                   active, kind, max_professionals, online_daily_limit)
values
  ('gratis',              'Grátis',                 'MONTHLY',   0.00, 1,   0.00, false, 'gratis',       1,    10),
  ('profissional_mensal', 'Profissional mensal',    'MONTHLY',  48.70, 1,   0.00, false, 'profissional', 1,    null),
  ('profissional_anual',  'Profissional anual',     'YEARLY',  487.00, 1,   0.00, false, 'profissional', 1,    null),
  ('equipe_mensal',       'Equipe mensal',          'MONTHLY',  98.70, 3,  19.90, false, 'equipe',       null, null),
  ('equipe_anual',        'Equipe anual',           'YEARLY',  987.00, 3, 199.00, false, 'equipe',       null, null)
on conflict (id) do update
set name = excluded.name,
    billing_cycle = excluded.billing_cycle,
    base_price = excluded.base_price,
    included_professionals = excluded.included_professionals,
    extra_professional_price = excluded.extra_professional_price,
    kind = excluded.kind,
    max_professionals = excluded.max_professionals;
-- (active e online_daily_limit não são sobrescritos ao rodar de novo)

-- planos antigos do Completo: viram Equipe (valores e assinaturas intactos)
update plans set kind = 'equipe', max_professionals = null where id in ('mensal', 'anual');


-- =====================================================================
-- PARTE 3 — Troca de plano agendada / upgrade aguardando pagamento
-- =====================================================================
alter table subscriptions
  add column if not exists scheduled_plan_id text references plans(id),     -- downgrade no próximo ciclo
  add column if not exists scheduled_at timestamptz,
  add column if not exists upgrade_plan_id text references plans(id),       -- upgrade anual: aguarda a cobrança proporcional
  add column if not exists upgrade_payment_id text,
  add column if not exists upgrade_amount numeric(10,2),                     -- valor da assinatura depois do upgrade
  add column if not exists upgrade_invoice_url text;


-- =====================================================================
-- PARTE 4 — Funções do plano
-- =====================================================================

-- 4.1 Qual plano: 'gratis' | 'profissional' | 'equipe'
create or replace function plan_kind(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when access_tier(bid) = 'gratis' then 'gratis'
    else coalesce(
      (select p.kind
         from subscriptions s join plans p on p.id = s.plan_id
        where s.business_id = bid and s.status <> 'trialing'),
      'equipe'   -- teste, conta interna (sem assinatura) ou plano sem tipo
    )
  end;
$$;
grant execute on function plan_kind(uuid) to authenticated;

-- 4.2 Máximo de profissionais ativos do plano atual (null = sem limite)
create or replace function plan_max_professionals(bid uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select case k
    when 'equipe' then null
    when 'gratis' then coalesce((select max_professionals from plans where id = 'gratis'), 1)
    else coalesce(
      (select p.max_professionals from subscriptions s join plans p on p.id = s.plan_id where s.business_id = bid),
      1
    )
  end
  from (select plan_kind(bid) as k) x;
$$;
grant execute on function plan_max_professionals(uuid) to authenticated;

-- 4.3 Agendamentos online por dia no Grátis (vem da linha 'gratis' de plans)
create or replace function free_daily_limit()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce((select online_daily_limit from plans where id = 'gratis'), 10);
$$;
grant execute on function free_daily_limit() to anon, authenticated;


-- =====================================================================
-- PARTE 5 — Limite de profissionais ativos (Grátis e Profissional = 1)
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
  v_max := plan_max_professionals(new.business_id);
  if v_max is null then return new; end if;

  select count(*) into v_count from professionals
   where business_id = new.business_id and active and id <> new.id;

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
-- PARTE 6 — Acessos da equipe (recepção e profissional) só no Equipe
-- Vale para NOVOS acessos. Os existentes nunca são apagados: num plano
-- sem equipe ficam pausados pelo painel e voltam ao assinar o Equipe.
-- =====================================================================
create or replace function enforce_team_access_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role in ('staff', 'reception')
     and (tg_op = 'INSERT' or new.role is distinct from old.role)
     and plan_kind(new.business_id) <> 'equipe' then
    raise exception 'PLANO_EQUIPE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_team_access_plan on business_members;
create trigger trg_team_access_plan
before insert or update of role on business_members
for each row execute function enforce_team_access_plan();


-- =====================================================================
-- PARTE 7 — Horários da vitrine (versão da 06 com o limite vindo do banco)
-- Corpo igual ao da 06; mudam só: o limite diário (free_daily_limit) e o
-- "único profissional" que agora vale para todo plano com limite de 1.
-- Contas com mais pedidos já marcados num dia: nada é cancelado; só não
-- aparecem horários novos naquele dia.
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
  b        businesses;
  s        services;
  h        business_hours;
  v_now    timestamp;
  v_today  date;
  t        time;
  v_end    time;
  ids      uuid[];
  v_only   uuid;          -- plano com 1 profissional: único que recebe agendamentos
  v_count  int;
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
-- PARTE 8 — Informações públicas do plano (versão da 06 + limite do banco)
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
    'tier',                 v_tier,
    'show_badge',           v_tier = 'gratis',
    'only_professional_id', v_only,
    'day_full',             v_full
  );
end;
$$;

grant execute on function public_plan_info(text, date) to anon, authenticated;


-- =====================================================================
-- PARTE 9 — Avaliações: a matriz modera em qualquer plano
-- (antes: só no Completo — 10_papeis_equipe, PARTE 7)
-- =====================================================================
drop policy if exists "matriz modera avaliacoes" on reviews;
create policy "matriz modera avaliacoes" on reviews
  for update to authenticated
  using (is_business_owner(business_id))
  with check (is_business_owner(business_id));

drop policy if exists "matriz exclui avaliacoes" on reviews;
create policy "matriz exclui avaliacoes" on reviews
  for delete to authenticated
  using (is_business_owner(business_id));


-- =====================================================================
-- PARTE 10 — Conferência
-- =====================================================================
select id, kind, active, base_price, included_professionals, extra_professional_price,
       max_professionals, online_daily_limit
from plans order by kind, billing_cycle;


-- =====================================================================
-- REVERSÃO DA PARTE A (rodar só se precisar desfazer; antes, volte o
-- código e rode a reversão da PARTE B, se ela já tiver rodado)
-- =====================================================================
-- 1) Avaliações (volta a regra da 10):
-- drop policy if exists "matriz modera avaliacoes" on reviews;
-- create policy "matriz modera avaliacoes" on reviews for update to authenticated
--   using (is_business_owner(business_id) and access_tier(business_id) = 'completo')
--   with check (is_business_owner(business_id) and access_tier(business_id) = 'completo');
-- drop policy if exists "matriz exclui avaliacoes" on reviews;
-- create policy "matriz exclui avaliacoes" on reviews for delete to authenticated
--   using (is_business_owner(business_id) and access_tier(business_id) = 'completo');
-- 2) get_available_slots, public_plan_info e enforce_free_professional_limit:
--    cole e rode as PARTES 2.4, 3 e 4 de 06_plano_gratis.sql (create or replace).
-- 3) Depois:
-- drop trigger  if exists trg_team_access_plan on business_members;
-- drop function if exists enforce_team_access_plan();
-- drop function if exists free_daily_limit();
-- drop function if exists plan_max_professionals(uuid);
-- drop function if exists plan_kind(uuid);
-- alter table subscriptions drop column if exists upgrade_invoice_url, drop column if exists upgrade_amount, drop column if exists upgrade_payment_id,
--   drop column if exists upgrade_plan_id, drop column if exists scheduled_at, drop column if exists scheduled_plan_id;
-- delete from plans where id in ('gratis', 'profissional_mensal', 'profissional_anual', 'equipe_mensal', 'equipe_anual')
--   and not exists (select 1 from subscriptions s where s.plan_id = plans.id);
-- alter table plans drop constraint if exists plans_kind_valid;
-- alter table plans drop column if exists online_daily_limit, drop column if exists max_professionals, drop column if exists kind;
-- =====================================================================
