-- =====================================================================
-- GENIX AGENDA — Combos de serviços
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta).
-- Reversão comentada no final.
--
-- Combo = uma linha em services com kind = 'combo' (preço especial em
-- price, soma das durações em duration_min) + os serviços em combo_items.
-- Por isso vitrine (create_public_booking da 25), agendamento manual e
-- recorrência não mudam: recebem um service_id como sempre. Ao gravar o
-- agendamento, o gatilho do item 0 (31) abre o combo em um item por
-- serviço, com o preço especial dividido proporcionalmente.
-- Só nos planos pagos (access_tier = 'completo').
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Tipo do serviço e serviços do combo
-- =====================================================================
alter table services add column if not exists kind text not null default 'servico';
alter table services drop constraint if exists services_kind_valid;
alter table services add constraint services_kind_valid check (kind in ('servico', 'combo'));

create table if not exists combo_items (
  combo_id    uuid not null references services(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  position    smallint not null default 0,
  primary key (combo_id, service_id)
);

create index if not exists idx_combo_items_service on combo_items (service_id);

-- leitura igual à de services (vitrine publicada ou membro); gravação só por save_combo
alter table combo_items enable row level security;
drop policy if exists "le servicos do combo" on combo_items;
create policy "le servicos do combo" on combo_items
  for select using (is_business_published(business_id) or is_business_member(business_id));


-- =====================================================================
-- PARTE 2 — Itens do agendamento: de qual combo vieram
-- combo_group: um por combo dentro do agendamento (o mesmo combo pode entrar 2 vezes)
-- =====================================================================
alter table booking_items add column if not exists combo_id    uuid references services(id) on delete set null;
alter table booking_items add column if not exists combo_name  text;
alter table booking_items add column if not exists combo_group uuid;

create index if not exists idx_booking_items_group on booking_items (booking_id, combo_group) where combo_group is not null;


-- =====================================================================
-- PARTE 3 — Profissional faz o serviço? Combo: precisa fazer TODOS
-- (sem vínculos = faz todos). Usada pela vitrine, remarcar, recorrência e Editar.
-- =====================================================================
create or replace function professional_does_service(p_professional uuid, p_service uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from services s where s.id = p_service and s.kind = 'combo') then
      exists (select 1 from combo_items ci where ci.combo_id = p_service)
      and (
        not exists (select 1 from professional_services ps where ps.professional_id = p_professional)
        or not exists (
          select 1 from combo_items ci
           where ci.combo_id = p_service
             and not exists (select 1 from professional_services ps
                              where ps.professional_id = p_professional and ps.service_id = ci.service_id))
      )
    else
      not exists (select 1 from professional_services ps where ps.professional_id = p_professional)
      or exists (select 1 from professional_services ps
                  where ps.professional_id = p_professional and ps.service_id = p_service)
  end;
$$;


-- =====================================================================
-- PARTE 4 — Apoio: grava os itens de um serviço ou de um combo
-- Combo: um item por serviço, preço = p_total × normal do serviço ÷ soma
-- dos normais (arredondado; os centavos que sobram ficam no último item).
-- Devolve quantos itens gravou.
-- =====================================================================
create or replace function add_service_items(
  p_booking uuid, p_service uuid, p_position int, p_extend boolean,
  p_paid_by_package boolean, p_total numeric, p_created_at timestamptz default now()
)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  s        services;
  v_biz    uuid;
  v_group  uuid;
  v_normal numeric;
  v_n      int;
  v_i      int := 0;
  v_acc    numeric := 0;
  v_price  numeric;
  r        record;
begin
  select business_id into v_biz from bookings where id = p_booking;
  select * into s from services where id = p_service;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;

  if s.kind <> 'combo' then
    insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                               position, extends_time, paid_by_package, added_by, created_at)
    values (p_booking, v_biz, s.id, s.name, p_total, s.duration_min,
            p_position, p_extend, p_paid_by_package, auth.uid(), p_created_at);
    return 1;
  end if;

  select coalesce(sum(c.price), 0), count(*) into v_normal, v_n
    from combo_items ci join services c on c.id = ci.service_id
   where ci.combo_id = s.id;
  if v_n = 0 then raise exception 'COMBO_INCOMPLETO'; end if;

  v_group := gen_random_uuid();
  for r in
    select c.id, c.name, c.price, c.duration_min
      from combo_items ci join services c on c.id = ci.service_id
     where ci.combo_id = s.id
     order by ci.position, c.name
  loop
    v_i := v_i + 1;
    v_price := case
                 when v_i = v_n     then p_total - v_acc
                 when v_normal > 0  then round(p_total * r.price / v_normal, 2)
                 else round(p_total / v_n, 2)
               end;
    v_price := greatest(v_price, 0);
    v_acc := v_acc + v_price;
    insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                               position, extends_time, paid_by_package, added_by, created_at,
                               combo_id, combo_name, combo_group)
    values (p_booking, v_biz, r.id, r.name, v_price, r.duration_min,
            p_position + v_i - 1, p_extend, false, auth.uid(), p_created_at,
            s.id, s.name, v_group);
  end loop;
  return v_n;
end;
$$;


-- =====================================================================
-- PARTE 5 — Item 0 do agendamento novo (31) com combo
-- Combo: só no plano pago e com profissional que faz todos os serviços;
-- abre em itens e recalcula (service_name = nome do combo, items_count).
-- Vale para vitrine, manual e recorrência.
-- Erros: PLANO_GRATIS | PROFISSIONAL_NAO_FAZ | COMBO_INCOMPLETO
-- =====================================================================
create or replace function create_booking_first_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from booking_items where booking_id = new.id) then return new; end if;
    select kind into v_kind from services where id = new.service_id;

    if v_kind = 'combo' then
      if access_tier(new.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
      if not professional_does_service(new.professional_id, new.service_id) then
        raise exception 'PROFISSIONAL_NAO_FAZ';
      end if;
      perform add_service_items(new.id, new.service_id, 0, true, false, new.price, new.created_at);
      perform recalc_booking(new.id);
    else
      insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                                 position, extends_time, paid_by_package, added_by, created_at)
      values (new.id, new.business_id, new.service_id, new.service_name, new.price, new.duration_min,
              0, true, new.customer_package_id is not null, auth.uid(), new.created_at)
      on conflict (booking_id, position) do nothing;
    end if;
  elsif new.customer_package_id is distinct from old.customer_package_id then
    update booking_items set paid_by_package = new.customer_package_id is not null
     where booking_id = new.id and position = 0;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- PARTE 6 — recalc_booking (31) com combos
-- Muda só: service_name agrupa cada combo pelo nome dele
-- ("Corte + Barba" + "Hidratação") e a trava genix.booking_edit volta ao
-- valor anterior no fim (o gatilho de insert não a deixa aberta).
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
  v_prev  text := coalesce(current_setting('genix.booking_edit', true), '');
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;

  select coalesce(sum(price), 0),
         coalesce(sum(price) filter (where not paid_by_package), 0),
         coalesce(sum(duration_min) filter (where position = 0 or extends_time), 0),
         count(*)
    into v_all, v_base, v_dur, v_n
    from booking_items where booking_id = p_booking;
  if v_n = 0 then raise exception 'SEM_ITENS'; end if;

  -- 32_combos: um nome por combo, na ordem do primeiro item
  select string_agg(g.name, ' + ' order by g.pos) into v_names
    from (select coalesce(max(i.combo_name), max(i.service_name)) as name, min(i.position) as pos
            from booking_items i where i.booking_id = p_booking
           group by coalesce(i.combo_group, i.id)) g;

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
  perform set_config('genix.booking_edit', v_prev, true);
end;
$$;


-- =====================================================================
-- PARTE 7 — booking_add_item (31) com combo
-- Muda só: combo no Grátis → PLANO_GRATIS; o limite de 10 conta os itens
-- do combo; o insert passa por add_service_items; 'combo' no histórico.
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
  -- 32_combos
  if s.kind = 'combo' and access_tier(bk.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if not professional_does_service(bk.professional_id, s.id) then raise exception 'PROFISSIONAL_NAO_FAZ'; end if;

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

  perform add_service_items(bk.id, s.id, v_pos, p_extend, false, s.price);

  begin
    perform recalc_booking(bk.id);
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'item_added', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('service', s.name, 'price', s.price, 'duration', s.duration_min, 'extended', p_extend,
                             'combo', s.kind = 'combo'));

  return json_build_object('ok', true);
end;
$$;


-- =====================================================================
-- PARTE 8 — booking_remove_item (31) com combo
-- Item de combo remove o combo inteiro; combo que tem o item 0 não sai.
-- =====================================================================
create or replace function booking_remove_item(p_booking uuid, p_item uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  it      booking_items;
  v_price numeric;
  v_dur   int;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  select * into it from booking_items where id = p_item and booking_id = bk.id;
  if not found then raise exception 'ITEM_INVALIDO'; end if;

  if it.combo_group is not null then
    -- 32_combos
    if exists (select 1 from booking_items where booking_id = bk.id and combo_group = it.combo_group and position = 0) then
      raise exception 'ITEM_ORIGINAL';
    end if;
    select sum(price), sum(duration_min) into v_price, v_dur
      from booking_items where booking_id = bk.id and combo_group = it.combo_group;
    delete from booking_items where booking_id = bk.id and combo_group = it.combo_group;
  else
    if it.position = 0 then raise exception 'ITEM_ORIGINAL'; end if;
    v_price := it.price;
    v_dur := it.duration_min;
    delete from booking_items where id = it.id;
  end if;

  perform recalc_booking(bk.id);

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'item_removed', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('service', coalesce(it.combo_name, it.service_name), 'price', v_price, 'duration', v_dur,
                             'extended', it.extends_time, 'combo', it.combo_group is not null));

  return json_build_object('ok', true);
end;
$$;


-- =====================================================================
-- PARTE 9 — booking_edit_info (31) com combo
-- Muda só: itens com combo_group/combo_name; serviços com kind e o valor
-- normal do combo; combos só no plano pago.
-- =====================================================================
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
  v_paid := access_tier(bk.business_id) = 'completo';

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
               'paid_by_package', i.paid_by_package, 'combo_group', i.combo_group, 'combo_name', i.combo_name)
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
         and professional_does_service(bk.professional_id, s.id)), '[]'::json)
  );
end;
$$;


-- =====================================================================
-- PARTE 10 — Horários da vitrine (versão da 29 + combos)
-- Muda só: combo só no plano pago (select do serviço) e o filtro de
-- profissional passa por professional_does_service (combo = faz todos).
-- create_public_booking (25) usa esta função: a regra vale no envio também.
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
   where id = p_service_id and business_id = b.id and active and bookable_online
     and (kind = 'servico' or access_tier(b.id) = 'completo');   -- 32_combos
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


-- =====================================================================
-- PARTE 11 — Regra de conflito (versão da 21 + combos)
-- Muda só: "profissional faz o serviço" passa por professional_does_service.
-- Usada pela recorrência (booking_slot_issue) e pelo remarcar.
-- =====================================================================
create or replace function booking_slot_issue_except(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_start time,
  p_ignore uuid default null, p_duration int default null, p_skip_hours boolean default false
)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  b       businesses;
  s       services;
  h       business_hours;
  v_dur   int;
  v_endm  int;
  v_end   time;
begin
  select * into b from businesses where id = p_business;
  if p_service is not null then
    select * into s from services where id = p_service and business_id = p_business;
    if not found then return 'PROFISSIONAL_INDISPONIVEL'; end if;
  end if;
  v_dur := coalesce(p_duration, s.duration_min);
  if v_dur is null then return 'PROFISSIONAL_INDISPONIVEL'; end if;

  if (p_date + p_start) <= (now() at time zone b.timezone) then return 'PASSADO'; end if;

  v_endm := extract(hour from p_start)::int * 60 + extract(minute from p_start)::int + v_dur;
  if v_endm >= 24 * 60 then return 'FORA_EXPEDIENTE'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  if not p_skip_hours then
    select * into h from business_hours where business_id = p_business and weekday = extract(dow from p_date)::int;
    if not found or h.closed then return 'FECHADO'; end if;
    if p_start < h.open_time or v_endm > extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int then
      return 'FORA_EXPEDIENTE';
    end if;
  end if;

  -- profissional ativo e que faz o serviço (combo: todos os serviços) — 32_combos
  if not exists (
    select 1 from professionals p
    where p.id = p_professional and p.business_id = p_business and p.active
      and (p_service is null or professional_does_service(p.id, p_service))
  ) then
    return 'PROFISSIONAL_INDISPONIVEL';
  end if;

  if slot_conflicts_block(p_business, p_professional, p_date, p_start, v_end) then return 'BLOQUEIO'; end if;

  if exists (
    select 1 from bookings bk
    where bk.professional_id = p_professional
      and bk.status in ('pending', 'confirmed')
      and bk.id is distinct from p_ignore
      and bk.period && tsrange(p_date + p_start, p_date + p_start + make_interval(mins => v_dur), '[)')
  ) then
    return 'OCUPADO';
  end if;

  return null;
end;
$$;


-- =====================================================================
-- PARTE 12 — Criar / editar combo (só a matriz, plano pago)
-- 2 a 6 serviços comuns, ativos, distintos, do espaço; preço especial
-- ≤ valor normal; duração = soma (até 600 min). Devolve o id do combo.
-- Erros: SEM_PERMISSAO | PLANO_GRATIS | NOME_INVALIDO | QUANTIDADE_INVALIDA
--        SERVICOS_INVALIDOS | PRECO_INVALIDO | PRECO_ACIMA | DURACAO_MAXIMA | NAO_ENCONTRADO
-- =====================================================================
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
  if access_tier(p_business) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
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


-- =====================================================================
-- PARTE 13 — Trava do combo em services
-- Tipo, preço e duração do combo só mudam por save_combo ou pelo
-- gatilho abaixo (genix.combo_edit). Reativar exige 2+ serviços ativos.
-- As chaves ativo / online / catálogo continuam pela tela de Serviços.
-- Erros: SEM_PERMISSAO | COMBO_INCOMPLETO
-- =====================================================================
create or replace function guard_service_combo()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('genix.combo_edit', true), '') <> '1' and auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.kind = 'combo' then raise exception 'SEM_PERMISSAO'; end if;
    elsif new.kind is distinct from old.kind
       or (new.kind = 'combo' and (new.price is distinct from old.price
                                   or new.duration_min is distinct from old.duration_min)) then
      raise exception 'SEM_PERMISSAO';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.kind = 'combo' and new.active and not old.active
     and (select count(*) from combo_items ci join services c on c.id = ci.service_id
           where ci.combo_id = new.id and c.active and c.kind = 'servico') < 2 then
    raise exception 'COMBO_INCOMPLETO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_service_combo on services;
create trigger trg_guard_service_combo
before insert or update on services
for each row execute function guard_service_combo();


-- =====================================================================
-- PARTE 14 — Serviço do combo mudou
-- Desativado ou excluído → combos que o contêm ficam inativos.
-- Duração mudou → duração do combo recalculada (acima de 600 min: inativo).
-- O preço especial não muda sozinho (a tela avisa se ficar acima do normal).
-- =====================================================================
create or replace function sync_combos_for_service()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_prev text := coalesce(current_setting('genix.combo_edit', true), '');
  v_sid  uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if (case when tg_op = 'DELETE' then old.kind else new.kind end) <> 'servico' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform set_config('genix.combo_edit', '1', true);

  if tg_op = 'DELETE' or (old.active and not new.active) then
    update services c set active = false
     where c.kind = 'combo' and c.active
       and c.id in (select combo_id from combo_items where service_id = v_sid);
  end if;

  if tg_op = 'DELETE' or new.duration_min is distinct from old.duration_min then
    with sums as (
      select ci.combo_id,
             coalesce(sum(s.duration_min) filter (where s.id <> v_sid or tg_op <> 'DELETE'), 0) as total
        from combo_items ci join services s on s.id = ci.service_id
       where ci.combo_id in (select combo_id from combo_items where service_id = v_sid)
       group by ci.combo_id
    )
    update services c
       set duration_min = greatest(5, least(600, sums.total)),
           active = case when sums.total > 600 then false else c.active end
      from sums
     where c.id = sums.combo_id;
  end if;

  perform set_config('genix.combo_edit', v_prev, true);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_sync_combos_update on services;
create trigger trg_sync_combos_update
after update of active, duration_min on services
for each row execute function sync_combos_for_service();

drop trigger if exists trg_sync_combos_delete on services;
create trigger trg_sync_combos_delete
before delete on services
for each row execute function sync_combos_for_service();


-- =====================================================================
-- PARTE 15 — Pacote é de um serviço comum (combo em pacote: etapa futura)
-- =====================================================================
create or replace function guard_package_template_service()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from services where id = new.service_id and kind = 'combo') then
    raise exception 'SERVICO_INVALIDO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_package_template_service on package_templates;
create trigger trg_guard_package_template_service
before insert or update of service_id on package_templates
for each row execute function guard_package_template_service();


-- =====================================================================
-- PARTE 16 — Permissões
-- (as redefinidas mantêm as permissões que já tinham)
-- =====================================================================
revoke all on function add_service_items(uuid, uuid, int, boolean, boolean, numeric, timestamptz) from public, anon, authenticated;
revoke all on function guard_service_combo()             from public, anon, authenticated;
revoke all on function sync_combos_for_service()         from public, anon, authenticated;
revoke all on function guard_package_template_service()  from public, anon, authenticated;

revoke all on function save_combo(uuid, uuid, text, text, text, numeric, uuid[]) from public, anon;
grant execute on function save_combo(uuid, uuid, text, text, text, numeric, uuid[]) to authenticated;


-- =====================================================================
-- PARTE 17 — Conferência
-- 1) todos os serviços existentes como 'servico' (combos = 0)
-- 2) funções novas presentes
-- =====================================================================
select kind, count(*) from services group by kind;

select proname from pg_proc
 where proname in ('save_combo', 'add_service_items', 'guard_service_combo', 'sync_combos_for_service',
                   'guard_package_template_service', 'professional_does_service')
 order by 1;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- Agendamentos de combo já feitos continuam válidos: os itens são
-- serviços comuns; bookings.service_id aponta para a linha do combo,
-- que fica inativa (não é apagada).
-- 1) Desative os combos e remova as travas:
-- update services set active = false where kind = 'combo';
-- drop trigger if exists trg_guard_package_template_service on package_templates;
-- drop trigger if exists trg_sync_combos_delete on services;
-- drop trigger if exists trg_sync_combos_update on services;
-- drop trigger if exists trg_guard_service_combo on services;
-- 2) Restaure as funções antigas, colando e rodando:
--    - get_available_slots: PARTE 8 de 29_cobranca_extra_profissional.sql
--    - booking_slot_issue_except: PARTE 1 de 21_remarcar.sql
--    - professional_does_service, create_booking_first_item, recalc_booking,
--      booking_add_item, booking_remove_item, booking_edit_info: PARTES 3, 6, 7, 8, 9 e 11
--      de 31_editar_agendamento.sql
-- 3) Depois:
-- drop function if exists guard_package_template_service();
-- drop function if exists sync_combos_for_service();
-- drop function if exists guard_service_combo();
-- drop function if exists save_combo(uuid, uuid, text, text, text, numeric, uuid[]);
-- drop function if exists add_service_items(uuid, uuid, int, boolean, boolean, numeric, timestamptz);
-- drop index if exists idx_booking_items_group;
-- alter table booking_items drop column if exists combo_group;
-- alter table booking_items drop column if exists combo_name;
-- alter table booking_items drop column if exists combo_id;
-- drop table if exists combo_items;
-- (services.kind pode ficar: as linhas 'combo' ficam inativas e fora da vitrine.
--  Para tirar a coluna também: alter table services drop constraint if exists services_kind_valid;
--  alter table services drop column if exists kind;)
-- =====================================================================
