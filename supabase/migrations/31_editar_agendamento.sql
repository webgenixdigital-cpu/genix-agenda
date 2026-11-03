-- =====================================================================
-- GENIX AGENDA — Editar agendamento: serviços adicionais e desconto
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta).
-- Reversão comentada no final.
--
-- Um agendamento passa a ter 1 ou mais serviços (booking_items). O item
-- position 0 é o serviço original e nunca sai. As colunas de bookings que
-- todo o sistema já lê viram o TOTAL, mantido só por recalc_booking:
--   service_name = nomes unidos por " + "   ("Corte + Barba")
--   price        = soma dos itens − desconto (nunca negativo)
--   duration_min = original + itens que aumentaram o tempo; end_time = início + duração
-- Valor cobrado no atendimento = price − itens pagos pelo pacote.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Colunas novas
-- =====================================================================
alter table bookings add column if not exists discount_kind   text;
alter table bookings add column if not exists discount_input  numeric(10,2);
alter table bookings add column if not exists discount_amount numeric(10,2) not null default 0;
alter table bookings add column if not exists discount_reason text;
alter table bookings add column if not exists items_count     smallint not null default 1;

alter table bookings drop constraint if exists discount_valid;
alter table bookings add constraint discount_valid check (
  (discount_kind is null and discount_input is null and discount_amount = 0)
  or (discount_kind in ('valor', 'percentual') and discount_input > 0 and discount_amount >= 0)
);
alter table bookings drop constraint if exists discount_reason_len;
alter table bookings add constraint discount_reason_len check (discount_reason is null or char_length(discount_reason) <= 120);

-- limite de desconto do profissional (% do valor), definido pela matriz; 0 = não dá desconto
alter table businesses add column if not exists staff_discount_max_pct numeric(5,2) not null default 0;
alter table businesses drop constraint if exists staff_discount_max_pct_valid;
alter table businesses add constraint staff_discount_max_pct_valid check (staff_discount_max_pct between 0 and 100);


-- =====================================================================
-- PARTE 2 — Serviços do agendamento (snapshot de nome, preço e duração)
-- =====================================================================
create table if not exists booking_items (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references bookings(id) on delete cascade,
  business_id     uuid not null references businesses(id) on delete cascade,
  service_id      uuid references services(id) on delete set null,
  service_name    text not null,
  price           numeric(10,2) not null default 0 check (price >= 0),
  duration_min    smallint not null check (duration_min between 1 and 1440),
  position        smallint not null default 0,
  extends_time    boolean not null default true,   -- somou a duração ao atendimento
  paid_by_package boolean not null default false,  -- item 0 de sessão de pacote
  added_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (booking_id, position)
);

create index if not exists idx_booking_items_service on booking_items (service_id) where service_id is not null;

-- Só leitura, para quem vê o agendamento. Gravação só pelas funções abaixo.
alter table booking_items enable row level security;
drop policy if exists "ve itens do agendamento" on booking_items;
create policy "ve itens do agendamento" on booking_items
  for select to authenticated
  using (exists (
    select 1 from bookings b
    where b.id = booking_id
      and (sees_whole_agenda(b.business_id) or can_manage_booking(b.business_id, b.professional_id))
  ));


-- =====================================================================
-- PARTE 3 — Item 0 de todo agendamento novo (vitrine, manual, recorrência)
-- =====================================================================
create or replace function create_booking_first_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                               position, extends_time, paid_by_package, added_by, created_at)
    values (new.id, new.business_id, new.service_id, new.service_name, new.price, new.duration_min,
            0, true, new.customer_package_id is not null, auth.uid(), new.created_at)
    on conflict (booking_id, position) do nothing;
  elsif new.customer_package_id is distinct from old.customer_package_id then
    update booking_items set paid_by_package = new.customer_package_id is not null
     where booking_id = new.id and position = 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_booking_first_item on bookings;
create trigger trg_booking_first_item
after insert or update of customer_package_id on bookings
for each row execute function create_booking_first_item();


-- =====================================================================
-- PARTE 4 — Agendamentos existentes: 1 item cada, sem perda
-- =====================================================================
insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                           position, extends_time, paid_by_package, created_at)
select b.id, b.business_id, b.service_id, b.service_name, b.price, b.duration_min,
       0, true, b.customer_package_id is not null, b.created_at
  from bookings b
 where not exists (select 1 from booking_items i where i.booking_id = b.id and i.position = 0);


-- =====================================================================
-- PARTE 5 — Trava: totais e desconto só mudam pelas funções desta migration
-- (hoje a RLS deixa o profissional alterar o próprio agendamento; sem a
--  trava, um update direto de price furaria o limite de desconto).
-- As funções ligam genix.booking_edit = '1' (vale só na transação).
-- =====================================================================
create or replace function guard_booking_totals()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(current_setting('genix.booking_edit', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.discount_kind is not null or new.discount_amount <> 0 or new.items_count <> 1 then
      raise exception 'SEM_PERMISSAO';
    end if;
    return new;
  end if;

  if new.service_name    is distinct from old.service_name
  or new.price           is distinct from old.price
  or new.duration_min    is distinct from old.duration_min
  or new.discount_kind   is distinct from old.discount_kind
  or new.discount_input  is distinct from old.discount_input
  or new.discount_amount is distinct from old.discount_amount
  or new.discount_reason is distinct from old.discount_reason
  or new.items_count     is distinct from old.items_count then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_booking_totals on bookings;
create trigger trg_guard_booking_totals
before insert or update on bookings
for each row execute function guard_booking_totals();


-- =====================================================================
-- PARTE 6 — Apoio: profissional faz o serviço? (sem vínculos = faz todos)
-- =====================================================================
create or replace function professional_does_service(p_professional uuid, p_service uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (select 1 from professional_services ps where ps.professional_id = p_professional)
      or exists (select 1 from professional_services ps
                  where ps.professional_id = p_professional and ps.service_id = p_service);
$$;


-- =====================================================================
-- PARTE 7 — Recalcular os totais do agendamento a partir dos itens
-- Desconto: base = itens não pagos pelo pacote; % recalcula sobre a base,
-- R$ nunca passa da base; base zerada remove o desconto.
-- Erros: MEIA_NOITE | exclusion_violation (no_overlap)
-- =====================================================================
create or replace function recalc_booking(p_booking uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  v_all   numeric;
  v_base  numeric;
  v_dur   int;
  v_names text;
  v_n     int;
  v_disc  numeric;
  v_endm  int;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;

  select coalesce(sum(price), 0),
         coalesce(sum(price) filter (where not paid_by_package), 0),
         coalesce(sum(duration_min) filter (where position = 0 or extends_time), 0),
         string_agg(service_name, ' + ' order by position),
         count(*)
    into v_all, v_base, v_dur, v_names, v_n
    from booking_items where booking_id = p_booking;
  if v_n = 0 then raise exception 'SEM_ITENS'; end if;

  v_disc := case bk.discount_kind
              when 'percentual' then round(v_base * bk.discount_input / 100, 2)
              when 'valor'      then least(bk.discount_input, v_base)
              else 0
            end;

  v_endm := extract(hour from bk.start_time)::int * 60 + extract(minute from bk.start_time)::int + v_dur;
  if v_endm >= 24 * 60 then raise exception 'MEIA_NOITE'; end if;

  perform set_config('genix.booking_edit', '1', true);
  update bookings
     set service_name    = v_names,
         price           = greatest(v_all - v_disc, 0),
         duration_min    = v_dur,
         end_time        = make_time(v_endm / 60, v_endm % 60, 0),
         discount_amount = v_disc,
         -- sem valor para descontar (ex.: pacote sem adicional): o desconto sai
         discount_kind   = case when v_base > 0 then discount_kind   end,
         discount_input  = case when v_base > 0 then discount_input  end,
         discount_reason = case when v_base > 0 then discount_reason end,
         items_count     = v_n
   where id = p_booking;
end;
$$;


-- =====================================================================
-- PARTE 8 — Adicionar serviço
-- p_extend = soma a duração ao atendimento. Confere só o trecho novo:
-- bloqueio, outro agendamento e meia-noite (pode passar do fechamento;
-- não confere "passado", para vender na hora de concluir).
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | STATUS_INVALIDO | SERVICO_INVALIDO
--        PROFISSIONAL_NAO_FAZ | LIMITE_ITENS | MEIA_NOITE | BLOQUEIO | OCUPADO
-- =====================================================================
create or replace function booking_add_item(p_booking uuid, p_service uuid, p_extend boolean default true)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk     bookings;
  s      services;
  v_n    int;
  v_pos  int;
  v_endm int;
  v_end  time;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  select * into s from services where id = p_service and business_id = bk.business_id and active;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;
  if not professional_does_service(bk.professional_id, s.id) then raise exception 'PROFISSIONAL_NAO_FAZ'; end if;

  select count(*), coalesce(max(position), 0) + 1 into v_n, v_pos from booking_items where booking_id = bk.id;
  if v_n >= 10 then raise exception 'LIMITE_ITENS'; end if;

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

  insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                             position, extends_time, paid_by_package, added_by)
  values (bk.id, bk.business_id, s.id, s.name, s.price, s.duration_min, v_pos, p_extend, false, auth.uid());

  begin
    perform recalc_booking(bk.id);
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'item_added', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('service', s.name, 'price', s.price, 'duration', s.duration_min, 'extended', p_extend));

  return json_build_object('ok', true);
end;
$$;


-- =====================================================================
-- PARTE 9 — Remover serviço adicional (o original nunca sai)
-- O tempo só diminui se o item tinha somado a duração.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | STATUS_INVALIDO | ITEM_INVALIDO | ITEM_ORIGINAL
-- =====================================================================
create or replace function booking_remove_item(p_booking uuid, p_item uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk bookings;
  it booking_items;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  select * into it from booking_items where id = p_item and booking_id = bk.id;
  if not found then raise exception 'ITEM_INVALIDO'; end if;
  if it.position = 0 then raise exception 'ITEM_ORIGINAL'; end if;

  delete from booking_items where id = it.id;
  perform recalc_booking(bk.id);

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'item_removed', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('service', it.service_name, 'price', it.price, 'duration', it.duration_min,
                             'extended', it.extends_time));

  return json_build_object('ok', true);
end;
$$;


-- =====================================================================
-- PARTE 10 — Desconto (R$ ou %) — p_kind null remove
-- Base = itens não pagos pelo pacote (em sessão de pacote, só os adicionais).
-- Matriz e recepção: sem limite. Profissional: até staff_discount_max_pct
-- do espaço, e não mexe num desconto já dado acima do limite dele.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | STATUS_INVALIDO | DESCONTO_INVALIDO
--        SEM_VALOR | DESCONTO_ACIMA_LIMITE:<limite>
-- =====================================================================
create or replace function booking_set_discount(p_booking uuid, p_kind text, p_value numeric, p_reason text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk       bookings;
  v_role   text;
  v_base   numeric;
  v_lim    numeric;
  v_cap    numeric;
  v_amount numeric;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  v_role := member_role_of(bk.business_id);
  select coalesce(sum(price) filter (where not paid_by_package), 0) into v_base
    from booking_items where booking_id = bk.id;

  if v_role = 'staff' then
    select staff_discount_max_pct into v_lim from businesses where id = bk.business_id;
    v_lim := coalesce(v_lim, 0);
    v_cap := round(v_base * v_lim / 100, 2);
    if bk.discount_amount > v_cap then
      raise exception 'DESCONTO_ACIMA_LIMITE:%', v_lim;
    end if;
  end if;

  perform set_config('genix.booking_edit', '1', true);

  if p_kind is null then
    if bk.discount_kind is null then return json_build_object('ok', true); end if;
    update bookings
       set discount_kind = null, discount_input = null, discount_amount = 0, discount_reason = null
     where id = bk.id;
    perform recalc_booking(bk.id);
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (bk.id, bk.business_id, 'discount_removed', auth.uid(), coalesce(v_role, 'sistema'),
            jsonb_build_object('kind', bk.discount_kind, 'input', bk.discount_input, 'amount', bk.discount_amount));
    return json_build_object('ok', true);
  end if;

  if p_kind not in ('valor', 'percentual') or p_value is null or p_value <= 0
     or (p_kind = 'percentual' and p_value > 100) or p_value > 99999999 then
    raise exception 'DESCONTO_INVALIDO';
  end if;
  if v_base <= 0 then raise exception 'SEM_VALOR'; end if;

  v_amount := case p_kind when 'percentual' then round(v_base * p_value / 100, 2) else least(round(p_value, 2), v_base) end;
  if v_role = 'staff' and v_amount > v_cap then
    raise exception 'DESCONTO_ACIMA_LIMITE:%', v_lim;
  end if;

  update bookings
     set discount_kind   = p_kind,
         discount_input  = round(p_value, 2),
         discount_reason = left(v_reason, 120)
   where id = bk.id;
  perform recalc_booking(bk.id);

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'discount_set', auth.uid(), coalesce(v_role, 'sistema'),
          jsonb_build_object('kind', p_kind, 'input', round(p_value, 2), 'amount', v_amount, 'reason', left(v_reason, 120)));

  return json_build_object('ok', true);
end;
$$;


-- =====================================================================
-- PARTE 11 — Dados do diálogo "Editar"
-- discount_limit: null = sem limite (matriz/recepção); número = % do profissional
-- =====================================================================
create or replace function booking_edit_info(p_booking uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  bk     bookings;
  v_role text;
  v_lim  numeric;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;

  v_role := member_role_of(bk.business_id);
  if v_role = 'staff' then
    select staff_discount_max_pct into v_lim from businesses where id = bk.business_id;
  end if;

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
               'paid_by_package', i.paid_by_package) order by i.position)
        from booking_items i where i.booking_id = bk.id), '[]'::json),
    'services', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name, 'price', s.price, 'duration', s.duration_min)
                      order by s.sort_order, s.name)
        from services s
       where s.business_id = bk.business_id and s.active
         and professional_does_service(bk.professional_id, s.id)), '[]'::json)
  );
end;
$$;


-- =====================================================================
-- PARTE 12 — complete_booking: lança no caixa o valor COBRADO
-- (cópia da 19_pacotes PARTE 10 + "31_editar_agendamento")
-- Cobrado = price (total final) − itens pagos pelo pacote. Sessão de pacote
-- sem adicional continua sem lançar; com adicional lança só o adicional.
-- =====================================================================
create or replace function complete_booking(p_booking uuid, p_method text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk       bookings;
  v_cash   boolean := false;
  v_pkg    numeric;
  v_charge numeric;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if p_method is not null and p_method not in ('pix', 'dinheiro', 'credito', 'debito') then
    raise exception 'FORMA_INVALIDA';
  end if;

  update bookings set status = 'completed' where id = p_booking;

  -- 31_editar_agendamento: parte paga pelo pacote (sem itens = regra antiga)
  select sum(price) filter (where paid_by_package) into v_pkg from booking_items where booking_id = bk.id;
  v_pkg := coalesce(v_pkg, case when bk.customer_package_id is not null then bk.price else 0 end);
  v_charge := greatest(bk.price - v_pkg, 0);

  -- lança no caixa só no plano pago, com forma de pagamento e valor > 0 (1 vez por atendimento)
  if p_method is not null and v_charge > 0 and access_tier(bk.business_id) = 'completo' then
    insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
    values (bk.business_id, bk.id, 'income', 'atendimento', p_method::payment_method,
            bk.service_name || ' — ' || bk.customer_name, v_charge, bk.booking_date, auth.uid())
    on conflict (booking_id) where booking_id is not null do nothing;
    v_cash := found;
  end if;

  return json_build_object('ok', true, 'cash', v_cash);
end;
$$;


-- =====================================================================
-- PARTE 13 — customer_summary: sessão de pacote = proporcional + cobrado
-- (cópia da 19_pacotes PARTE 11 + "31_editar_agendamento")
-- =====================================================================
create or replace function customer_summary(bid uuid)
returns table (customer_id uuid, visits int, last_visit date, next_visit date, total numeric)
language sql stable
as $$
  select
    b.customer_id,
    count(*) filter (where b.status = 'completed')::int,
    max(b.booking_date) filter (where b.status = 'completed'),
    min(b.booking_date) filter (where b.status in ('pending', 'confirmed') and b.booking_date >= current_date),
    round(coalesce(sum(
      case when cp.id is not null
           then cp.price / cp.sessions_total + greatest(b.price - coalesce(pk.amount, b.price), 0)
           else b.price end
    ) filter (where b.status = 'completed'), 0), 2)
  from bookings b
  left join customer_packages cp on cp.id = b.customer_package_id
  left join lateral (
    select sum(i.price) as amount from booking_items i where i.booking_id = b.id and i.paid_by_package
  ) pk on true
  where b.business_id = bid and b.customer_id is not null
  group by b.customer_id;
$$;


-- =====================================================================
-- PARTE 14 — return_queue: todos os serviços concluídos do agendamento
-- (cópia da 18_retornos + itens; um adicional com prazo também gera retorno)
-- =====================================================================
create or replace function return_queue(p_business uuid, p_days_ahead int default 7)
returns table (
  booking_id          uuid,
  customer_id         uuid,
  customer_name       text,
  customer_phone      text,
  service_id          uuid,
  service_name        text,
  professional_name   text,
  last_date           date,
  due_date            date,
  days_overdue        int,
  return_contacted_at timestamptz
)
language sql stable security invoker set search_path = public
as $$
  with today as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  ),
  last_visit as (
    select distinct on (b.customer_id, i.service_id)
      b.id, b.customer_id, i.service_id, b.booking_date, i.service_name,
      b.professional_name, b.return_contacted_at, s.return_after_days
    from bookings b
    join booking_items i on i.booking_id = b.id
    join services s on s.id = i.service_id
    where b.business_id = p_business
      and b.status = 'completed'
      and b.customer_id is not null
      and s.return_after_days is not null
    order by b.customer_id, i.service_id, b.booking_date desc, b.start_time desc
  )
  select
    lv.id, lv.customer_id, c.name, c.phone, lv.service_id, lv.service_name, lv.professional_name,
    lv.booking_date,
    lv.booking_date + lv.return_after_days,
    (t.d - (lv.booking_date + lv.return_after_days))::int,
    lv.return_contacted_at
  from last_visit lv
  join customers c on c.id = lv.customer_id
  cross join today t
  where lv.booking_date + lv.return_after_days <= t.d + greatest(p_days_ahead, 0)
    and not exists (
      select 1 from bookings f
      where f.business_id = p_business
        and f.customer_id = lv.customer_id
        and f.status in ('pending', 'confirmed')
        and f.booking_date >= t.d
    )
  order by lv.booking_date + lv.return_after_days;
$$;


-- =====================================================================
-- PARTE 15 — reschedule_booking: outro profissional precisa fazer TODOS
-- os serviços (cópia da 21_remarcar PARTE 3 + "31_editar_agendamento").
-- A duração usada já é a total (bk.duration_min).
-- =====================================================================
create or replace function reschedule_booking(
  p_booking uuid, p_professional uuid, p_date date, p_time text, p_fit boolean default false
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk     bookings;
  p      professionals;
  v_time time;
  v_endm int;
  v_end  time;
  v_issue text;
begin
  if p_time is null or p_time !~ '^\d{2}:\d{2}$' or p_date is null then raise exception 'DADOS_INVALIDOS'; end if;
  v_time := p_time::time;

  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  -- precisa poder mexer no agendamento atual E na agenda de destino
  -- (profissional: só dentro da própria agenda)
  if not can_manage_booking(bk.business_id, bk.professional_id)
     or not can_manage_booking(bk.business_id, p_professional) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_fit and coalesce(member_role_of(bk.business_id) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;

  select * into p from professionals where id = p_professional and business_id = bk.business_id;
  if not found then raise exception 'PROFISSIONAL_INDISPONIVEL'; end if;

  -- 31_editar_agendamento: o novo profissional faz também os adicionais
  if p.id <> bk.professional_id and exists (
    select 1 from booking_items i
     where i.booking_id = bk.id and i.position > 0 and i.service_id is not null
       and not professional_does_service(p.id, i.service_id)
  ) then
    raise exception 'PROFISSIONAL_INDISPONIVEL';
  end if;

  v_issue := booking_slot_issue_except(bk.business_id, p_professional, bk.service_id, p_date, v_time,
                                       bk.id, bk.duration_min, p_fit);
  if v_issue is not null then raise exception '%', v_issue; end if;

  v_endm := extract(hour from v_time)::int * 60 + extract(minute from v_time)::int + bk.duration_min;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  begin
    update bookings
       set booking_date      = p_date,
           start_time        = v_time,
           end_time          = v_end,
           professional_id   = p.id,
           professional_name = p.name,
           -- data/hora mudou: o lembrete volta para a fila
           reminder_sent_at  = case when p_date is distinct from bk.booking_date or v_time is distinct from bk.start_time
                                    then null else reminder_sent_at end
     where id = bk.id;
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  return json_build_object('ok', true, 'date', p_date, 'time', to_char(v_time, 'HH24:MI'), 'professional', p.name);
end;
$$;


-- =====================================================================
-- PARTE 16 — Permissões das funções
-- =====================================================================
revoke all on function create_booking_first_item()                 from public, anon, authenticated;
revoke all on function guard_booking_totals()                      from public, anon, authenticated;
revoke all on function recalc_booking(uuid)                        from public, anon, authenticated;
revoke all on function professional_does_service(uuid, uuid)       from public, anon, authenticated;

revoke all on function booking_add_item(uuid, uuid, boolean)              from public, anon;
revoke all on function booking_remove_item(uuid, uuid)                    from public, anon;
revoke all on function booking_set_discount(uuid, text, numeric, text)    from public, anon;
revoke all on function booking_edit_info(uuid)                            from public, anon;
grant execute on function booking_add_item(uuid, uuid, boolean)           to authenticated;
grant execute on function booking_remove_item(uuid, uuid)                 to authenticated;
grant execute on function booking_set_discount(uuid, text, numeric, text) to authenticated;
grant execute on function booking_edit_info(uuid)                         to authenticated;

-- as redefinidas mantêm as permissões que já tinham (create or replace não muda grants)


-- =====================================================================
-- PARTE 17 — Conferência
-- 1) agendamentos e itens 0 devem bater (sem_item = 0)
-- 2) funções novas presentes
-- =====================================================================
select (select count(*) from bookings) as agendamentos,
       (select count(*) from booking_items where position = 0) as itens_originais,
       (select count(*) from bookings b
         where not exists (select 1 from booking_items i where i.booking_id = b.id and i.position = 0)) as sem_item;

select proname from pg_proc
 where proname in ('booking_add_item', 'booking_remove_item', 'booking_set_discount', 'booking_edit_info',
                   'recalc_booking', 'guard_booking_totals', 'create_booking_first_item', 'professional_does_service')
 order by 1;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- Agendamentos já editados ficam com o total em service_name/price/duration_min
-- (o snapshot do serviço original some junto com booking_items).
-- 1) Restaure as funções antigas, colando e rodando:
--    - complete_booking e customer_summary: PARTES 10 e 11 de 19_pacotes.sql
--    - return_queue: item 3 de 18_retornos.sql
--    - reschedule_booking: PARTE 3 de 21_remarcar.sql
-- 2) Depois:
-- drop trigger  if exists trg_guard_booking_totals on bookings;
-- drop trigger  if exists trg_booking_first_item on bookings;
-- drop function if exists booking_edit_info(uuid);
-- drop function if exists booking_set_discount(uuid, text, numeric, text);
-- drop function if exists booking_remove_item(uuid, uuid);
-- drop function if exists booking_add_item(uuid, uuid, boolean);
-- drop function if exists recalc_booking(uuid);
-- drop function if exists professional_does_service(uuid, uuid);
-- drop function if exists guard_booking_totals();
-- drop function if exists create_booking_first_item();
-- drop table    if exists booking_items;
-- alter table bookings   drop constraint if exists discount_reason_len;
-- alter table bookings   drop constraint if exists discount_valid;
-- alter table bookings   drop column if exists items_count;
-- alter table bookings   drop column if exists discount_reason;
-- alter table bookings   drop column if exists discount_amount;
-- alter table bookings   drop column if exists discount_input;
-- alter table bookings   drop column if exists discount_kind;
-- alter table businesses drop constraint if exists staff_discount_max_pct_valid;
-- alter table businesses drop column if exists staff_discount_max_pct;
-- (os eventos item_added/item_removed/discount_* em booking_events podem ficar: são só histórico)
-- =====================================================================
