-- =====================================================================
-- GENIX AGENDA — 52: Plano Básico + Grátis de 6 meses (PARTE A)
-- Rode o arquivo inteiro no SQL Editor, ANTES do merge. Só acrescenta:
-- o código atual continua funcionando com ela. Tudo dentro de
-- begin/commit: se qualquer comando falhar, nada fica aplicado.
-- A PARTE B (52b_planos_basico_ativar.sql) roda DEPOIS do deploy.
--
-- Regras:
--   • Ordem dos planos: gratis < basico < profissional < equipe.
--     plan_allows(bid, 'basico' | 'profissional' | 'equipe') diz se o
--     plano do espaço chega lá. Cortesia (38) continua antes de tudo.
--   • access_tier continua 'completo' (pago/teste/cortesia) | 'gratis'.
--     O que já era "pago" e passa a ser do Básico (caixa, financeiro,
--     recorrência, bloqueios, ilimitado) continua usando access_tier.
--   • O que passa a ser só do Profissional (pacotes, combos, WhatsApp
--     automático) troca para plan_allows(bid, 'profissional').
--     Com esta parte, ninguém muda de acesso: ainda não existe assinante
--     do Básico (os planos nascem inativos).
--   • subscriptions.free_ends_at: fim dos 6 meses do Grátis. Contas
--     novas: cadastro + 6 meses (o teste de 15 dias fica dentro). Contas
--     que já existem: a PARTE B grava a data (publicação + 6 meses).
--     null = sem fim (nada bloqueia).
--   • free_period_over(bid): Grátis e free_ends_at passou → a vitrine
--     para de aceitar agendamento online. Painel e manual continuam.
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Plano Básico (nasce INATIVO; a PARTE B ativa e acerta preços)
-- Anual = 10 × mensal. 1 profissional, sem extra.
-- =====================================================================
alter table plans drop constraint if exists plans_kind_valid;
alter table plans add constraint plans_kind_valid check (kind in ('gratis', 'basico', 'profissional', 'equipe'));

insert into plans (id, name, billing_cycle, base_price, included_professionals, extra_professional_price,
                   active, kind, max_professionals, online_daily_limit)
values
  ('basico_mensal', 'Básico mensal', 'MONTHLY',  28.70, 1, 0.00, false, 'basico', 1, null),
  ('basico_anual',  'Básico anual',  'YEARLY',  287.00, 1, 0.00, false, 'basico', 1, null)
on conflict (id) do update
set name = excluded.name,
    billing_cycle = excluded.billing_cycle,
    base_price = excluded.base_price,
    included_professionals = excluded.included_professionals,
    extra_professional_price = excluded.extra_professional_price,
    kind = excluded.kind,
    max_professionals = excluded.max_professionals;
-- (active não é sobrescrito ao rodar de novo)


-- =====================================================================
-- PARTE 2 — Ordem dos planos
-- plan_kind (38) já devolve 'basico' para quem assina basico_* (vem de
-- plans.kind); teste, conta interna e assinante antigo continuam Equipe.
-- =====================================================================
create or replace function plan_rank(p_kind text)
returns int
language sql immutable
as $$
  select case p_kind
    when 'gratis'       then 0
    when 'basico'       then 1
    when 'profissional' then 2
    when 'equipe'       then 3
    else 0
  end;
$$;
grant execute on function plan_rank(text) to authenticated;

create or replace function plan_allows(bid uuid, p_min text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select plan_rank(plan_kind(bid)) >= plan_rank(p_min);
$$;
grant execute on function plan_allows(uuid, text) to authenticated;


-- =====================================================================
-- PARTE 3 — Grátis de 6 meses
-- A coluna entra SEM valor (contas atuais ficam null até a PARTE B);
-- o padrão vale só para as assinaturas criadas daqui em diante
-- (create_business_for_user grava a linha no cadastro).
-- =====================================================================
alter table subscriptions add column if not exists free_ends_at timestamptz;
alter table subscriptions alter column free_ends_at set default (now() + interval '6 months');

create or replace function free_period_over(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select access_tier(bid) = 'gratis'
     and coalesce((select s.free_ends_at <= now() from subscriptions s where s.business_id = bid), false);
$$;
grant execute on function free_period_over(uuid) to authenticated;


-- =====================================================================
-- PARTE 4 — Limite de profissionais: mensagem do Básico e troca agendada
-- (corpo da 29; mudam a troca agendada para Básico e o erro do Básico)
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
     where s.business_id = new.business_id and p.kind in ('basico', 'profissional')   -- 52
  ) then
    raise exception 'TROCA_AGENDADA';
  end if;

  v_max := plan_max_professionals(new.business_id);
  if v_max is null then return new; end if;

  if v_count >= v_max then
    if plan_kind(new.business_id) = 'gratis' then
      raise exception 'LIMITE_PLANO_GRATIS';
    elsif plan_kind(new.business_id) = 'basico' then
      raise exception 'LIMITE_PLANO_BASICO';   -- 52
    else
      raise exception 'LIMITE_PLANO_PROFISSIONAL';
    end if;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- PARTE 5 — Vitrine
-- 5.1 Horários (corpo da 32): Grátis vencido não tem horário; combos só
--     a partir do Profissional.
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

  -- 52: Grátis depois dos 6 meses não recebe agendamento online
  if free_period_over(b.id) then return; end if;

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
   where id = p_service_id and business_id = b.id and active and bookable_online
     and (kind = 'servico' or plan_allows(b.id, 'profissional'));   -- 32_combos
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
         and professional_does_service(p.id, s.id)                 -- 32_combos
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

-- 5.2 Informações públicas (corpo da 29) + 'kind' e 'online_closed'
--     (a vitrine mostra mensagem neutra, sem dizer o motivo)
create or replace function public_plan_info(p_slug text, p_date date default null)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_tier  text;
  v_only  uuid;
  v_full  boolean := false;
  v_kind  text;
begin
  select id into v_id from businesses where slug = p_slug and is_published;
  if v_id is null then return null; end if;

  v_tier := access_tier(v_id);
  v_kind := plan_kind(v_id);

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
    'blocked_professional_ids', billing_blocked_professionals(v_id),
    'kind',                     v_kind,                    -- 52: qual plano (combos só no Profissional+)
    'online_closed',            free_period_over(v_id)     -- 52: vitrine sem agendamento online
  );
end;
$$;

-- 5.3 Defesa no banco: pedido online de Grátis vencido não entra
--     (create_public_booking já recusa pelo horário; isto cobre o resto)
create or replace function guard_online_booking_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.source = 'online' and free_period_over(new.business_id) then
    raise exception 'AGENDA_INDISPONIVEL';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_online_booking_plan on bookings;
create trigger trg_guard_online_booking_plan
before insert on bookings
for each row execute function guard_online_booking_plan();


-- =====================================================================
-- PARTE 6 — A partir do Profissional: pacotes, combos, WhatsApp automático
-- Corpos copiados da última versão de cada função; muda só a checagem
-- (access_tier = 'completo' → plan_allows(.., 'profissional')) e o erro
-- (PLANO_GRATIS → PLANO_PROFISSIONAL).
-- =====================================================================

-- 6.1 Modelos de pacote (RLS da 19)
drop policy if exists "matriz cria modelos de pacote" on package_templates;
create policy "matriz cria modelos de pacote" on package_templates
  for insert to authenticated
  with check (member_role_of(business_id) = 'owner' and plan_allows(business_id, 'profissional'));

drop policy if exists "matriz altera modelos de pacote" on package_templates;
create policy "matriz altera modelos de pacote" on package_templates
  for update to authenticated
  using (member_role_of(business_id) = 'owner' and plan_allows(business_id, 'profissional'));

drop policy if exists "matriz exclui modelos de pacote" on package_templates;
create policy "matriz exclui modelos de pacote" on package_templates
  for delete to authenticated
  using (member_role_of(business_id) = 'owner' and plan_allows(business_id, 'profissional'));

-- 6.2 Pacotes (corpo da 37 e da 39)
create or replace function save_package_template(
  p_business uuid, p_id uuid, p_name text, p_price numeric, p_validity_days int, p_items jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_n     int;
  v_found int;
  v_total int;
  v_min   int;
  v_max   int;
  v_one   uuid;
  v_id    uuid;
  v_prev  text := coalesce(current_setting('genix.package_edit', true), '');
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(p_business, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'NOME_INVALIDO'; end if;
  if p_price is null or p_price < 0 or p_price > 99999999 then raise exception 'PRECO_INVALIDO'; end if;
  if p_validity_days is not null and p_validity_days not between 1 and 730 then raise exception 'VALIDADE_INVALIDA'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'QUANTIDADE_INVALIDA'; end if;

  begin
    select count(*), count(distinct x.service_id), coalesce(sum(x.sessions), 0), min(x.sessions), max(x.sessions),
           min(x.service_id::text)::uuid
      into v_n, v_found, v_total, v_min, v_max, v_one
      from jsonb_to_recordset(p_items) as x(service_id uuid, sessions int);
  exception
    when others then raise exception 'QUANTIDADE_INVALIDA';
  end;
  if v_n < 1 or v_n > 6 or v_found <> v_n then raise exception 'QUANTIDADE_INVALIDA'; end if;
  if v_min is null or v_min < 1 or v_max > 100 or v_total > 100 then raise exception 'SESSOES_INVALIDAS'; end if;

  select count(*) into v_found
    from services s join jsonb_to_recordset(p_items) as x(service_id uuid, sessions int) on x.service_id = s.id
   where s.business_id = p_business and s.kind = 'servico' and s.active;
  if v_found <> v_n then raise exception 'SERVICOS_INVALIDOS'; end if;

  if v_n <> 1 then v_one := null; end if;

  perform set_config('genix.package_edit', '1', true);

  if p_id is null then
    insert into package_templates (business_id, service_id, name, sessions, price, validity_days, sort_order)
    values (p_business, v_one, v_name, v_total, round(p_price, 2), p_validity_days,
            coalesce((select max(sort_order) from package_templates where business_id = p_business), 0) + 1)
    returning id into v_id;
  else
    update package_templates
       set service_id = v_one, name = v_name, sessions = v_total,
           price = round(p_price, 2), validity_days = p_validity_days
     where id = p_id and business_id = p_business
    returning id into v_id;
    if v_id is null then raise exception 'NAO_ENCONTRADO'; end if;
    delete from package_template_items where template_id = v_id;
  end if;

  insert into package_template_items (template_id, service_id, business_id, sessions, position)
  select v_id, x.service_id, p_business, x.sessions, (t.ord - 1)::smallint
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    cross join lateral jsonb_to_record(t.e) as x(service_id uuid, sessions int);

  perform set_config('genix.package_edit', v_prev, true);
  return v_id;
end;
$$;
create or replace function check_package_sale(p_customer uuid, p_template uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  t package_templates;
begin
  select * into t from package_templates where id = p_template;
  if not found or not t.active then raise exception 'MODELO_INVALIDO'; end if;
  if coalesce(member_role_of(t.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(t.business_id, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
  if not exists (select 1 from customers where id = p_customer and business_id = t.business_id) then
    raise exception 'CLIENTE_INVALIDO';
  end if;
  return t.business_id;
end;
$$;

-- 6.3 Combos (corpos da 32 e da 37)
create or replace function save_combo(
  p_business uuid, p_id uuid, p_name text, p_description text, p_category text,
  p_price numeric, p_service_ids uuid[]
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_n      int := coalesce(array_length(p_service_ids, 1), 0);
  v_found  int;
  v_normal numeric;
  v_dur    int;
  v_id     uuid;
  v_prev   text := coalesce(current_setting('genix.combo_edit', true), '');
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(p_business, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'NOME_INVALIDO'; end if;
  if v_n < 2 or v_n > 6 or (select count(distinct x) from unnest(p_service_ids) x) <> v_n then
    raise exception 'QUANTIDADE_INVALIDA';
  end if;

  select count(*), coalesce(sum(price), 0), coalesce(sum(duration_min), 0)
    into v_found, v_normal, v_dur
    from services
   where id = any(p_service_ids) and business_id = p_business and kind = 'servico' and active;
  if v_found <> v_n then raise exception 'SERVICOS_INVALIDOS'; end if;
  if p_price is null or p_price < 0 then raise exception 'PRECO_INVALIDO'; end if;
  if round(p_price, 2) > v_normal then raise exception 'PRECO_ACIMA'; end if;
  if v_dur > 600 then raise exception 'DURACAO_MAXIMA'; end if;

  perform set_config('genix.combo_edit', '1', true);

  if p_id is null then
    insert into services (business_id, kind, name, description, category, price, duration_min, sort_order)
    values (p_business, 'combo', v_name, nullif(btrim(coalesce(p_description, '')), ''),
            nullif(btrim(coalesce(p_category, '')), ''), round(p_price, 2), v_dur,
            coalesce((select max(sort_order) from services where business_id = p_business), 0) + 1)
    returning id into v_id;
  else
    update services
       set name = v_name,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           category = nullif(btrim(coalesce(p_category, '')), ''),
           price = round(p_price, 2),
           duration_min = v_dur
     where id = p_id and business_id = p_business and kind = 'combo'
    returning id into v_id;
    if v_id is null then raise exception 'NAO_ENCONTRADO'; end if;
    delete from combo_items where combo_id = v_id;
  end if;

  insert into combo_items (combo_id, service_id, business_id, position)
  select v_id, t.x, p_business, (t.ord - 1)::smallint
    from unnest(p_service_ids) with ordinality as t(x, ord);

  perform set_config('genix.combo_edit', v_prev, true);
  return v_id;
end;
$$;
create or replace function create_booking_first_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text;
  v_pi   uuid;
begin
  if new.customer_package_id is not null then
    select id into v_pi from customer_package_items
     where customer_package_id = new.customer_package_id and service_id = new.service_id
     order by position limit 1;
    if v_pi is null then raise exception 'PACOTE_INVALIDO'; end if;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from booking_items where booking_id = new.id) then return new; end if;
    select kind into v_kind from services where id = new.service_id;

    if v_kind = 'combo' then
      if new.customer_package_id is not null then raise exception 'PACOTE_INVALIDO'; end if;
      if not plan_allows(new.business_id, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
      if not professional_does_service(new.professional_id, new.service_id) then
        raise exception 'PROFISSIONAL_NAO_FAZ';
      end if;
      perform add_service_items(new.id, new.service_id, 0, true, false, new.price, new.created_at);
      perform recalc_booking(new.id);
    else
      insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                                 position, extends_time, paid_by_package, added_by, created_at,
                                 customer_package_item_id)
      values (new.id, new.business_id, new.service_id, new.service_name, new.price, new.duration_min,
              0, true, new.customer_package_id is not null, auth.uid(), new.created_at,
              v_pi)
      on conflict (booking_id, position) do nothing;
    end if;
  elsif new.customer_package_id is distinct from old.customer_package_id then
    update booking_items
       set customer_package_item_id = v_pi,
           paid_by_package = v_pi is not null
     where booking_id = new.id and position = 0;
  end if;
  return new;
end;
$$;
create or replace function booking_add_item(
  p_booking uuid, p_service uuid, p_extend boolean default true, p_package_item uuid default null
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk     bookings;
  s      services;
  v_n    int;
  v_pos  int;
  v_add  int;
  v_endm int;
  v_end  time;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  select * into s from services where id = p_service and business_id = bk.business_id and active;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;
  if s.kind = 'combo' and not plan_allows(bk.business_id, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
  if not professional_does_service(bk.professional_id, s.id) then raise exception 'PROFISSIONAL_NAO_FAZ'; end if;

  -- 37_plano_fechado: o serviço do pacote precisa ser este serviço
  if p_package_item is not null and (
       s.kind = 'combo'
       or not exists (select 1 from customer_package_items where id = p_package_item and service_id = s.id)
     ) then
    raise exception 'PACOTE_INVALIDO';
  end if;

  select count(*), coalesce(max(position), 0) + 1 into v_n, v_pos from booking_items where booking_id = bk.id;
  v_add := case when s.kind = 'combo' then (select count(*) from combo_items where combo_id = s.id) else 1 end;
  if v_n + v_add > 10 then raise exception 'LIMITE_ITENS'; end if;

  if p_extend then
    v_endm := extract(hour from bk.end_time)::int * 60 + extract(minute from bk.end_time)::int + s.duration_min;
    if v_endm >= 24 * 60 then raise exception 'MEIA_NOITE'; end if;
    v_end := make_time(v_endm / 60, v_endm % 60, 0);

    if slot_conflicts_block(bk.business_id, bk.professional_id, bk.booking_date, bk.end_time, v_end) then
      raise exception 'BLOQUEIO';
    end if;
    if exists (
      select 1 from bookings o
       where o.professional_id = bk.professional_id
         and o.status in ('pending', 'confirmed')
         and o.id <> bk.id
         and o.period && tsrange(bk.booking_date + bk.end_time, bk.booking_date + v_end, '[)')
    ) then
      raise exception 'OCUPADO';
    end if;
  end if;

  if p_package_item is not null then
    insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                               position, extends_time, paid_by_package, added_by, customer_package_item_id)
    values (bk.id, bk.business_id, s.id, s.name, s.price, s.duration_min,
            v_pos, p_extend, true, auth.uid(), p_package_item);
  else
    perform add_service_items(bk.id, s.id, v_pos, p_extend, false, s.price);
  end if;

  begin
    perform recalc_booking(bk.id);
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'item_added', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('service', s.name, 'price', s.price, 'duration', s.duration_min, 'extended', p_extend,
                             'combo', s.kind = 'combo', 'package', p_package_item is not null));

  return json_build_object('ok', true);
end;
$$;
create or replace function booking_edit_info(p_booking uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  bk     bookings;
  v_role text;
  v_lim  numeric;
  v_paid boolean;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;

  v_role := member_role_of(bk.business_id);
  if v_role = 'staff' then
    select staff_discount_max_pct into v_lim from businesses where id = bk.business_id;
  end if;
  v_paid := plan_allows(bk.business_id, 'profissional');

  return json_build_object(
    'status',          bk.status,
    'start_time',      to_char(bk.start_time, 'HH24:MI'),
    'end_time',        to_char(bk.end_time, 'HH24:MI'),
    'price',           bk.price,
    'discount_kind',   bk.discount_kind,
    'discount_input',  bk.discount_input,
    'discount_amount', bk.discount_amount,
    'discount_reason', bk.discount_reason,
    'discount_limit',  v_lim,
    'items', coalesce((
      select json_agg(json_build_object(
               'id', i.id, 'service_id', i.service_id, 'name', i.service_name, 'price', i.price,
               'duration', i.duration_min, 'position', i.position, 'extends_time', i.extends_time,
               'paid_by_package', i.paid_by_package, 'combo_group', i.combo_group, 'combo_name', i.combo_name,
               'package_item_id', i.customer_package_item_id)
               order by i.position)
        from booking_items i where i.booking_id = bk.id), '[]'::json),
    'services', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name, 'price', s.price, 'duration', s.duration_min,
                                        'kind', s.kind,
                                        'normal_price', case when s.kind = 'combo' then
                                          (select coalesce(sum(c.price), 0) from combo_items ci
                                             join services c on c.id = ci.service_id where ci.combo_id = s.id) end)
                      order by s.kind desc, s.sort_order, s.name)
        from services s
       where s.business_id = bk.business_id and s.active
         and (s.kind = 'servico' or v_paid)
         and professional_does_service(bk.professional_id, s.id)), '[]'::json),
    'package_options', coalesce((
      select json_agg(json_build_object('id', pi.id, 'service_id', pi.service_id, 'package_name', cp.name,
                                        'remaining', pi.sessions_total - package_item_used(pi.id))
                      order by cp.sold_at, pi.position)
        from customer_package_items pi
        join customer_packages cp on cp.id = pi.customer_package_id
       where bk.customer_id is not null
         and cp.customer_id = bk.customer_id
         and cp.business_id = bk.business_id
         and cp.status = 'active'
         and (cp.expires_at is null or cp.expires_at >= bk.booking_date)
         and pi.service_id is not null
         and package_item_used(pi.id) < pi.sessions_total), '[]'::json)
  );
end;
$$;

-- 6.4 WhatsApp automático (corpos da 34, 42 e 45)
create or replace function set_whatsapp_auto(p_business uuid, p_enabled boolean, p_accept_risk boolean default false)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_accept boolean := coalesce(p_accept_risk, false);
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;

  if p_enabled then
    if not plan_allows(p_business, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
    if not exists (select 1 from whatsapp_instances where business_id = p_business and genix_enabled) then
      raise exception 'NAO_HABILITADO';
    end if;
    if not v_accept and not exists (select 1 from whatsapp_settings
                                     where business_id = p_business and risk_accepted_at is not null) then
      raise exception 'ACEITE_OBRIGATORIO';
    end if;

    if v_accept then
      insert into whatsapp_settings (business_id, auto_enabled, risk_accepted_by, risk_accepted_at)
      values (p_business, true, auth.uid(), now())
      on conflict (business_id) do update
        set auto_enabled = true, risk_accepted_by = auth.uid(), risk_accepted_at = now();
    else
      update whatsapp_settings set auto_enabled = true where business_id = p_business;
    end if;
  else
    insert into whatsapp_settings (business_id, auto_enabled) values (p_business, false)
    on conflict (business_id) do update set auto_enabled = false;
  end if;
end;
$$;
create or replace function next_auto_message(p_business uuid)
returns table (send_id uuid)
language plpgsql stable security definer set search_path = public
as $$
declare
  b     businesses;
  st    whatsapp_settings;
  inst  whatsapp_instances;
  v_now timestamp;
begin
  select * into b from businesses where id = p_business;
  if not found then return; end if;
  select * into st from whatsapp_settings where business_id = b.id;
  if not found or not st.auto_enabled then return; end if;
  select * into inst from whatsapp_instances where business_id = b.id;
  if not found or not inst.genix_enabled then return; end if;
  if not plan_allows(b.id, 'profissional') then return; end if;

  v_now := now() at time zone b.timezone;
  if v_now::time < time '08:00' or v_now::time >= time '20:00' then return; end if;
  if not whatsapp_number_ready(b.id) then return; end if;

  return query
  select s.id
    from whatsapp_reminder_sends s
   where s.business_id = b.id
     and s.status = 'queued'
     and s.due_at <= now()
     and s.expires_at > now()
   order by s.priority, s.due_at, s.created_at
   limit 1;
end;
$$;
create or replace function next_auto_reminder(p_business uuid)
returns table (booking_id uuid, attempt smallint)
language plpgsql stable security definer set search_path = public
as $$
declare
  b     businesses;
  st    whatsapp_settings;
  inst  whatsapp_instances;
  v_now timestamp;
  v_today date;
begin
  select * into b from businesses where id = p_business;
  if not found then return; end if;
  select * into st from whatsapp_settings where business_id = b.id;
  if not found or not st.auto_enabled or not st.eve_enabled then return; end if;
  select * into inst from whatsapp_instances where business_id = b.id;
  if not found or not inst.genix_enabled then return; end if;
  if not plan_allows(b.id, 'profissional') then return; end if;

  v_now   := now() at time zone b.timezone;
  v_today := v_now::date;
  if v_now::time < time '08:00' or v_now::time >= time '20:00' then return; end if;

  if not whatsapp_number_ready(b.id) then return; end if;

  return query
  select bk.id, (case when a.n = 0 then 1 else 2 end)::smallint
    from bookings bk
    left join customers c on c.id = bk.customer_id
    cross join lateral (
      select count(*) as n,
             coalesce(bool_or(s.status in ('sending', 'sent')), false) as blocked,
             coalesce(bool_or(s.status = 'failed' and s.retryable
                              and s.created_at <= now() - interval '30 minutes'), false) as can_retry
        from whatsapp_reminder_sends s
       where s.booking_id = bk.id and s.kind = 'eve'
         and s.booking_date = bk.booking_date and s.start_time = bk.start_time
         and s.status in ('sending', 'sent', 'failed')
    ) a
   where bk.business_id = b.id
     and bk.status = 'confirmed'
     and bk.reminder_sent_at is null
     and not coalesce(c.no_auto_reminders, false)
     and phone_is_valid(bk.customer_phone_country, normalize_phone(bk.customer_phone, bk.customer_phone_country))
     and ( bk.booking_date = v_today + 1
           or (bk.booking_date = v_today and bk.booking_date + bk.start_time >= v_now + interval '2 hours') )
     and ( a.n = 0 or (a.n = 1 and not a.blocked and a.can_retry) )
   order by bk.booking_date, bk.start_time
   limit 1;
end;
$$;
create or replace function whatsapp_queue_refresh()
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  b        record;
  v_now    timestamp;
  v_today  date;
  v_n      int;
  v_queued int := 0;
  v_exp    int := 0;
  v_skip   int := 0;
  v_exp_n  int;
  v_skip_n int;
begin
  -- espaço que saiu das condições (automático desligado, sem liberação ou
  -- plano Grátis): o que estava na fila não sai mais
  with x as (
    update whatsapp_reminder_sends s
       set status = 'skipped', reason = 'DESLIGADO', finished_at = now()
     where s.status = 'queued'
       and not exists (select 1
                         from whatsapp_settings st
                         join whatsapp_instances i on i.business_id = st.business_id and i.genix_enabled
                        where st.business_id = s.business_id and st.auto_enabled
                          and plan_allows(st.business_id, 'profissional'))
    returning 1
  )
  select count(*) into v_skip from x;

  for b in
    select bz.id, bz.timezone, st.eve_enabled, st.confirm_enabled, st.confirm_since,
           st.before_enabled, st.before_minutes, st.birthday_enabled
      from businesses bz
      join whatsapp_settings  st on st.business_id = bz.id and st.auto_enabled
      join whatsapp_instances i  on i.business_id  = bz.id and i.genix_enabled
     where plan_allows(bz.id, 'profissional')
  loop
    v_now   := now() at time zone b.timezone;
    v_today := v_now::date;

    -- (a0) véspera marcada JA_LEMBRADO cujo lembrete manual foi desmarcado:
    -- volta para a fila enquanto vale
    if b.eve_enabled then
      update whatsapp_reminder_sends s
         set status = 'queued', reason = null, finished_at = null
        from bookings bk
       where s.business_id = b.id
         and s.kind = 'eve' and s.status = 'skipped' and s.reason = 'JA_LEMBRADO'
         and s.expires_at > now()
         and bk.id = s.booking_id and bk.status = 'confirmed' and bk.reminder_sent_at is null
         and bk.booking_date = s.booking_date and bk.start_time = s.start_time;
    end if;

    -- (a) linhas da fila que perderam o sentido
    with x as (
      update whatsapp_reminder_sends s
         set status = 'skipped', finished_at = now(),
             reason = case
               when (s.kind = 'confirmation' and not b.confirm_enabled)
                 or (s.kind = 'before' and not b.before_enabled)
                 or (s.kind = 'eve' and not b.eve_enabled)
                 or (s.kind = 'birthday' and not b.birthday_enabled)        then 'DESLIGADO'
               when s.kind = 'birthday' and (c.id is null or c.no_auto_reminders) then 'OPT_OUT'
               when s.kind = 'birthday'                                     then 'NUMERO_INVALIDO'
               when bk.id is null or bk.status = 'cancelled'                then 'CANCELADO'
               when bk.booking_date <> s.booking_date or bk.start_time <> s.start_time then 'REMARCADO'
               when bk.status <> 'confirmed'                                then 'NAO_CONFIRMADO'
               when s.kind = 'eve' and bk.reminder_sent_at is not null      then 'JA_LEMBRADO'
               when coalesce(bc.no_auto_reminders, false)                   then 'OPT_OUT'
               else 'NUMERO_INVALIDO'
             end
        from whatsapp_reminder_sends s0
        left join bookings  bk on bk.id = s0.booking_id
        left join customers bc on bc.id = bk.customer_id
        left join customers c  on c.id  = s0.customer_id
       where s.id = s0.id
         and s0.business_id = b.id
         and s0.status = 'queued'
         and ( (s0.kind = 'confirmation' and not b.confirm_enabled)
            or (s0.kind = 'before' and not b.before_enabled)
            or (s0.kind = 'eve' and not b.eve_enabled)
            or (s0.kind = 'birthday' and not b.birthday_enabled)
            or (s0.kind = 'birthday' and (c.id is null or c.no_auto_reminders or not phone_is_valid(c.phone_country, c.phone)))
            or (s0.kind <> 'birthday' and (
                  bk.id is null
               or bk.status <> 'confirmed'
               or bk.booking_date <> s0.booking_date or bk.start_time <> s0.start_time
               or (s0.kind = 'eve' and bk.reminder_sent_at is not null)
               or coalesce(bc.no_auto_reminders, false)
               or not phone_is_valid(bk.customer_phone_country, normalize_phone(bk.customer_phone, bk.customer_phone_country)))) )
      returning 1
    )
    select count(*) into v_n from x;
    v_skip := v_skip + v_n;

    -- (b) regra das 6 h (44): outra mensagem do mesmo agendamento + horário
    -- saiu há menos de 6 h → adia para 6 h depois dela (levado à janela);
    -- DISPENSADA só se esse horário não cabe mais na validade
    with r as (
      select s.id, s.expires_at,
             whatsapp_window_start(max(o.sent_at) + interval '6 hours', b.timezone) as new_due
        from whatsapp_reminder_sends s
        join whatsapp_reminder_sends o
          on o.booking_id = s.booking_id and o.kind <> s.kind
         and o.booking_date = s.booking_date and o.start_time = s.start_time
         and o.status = 'sent' and o.sent_at > now() - interval '6 hours'
       where s.business_id = b.id
         and s.status = 'queued'
         and s.booking_id is not null
       group by s.id, s.expires_at
    ), x as (
      update whatsapp_reminder_sends s
         set status      = case when r.new_due >= r.expires_at then 'skipped'    else s.status      end,
             reason      = case when r.new_due >= r.expires_at then 'DISPENSADA' else s.reason      end,
             finished_at = case when r.new_due >= r.expires_at then now()        else s.finished_at end,
             due_at      = case when r.new_due >= r.expires_at then s.due_at     else r.new_due     end
        from r
       where s.id = r.id
         and (r.new_due >= r.expires_at or s.due_at < r.new_due)
      returning (r.new_due >= r.expires_at) as dropped
    )
    select count(*) filter (where dropped) into v_n from x;
    v_skip := v_skip + v_n;

    -- (c) EXPIRADA: passou da validade sem sair (fica no histórico do agendamento)
    with x as (
      update whatsapp_reminder_sends s
         set status = 'skipped', reason = 'EXPIRADA', finished_at = now()
       where s.business_id = b.id
         and s.status = 'queued'
         and s.expires_at <= now()
      returning s.booking_id, s.kind
    ), ev as (
      insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
      select x.booking_id, b.id, 'whatsapp_auto_expired', null, 'automatico', jsonb_build_object('kind', x.kind)
        from x where x.booking_id is not null
      returning 1
    )
    select count(*) into v_n from x;
    v_exp := v_exp + v_n;

    -- (d) 2ª tentativa: falha temporária há 30 min ou mais, ainda dentro da validade
    with x as (
      insert into whatsapp_reminder_sends
        (business_id, booking_id, customer_id, kind, booking_date, start_time, attempt, variant,
         status, priority, due_at, expires_at, claimed_at)
      select s.business_id, s.booking_id, s.customer_id, s.kind, s.booking_date, s.start_time, 2, 0,
             'queued', s.priority, now(), s.expires_at, null
        from whatsapp_reminder_sends s
       where s.business_id = b.id
         and s.status = 'failed' and s.retryable and s.attempt = 1
         and s.due_at is not null
         and coalesce(s.finished_at, s.created_at) <= now() - interval '30 minutes'
         and s.expires_at > now()
      on conflict do nothing
      returning 1
    )
    select count(*) into v_n from x;
    v_queued := v_queued + v_n;

    -- (e) CONFIRMAÇÃO: 5 min depois do último "ficou confirmado" (criado
    -- confirmado, confirmado ou remarcado), levado à abertura da janela se
    -- cair fora dela; vale 2 h, nunca depois do horário.
    if b.confirm_enabled and b.confirm_since is not null then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time,
               whatsapp_window_start(a.anchor + interval '5 minutes', b.timezone) as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) as start_ts
          from bookings bk
          cross join lateral (
            select max(e.created_at) as anchor
              from booking_events e
             where e.booking_id = bk.id
               and (e.action in ('confirmed', 'rescheduled')
                    or (e.action = 'created' and e.details->>'status' = 'confirmed'))
          ) a
         where bk.business_id = b.id
           and bk.status = 'confirmed'
           and bk.booking_date between v_today and v_today + 2
           and a.anchor >= b.confirm_since
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'confirmation', c.booking_date, c.start_time, 1, 0,
               'queued', 1, c.due, least(c.due + interval '2 hours', c.start_ts), null
          from cand c
         where c.due <= now() and now() < least(c.due + interval '2 hours', c.start_ts)
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;

    -- (f) ANTES DO HORÁRIO: início − 60/90/120 min (ou na criação, se depois); vale até o início
    if b.before_enabled then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time,
               greatest(((bk.booking_date + bk.start_time) at time zone b.timezone)
                          - make_interval(mins => b.before_minutes), bk.created_at) as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) as start_ts
          from bookings bk
         where bk.business_id = b.id
           and bk.status = 'confirmed'
           and bk.booking_date between v_today and v_today + 2
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'before', c.booking_date, c.start_time, 1, 0,
               'queued', 2, c.due, c.start_ts, null
          from cand c
         where c.due <= now() and now() < c.start_ts
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;

    -- (g) VÉSPERA (44): maior(08:00 do dia anterior, último "ficou confirmado"
    -- + 5 min), para a confirmação sair antes; vale até 2 h antes do horário.
    -- Nunca some sem registro: lembrete manual já marcado → JA_LEMBRADO;
    -- confirmado/remarcado perto demais do horário (não cabe) → EXPIRADA.
    if b.eve_enabled then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time, bk.reminder_sent_at,
               coalesce(a.anchor, bk.created_at) as anchor,
               greatest(((bk.booking_date - 1) + time '08:00') at time zone b.timezone,
                        coalesce(a.anchor, bk.created_at) + interval '5 minutes') as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) - interval '2 hours' as exp
          from bookings bk
          cross join lateral (
            select max(e.created_at) as anchor
              from booking_events e
             where e.booking_id = bk.id
               and (e.action in ('confirmed', 'rescheduled')
                    or (e.action = 'created' and e.details->>'status' = 'confirmed'))
          ) a
         where bk.business_id = b.id
           and bk.status = 'confirmed'
           and bk.booking_date between v_today and v_today + 2
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, reason, finished_at, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'eve', c.booking_date, c.start_time, 1, 0,
               case when c.reminder_sent_at is not null or c.due >= c.exp then 'skipped' else 'queued' end,
               case when c.reminder_sent_at is not null then 'JA_LEMBRADO'
                    when c.due >= c.exp                 then 'EXPIRADA' end,
               case when c.reminder_sent_at is not null or c.due >= c.exp then now() end,
               3, c.due, c.exp, null
          from cand c
         where ( (c.due <= now() and now() < c.exp)       -- na hora: fila ou JA_LEMBRADO
              or (c.due >= c.exp and c.anchor < c.exp) )   -- não coube: EXPIRADA
           -- o caminho antigo pode já ter criado a tentativa 1 (status sending/sent/failed)
           and not exists (select 1 from whatsapp_reminder_sends o
                            where o.booking_id = c.id and o.kind = 'eve'
                              and o.booking_date = c.booking_date and o.start_time = c.start_time)
        on conflict do nothing
        returning booking_id, status, reason
      ), ev as (
        insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
        select x.booking_id, b.id, 'whatsapp_auto_expired', null, 'automatico', jsonb_build_object('kind', 'eve')
          from x where x.reason = 'EXPIRADA'
        returning 1
      )
      select count(*) filter (where x.status = 'queued'),
             count(*) filter (where x.reason = 'EXPIRADA'),
             count(*) filter (where x.reason = 'JA_LEMBRADO')
        into v_n, v_exp_n, v_skip_n
        from x;
      v_queued := v_queued + v_n;
      v_exp    := v_exp + v_exp_n;
      v_skip   := v_skip + v_skip_n;
    end if;

    -- (h) ANIVERSÁRIO: horário sorteado entre 08:00 e 19:00 de hoje; vale até 20:00;
    -- 1 por cliente por ano
    if b.birthday_enabled then
      with cand as (
        select c.id,
               time '08:00' + make_interval(secs => floor(random() * 11 * 3600)::int) as at_time
          from customers c
         where c.business_id = b.id
           and c.birth_date is not null
           and whatsapp_is_birthday(c.birth_date, v_today)
           and not c.no_auto_reminders
           and phone_is_valid(c.phone_country, c.phone)
           and not exists (select 1 from whatsapp_reminder_sends o
                            where o.customer_id = c.id and o.kind = 'birthday'
                              and extract(year from o.booking_date) = extract(year from v_today))
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, customer_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'birthday', v_today, c.at_time, 1, 0,
               'queued', 4, (v_today + c.at_time) at time zone b.timezone,
               (v_today + time '20:00') at time zone b.timezone, null
          from cand c
         where now() < (v_today + time '20:00') at time zone b.timezone
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;
  end loop;

  return json_build_object('enfileiradas', v_queued, 'expiradas', v_exp, 'descartadas', v_skip);
end;
$$;

-- 6.5 Painel da Genix: coluna "tier" passa a dizer o plano (gratis | basico | profissional | equipe)
create or replace function genix_whatsapp_overview()
returns table (
  business_id uuid, name text, slug text, tier text,
  has_credentials boolean, instance_hint text, genix_enabled boolean,
  status text, status_checked_at timestamptz, auto_enabled boolean,
  sent_7d bigint, failed_7d bigint, last_reason text,
  provider text, instance_name text, phone_number text,
  next_send_at timestamptz, stats_7d jsonb
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select b.id, b.name, b.slug::text, plan_kind(b.id),   -- 52: qual plano
         coalesce(whatsapp_has_credentials(i), false),
         case when i.instance_id is null then null else right(i.instance_id, 4) end,
         coalesce(i.genix_enabled, false),
         coalesce(i.status, 'unknown'),
         i.status_checked_at,
         coalesce(st.auto_enabled, false),
         (select count(*) from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'sent' and s.created_at > now() - interval '7 days'),
         (select count(*) from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'failed' and s.created_at > now() - interval '7 days'),
         (select s.reason from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'failed' order by s.created_at desc limit 1),
         i.provider,
         i.instance_name,
         i.phone_number,
         (select max(i2.next_send_at) from whatsapp_instances i2
           where i2.business_id = b.id
              or (i.phone_number is not null and i2.phone_number = i.phone_number)),
         case when i.business_id is null then null else whatsapp_stats_7d(b.id) end
    from businesses b
    left join whatsapp_instances i on i.business_id = b.id
    left join whatsapp_settings st on st.business_id = b.id
   where not coalesce(b.is_demo, false)
   order by (i.business_id is null), b.name;
end;
$$;

commit;


-- =====================================================================
-- CONFERÊNCIA (uma consulta por vez)
-- =====================================================================
-- select id, kind, active, base_price, extra_professional_price, max_professionals from plans order by kind, billing_cycle;
-- select b.name, access_tier(b.id), plan_kind(b.id), plan_allows(b.id, 'basico') basico,
--        plan_allows(b.id, 'profissional') profissional, free_period_over(b.id) vencido
--   from businesses b order by b.name;
-- select column_default from information_schema.columns where table_name = 'subscriptions' and column_name = 'free_ends_at';


-- =====================================================================
-- REVERSÃO DA PARTE A (rode a reversão da PARTE B antes, se ela já rodou;
-- e volte o código antes)
-- =====================================================================
-- begin;
-- 1) Funções com o corpo anterior: cole e rode as versões de
--    29 (enforce_free_professional_limit, public_plan_info), 32 (get_available_slots, save_combo),
--    37 (save_package_template, create_booking_first_item, booking_add_item, booking_edit_info),
--    39 (check_package_sale), 34 (set_whatsapp_auto), 42 (next_auto_message, genix_whatsapp_overview —
--    esta com "drop function" + "create function"), 45 (next_auto_reminder, whatsapp_queue_refresh).
-- 2) Modelos de pacote (volta a regra da 19):
-- drop policy if exists "matriz cria modelos de pacote" on package_templates;
-- create policy "matriz cria modelos de pacote" on package_templates for insert to authenticated
--   with check (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');
-- drop policy if exists "matriz altera modelos de pacote" on package_templates;
-- create policy "matriz altera modelos de pacote" on package_templates for update to authenticated
--   using (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');
-- drop policy if exists "matriz exclui modelos de pacote" on package_templates;
-- create policy "matriz exclui modelos de pacote" on package_templates for delete to authenticated
--   using (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');
-- 3) Depois:
-- drop trigger  if exists trg_guard_online_booking_plan on bookings;
-- drop function if exists guard_online_booking_plan();
-- drop function if exists free_period_over(uuid);
-- alter table subscriptions drop column if exists free_ends_at;
-- drop function if exists plan_allows(uuid, text);
-- drop function if exists plan_rank(text);
-- delete from plans where id in ('basico_mensal', 'basico_anual')
--   and not exists (select 1 from subscriptions s where s.plan_id = plans.id or s.scheduled_plan_id = plans.id);
-- alter table plans drop constraint if exists plans_kind_valid;
-- alter table plans add constraint plans_kind_valid check (kind in ('gratis', 'profissional', 'equipe'));
-- commit;
-- =====================================================================
