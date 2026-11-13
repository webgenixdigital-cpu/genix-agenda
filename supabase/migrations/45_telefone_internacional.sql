-- =====================================================================
-- 45 — Telefone internacional dos clientes
--
-- Aditiva: nenhum dado muda. Todo cliente e agendamento existente fica com
-- país '55' (padrão da coluna) e as regras do Brasil continuam as mesmas.
--
--   1) customers.phone_country / bookings.customer_phone_country
--      (código do país, só dígitos, 1–3; padrão '55') e customers.phone_e164
--      (coluna gerada país + número, para a busca com DDI).
--   2) Telefone válido: '55' continua ^\d{10,11}$; outros ^\d{4,14}$ com
--      país + número ≤ 15 dígitos (E.164). Cliente único por
--      (business_id, phone_country, phone).
--   3) normalize_phone(p, país):
--        '55'  → regra atual: só dígitos e tira o 55 de 12–13 dígitos;
--        outros → só dígitos ("00" do discador internacional sai) e tira o
--                 próprio código do país quando digitado com "+"/"00", ou
--                 quando sobram ≥ 8 dígitos num total ≥ 11 (sem isso um
--                 celular italiano 39x… perderia o "39" do próprio número).
--      phone_is_valid(país, telefone).
--   4) Funções que recebem/usam telefone passam a considerar o país:
--      link_booking_customer (gatilho), create_public_booking (limites por
--      país + número), séries, sell_package_fixed, return_queue e a fila do
--      WhatsApp (devolve 'phone_country'; o número enviado = país + telefone).
--   5) Assinaturas que ganham parâmetro: drop + create com o parâmetro novo
--      no fim e default '55' (o código atual continua funcionando) e os
--      MESMOS grants de antes (conferência no fim do arquivo).
--
-- Ordem: rodar ANTES do merge. Não remove permissão de ninguém.
-- =====================================================================
begin;


-- =====================================================================
-- PARTE 1 — Apoio
-- =====================================================================
create or replace function phone_is_valid(p_country text, p_phone text)
returns boolean
language sql immutable
as $$
  select coalesce(
    case
      when p_country = '55' then p_phone ~ '^\d{10,11}$'
      else p_country ~ '^[1-9]\d{0,2}$' and p_phone ~ '^\d{4,14}$'
           and char_length(p_country) + char_length(p_phone) <= 15
    end, false);
$$;

create or replace function normalize_phone(p text, p_country text)
returns text
language sql immutable
as $$
  select case
    when coalesce(p_country, '55') = '55' then normalize_phone(p)
    when x.explicit and left(x.d, char_length(p_country)) = p_country
      then substr(x.d, char_length(p_country) + 1)
    when left(x.d, char_length(p_country)) = p_country
         and char_length(x.d) >= 11 and char_length(x.d) - char_length(p_country) >= 8
      then substr(x.d, char_length(p_country) + 1)
    else x.d
  end
  from (
    select t ~ '^(\+|00)' as explicit,
           case when t ~ '^00' then substr(regexp_replace(t, '\D', '', 'g'), 3)
                else regexp_replace(t, '\D', '', 'g') end as d
      from (select btrim(coalesce(p, '')) as t) t0
  ) x;
$$;


-- =====================================================================
-- PARTE 2 — Colunas, check e unicidade
-- =====================================================================
alter table customers add column if not exists phone_country text not null default '55';
alter table customers drop constraint if exists customers_phone_country_check;
alter table customers add constraint customers_phone_country_check check (phone_country ~ '^[1-9]\d{0,2}$');

alter table bookings add column if not exists customer_phone_country text not null default '55';
alter table bookings drop constraint if exists bookings_customer_phone_country_check;
alter table bookings add constraint bookings_customer_phone_country_check check (customer_phone_country ~ '^[1-9]\d{0,2}$');

-- check do telefone (a da 14 foi criada sem nome) e unicidade antiga
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
     where c.conrelid = 'customers'::regclass
       and ( (c.contype = 'c' and pg_get_constraintdef(c.oid) ~ 'phone ~ ''\^\\d\{10,11\}\$''')
          or (c.contype = 'u' and pg_get_constraintdef(c.oid) = 'UNIQUE (business_id, phone)') )
  loop
    execute format('alter table customers drop constraint %I', r.conname);
  end loop;
end $$;

alter table customers add constraint customers_phone_check check (
  case when phone_country = '55' then phone ~ '^\d{10,11}$'
       else phone ~ '^\d{4,14}$' and char_length(phone_country) + char_length(phone) <= 15 end
);
alter table customers add constraint customers_business_phone_key unique (business_id, phone_country, phone);

-- busca com DDI ("+351 912…" acha o cliente)
alter table customers add column if not exists phone_e164 text generated always as (phone_country || phone) stored;


-- =====================================================================
-- PARTE 3 — Ligação automática do agendamento ao cliente
-- =====================================================================
create or replace function link_booking_customer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_country text := coalesce(new.customer_phone_country, '55');
  v_phone   text := normalize_phone(new.customer_phone, v_country);
  v_id    uuid;
begin
  if not phone_is_valid(v_country, v_phone) then
    return new;
  end if;

  insert into customers (business_id, name, phone_country, phone)
  values (new.business_id, trim(new.customer_name), v_country, v_phone)
  on conflict (business_id, phone_country, phone) do update set updated_at = now()   -- mantém o nome já cadastrado
  returning id into v_id;

  new.customer_id := v_id;
  return new;
end;
$$;

drop trigger if exists trg_link_booking_customer on bookings;
create trigger trg_link_booking_customer
before insert or update of customer_phone, customer_phone_country on bookings
for each row execute function link_booking_customer();


-- =====================================================================
-- PARTE 4 — Vitrine (limites por país + número)
-- Grants iguais aos da 25: só service_role (a server action da vitrine
-- chama com a chave de serviço; anon e authenticated NÃO executam).
-- =====================================================================
drop function if exists create_public_booking(text, uuid, date, text, text, text, text, uuid);

create or replace function create_public_booking(
  p_slug            text,
  p_service_id      uuid,
  p_date            date,
  p_time            text,          -- 'HH:MM'
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_notes  text default null,
  p_professional_id uuid default null,
  p_customer_country text default '55'   -- 45: código do país (só dígitos)
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  b          businesses;
  s          services;
  p          professionals;
  ids        uuid[];
  v_phone    text;
  v_country  text := coalesce(nullif(regexp_replace(coalesce(p_customer_country, ''), '\D', '', 'g'), ''), '55');
  v_name     text;
  v_start    time;
  v_end      time;
  v_id       uuid;
  v_count    int;
  v_status   booking_status := 'pending';
  v_reason   text;
  v_customer uuid;
begin
  select * into b from businesses where slug = p_slug and is_published;
  if not found then raise exception 'ESTABELECIMENTO_NAO_ENCONTRADO'; end if;

  select * into s from services
   where id = p_service_id and business_id = b.id and active and bookable_online;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;

  v_name  := trim(coalesce(p_customer_name, ''));
  -- 45: Brasil tira o 55 (12–13 dígitos); outros países tiram o próprio código
  v_phone := normalize_phone(p_customer_phone, v_country);
  if char_length(v_name) not between 2 and 80
     or not phone_is_valid(v_country, v_phone)
     or char_length(coalesce(p_customer_notes, '')) > 500 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  -- limites por telefone (proteção contra robôs) — 22_protecao_vitrine
  -- trava por telefone: dois envios simultâneos não furam o limite
  perform pg_advisory_xact_lock(hashtext('public_booking:' || case when v_country = '55' then v_phone else v_country || ':' || v_phone end));

  select count(*) into v_count from bookings
   where business_id = b.id and customer_phone = v_phone and customer_phone_country = v_country
     and source = 'online' and status in ('pending', 'confirmed')
     and booking_date >= (now() at time zone b.timezone)::date;
  if v_count >= 3 then raise exception 'LIMITE_ESPACO'; end if;

  -- na plataforma toda, contando cancelados
  select count(*) into v_count from bookings
   where customer_phone = v_phone and customer_phone_country = v_country and source = 'online'
     and created_at >= now() - interval '24 hours';
  if v_count >= 5 then raise exception 'LIMITE_DIARIO'; end if;

  -- o horário ainda está livre? (mesma regra da vitrine)
  select g.professional_ids into ids
    from get_available_slots(p_slug, p_service_id, p_date, p_professional_id) g
   where g.slot_time = p_time;
  if ids is null then raise exception 'HORARIO_INDISPONIVEL'; end if;

  select * into p from professionals where id = ids[1];   -- "qualquer" = primeiro livre

  v_start := p_time::time;
  v_end   := v_start + make_interval(mins => s.duration_min);

  -- confirmação automática — 25_confirmacao_automatica
  -- recorrente: cliente do espaço (índice único business_id + phone) com
  -- pelo menos 1 atendimento concluído (índice idx_bookings_customer)
  if b.online_confirm_mode = 'todos' then
    v_status := 'confirmed';
    v_reason := 'todos';
  elsif b.online_confirm_mode = 'recorrentes' then
    select c.id into v_customer from customers c
     where c.business_id = b.id and c.phone_country = v_country and c.phone = v_phone;
    if v_customer is not null
       and exists (select 1 from bookings x where x.customer_id = v_customer and x.status = 'completed') then
      v_status := 'confirmed';
      v_reason := 'cliente_recorrente';
    end if;
  end if;

  begin
    insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
      professional_name, customer_name, customer_phone, customer_phone_country, customer_notes,
      booking_date, start_time, end_time, status, source, auto_confirm_reason)
    values (b.id, s.id, p.id, s.name, s.price, s.duration_min,
      p.name, v_name, v_phone, v_country, nullif(trim(p_customer_notes), ''),
      p_date, v_start, v_end, v_status, 'online', v_reason)
    returning id into v_id;
  exception when exclusion_violation then
    -- outra pessoa pegou o horário no mesmo instante
    raise exception 'HORARIO_INDISPONIVEL';
  end;

  return json_build_object(
    'id',                v_id,
    'business_name',     b.name,
    'business_whatsapp', b.whatsapp,
    'service_name',      s.name,
    'price',             s.price,
    'duration_min',      s.duration_min,
    'professional_name', p.name,
    'date',              p_date,
    'start_time',        to_char(v_start, 'HH24:MI'),
    'end_time',          to_char(v_end, 'HH24:MI'),
    'customer_name',     v_name,
    'status',            v_status
  );
end;
$$;

revoke execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid, text) to service_role;


-- =====================================================================
-- PARTE 5 — Agendamentos em série (grants iguais aos da 20)
-- =====================================================================
drop function if exists preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text);
drop function if exists create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid);
drop function if exists check_series_input(uuid, uuid, uuid, text, int, uuid, text);

create or replace function check_series_input(
  p_business uuid, p_professional uuid, p_service uuid, p_frequency text, p_count int, p_package uuid, p_phone text,
  p_country text default '55'   -- 45
)
returns void
language plpgsql stable security definer set search_path = public
as $$
declare
  cp customer_packages;
begin
  if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then raise exception 'FREQUENCIA_INVALIDA'; end if;
  if p_count is null or p_count < 1 or p_count > 52 then raise exception 'QUANTIDADE_INVALIDA'; end if;
  if access_tier(p_business) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if not exists (select 1 from professionals where id = p_professional and business_id = p_business)
     or not exists (select 1 from services where id = p_service and business_id = p_business) then
    raise exception 'DADOS_INVALIDOS';
  end if;
  if not can_manage_booking(p_business, p_professional) then raise exception 'SEM_PERMISSAO'; end if;

  if p_package is not null then
    select * into cp from customer_packages where id = p_package;
    if not found or cp.business_id <> p_business or cp.status <> 'active'
       or not exists (select 1 from customer_package_items pi where pi.customer_package_id = cp.id and pi.service_id = p_service)
       or not exists (select 1 from customers c where c.id = cp.customer_id and c.phone_country = coalesce(p_country, '55')
                                                  and c.phone = normalize_phone(p_phone, coalesce(p_country, '55'))) then
      raise exception 'PACOTE_INVALIDO';
    end if;
  end if;
end;
$$;

create or replace function preview_booking_series(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_time text,
  p_frequency text, p_count int, p_package uuid default null, p_phone text default null,
  p_country text default '55'   -- 45
)
returns table (seq int, occurs_on date, issue text, package_fit int, package_expires date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_fit int;
  v_exp date;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'DADOS_INVALIDOS'; end if;
  perform check_series_input(p_business, p_professional, p_service, p_frequency, p_count, p_package, p_phone, p_country);

  if p_package is not null then
    v_fit := series_package_fit(p_package, p_service, p_frequency, p_date, p_count);
    select expires_at into v_exp from customer_packages where id = p_package;
  end if;

  return query
  select d.seq, d.occurs_on,
         booking_slot_issue(p_business, p_professional, p_service, d.occurs_on, p_time::time),
         v_fit, v_exp
  from series_dates(p_frequency, p_date, p_count) d
  order by d.seq;
end;
$$;

create or replace function create_booking_series(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_time text,
  p_frequency text, p_count int,
  p_customer_name text, p_customer_phone text, p_notes text default null, p_package uuid default null,
  p_customer_country text default '55'   -- 45
)
returns table (seq int, occurs_on date, booking_id uuid, issue text)
language plpgsql volatile security definer set search_path = public
as $$
declare
  s       services;
  p       professionals;
  v_time  time;
  v_end   time;
  v_endm  int;
  v_country text := coalesce(nullif(regexp_replace(coalesce(p_customer_country, ''), '\D', '', 'g'), ''), '55');
  v_phone text := normalize_phone(p_customer_phone, v_country);
  v_name  text := trim(coalesce(p_customer_name, ''));
  v_fit   int;
  v_series uuid;
  v_id    uuid;
  v_issue text;
  v_made  int := 0;
  d       record;
begin
  if p_time !~ '^\d{2}:\d{2}$' or char_length(v_name) < 2 or not phone_is_valid(v_country, v_phone) then
    raise exception 'DADOS_INVALIDOS';
  end if;
  perform check_series_input(p_business, p_professional, p_service, p_frequency, p_count, p_package, p_customer_phone, v_country);

  select * into s from services where id = p_service;
  select * into p from professionals where id = p_professional;
  v_time := p_time::time;
  v_endm := extract(hour from v_time)::int * 60 + extract(minute from v_time)::int + s.duration_min;
  if v_endm >= 24 * 60 then raise exception 'DADOS_INVALIDOS'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  -- pacote: trava a linha (dois usuários ao mesmo tempo esperam um ao outro)
  -- e exige que a série inteira caiba no saldo do serviço e na validade
  if p_package is not null then
    perform 1 from customer_packages where id = p_package for update;
    v_fit := series_package_fit(p_package, p_service, p_frequency, p_date, p_count);
    if coalesce(v_fit, 0) < p_count then raise exception 'PACOTE_NAO_CABE:%', coalesce(v_fit, 0); end if;
  end if;

  insert into booking_series (business_id, professional_id, service_id, customer_package_id,
                              frequency, start_date, start_time, occurrences, created_by)
  values (p_business, p_professional, p_service, p_package, p_frequency, p_date, v_time, p_count, auth.uid())
  returning id into v_series;

  for d in select * from series_dates(p_frequency, p_date, p_count) order by 1 loop
    v_id := null;
    v_issue := booking_slot_issue(p_business, p_professional, p_service, d.occurs_on, v_time);

    if v_issue is null then
      begin
        insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
                              professional_name, customer_name, customer_phone, customer_phone_country, customer_notes,
                              booking_date, start_time, end_time, status, source,
                              customer_package_id, series_id)
        values (p_business, s.id, p.id, s.name, s.price, s.duration_min,
                p.name, v_name, v_phone, v_country, nullif(trim(coalesce(p_notes, '')), ''),
                d.occurs_on, v_time, v_end, 'confirmed', 'manual',
                p_package, v_series)
        returning id into v_id;
        v_made := v_made + 1;
      exception
        when exclusion_violation then v_issue := 'OCUPADO';
        when others then
          v_issue := case when sqlerrm like 'PACOTE_%' then split_part(sqlerrm, ' ', 1) else 'RECUSADO' end;
      end;
    end if;

    seq := d.seq; occurs_on := d.occurs_on; booking_id := v_id; issue := v_issue;
    return next;
  end loop;

  if v_made = 0 then
    delete from booking_series where id = v_series;
  end if;
end;
$$;

revoke all on function check_series_input(uuid, uuid, uuid, text, int, uuid, text, text) from public, anon, authenticated;
revoke all on function preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text, text) from public, anon;
grant execute on function preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text, text) to authenticated;
revoke all on function create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid, text) from public, anon;
grant execute on function create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid, text) to authenticated;


-- =====================================================================
-- PARTE 6 — Pacote com datas fixas (mesma assinatura: grants mantidos)
-- =====================================================================
create or replace function sell_package_fixed(p_customer uuid, p_template uuid, p_method text, p_rules jsonb)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  c        customers;
  v_bid    uuid;
  v_pkg    uuid;
  v_exp    date;
  v_series uuid[] := '{}';
  v_sid    uuid;
  v_bk     uuid;
  v_issue  text;
  v_made   int := 0;
  v_skip   int := 0;
  v_dates  jsonb := '[]'::jsonb;
  v_endm   int;
  v_pos    int;
  v_rule   jsonb;
  v_i      int := 0;
  s0       services;
  p        professionals;
  sx       services;
  d        record;
begin
  v_bid := check_package_sale(p_customer, p_template);
  -- trava a cliente: duas vendas ao mesmo tempo esperam uma pela outra
  select * into c from customers where id = p_customer for update;

  -- regra inválida (package_plan_dates) desfaz tudo, inclusive o caixa
  v_pkg := sell_package_core(p_customer, p_template, p_method, 'fixed');
  select expires_at into v_exp from customer_packages where id = v_pkg;

  for v_rule in select value from jsonb_array_elements(p_rules) loop
    insert into booking_series (business_id, professional_id, service_id, customer_package_id,
                                frequency, start_date, start_time, occurrences, created_by, service_ids)
    values (v_bid, (v_rule->>'professional_id')::uuid, (v_rule->'service_ids'->>0)::uuid, v_pkg,
            v_rule->>'frequency', (v_rule->>'start_date')::date, (v_rule->>'time')::time,
            least(greatest((v_rule->>'count')::int, 1), 52), auth.uid(),
            array(select x::uuid from jsonb_array_elements_text(v_rule->'service_ids') x))
    returning id into v_sid;
    v_series := v_series || v_sid;
  end loop;

  for d in select * from package_plan_dates(v_bid, p_template, v_exp, p_rules) loop
    v_bk := null;
    v_issue := d.issue;

    if v_issue is null then
      begin
        select * into s0 from services where id = d.service_ids[1];
        select * into p from professionals where id = d.professional_id;
        v_endm := extract(hour from d.start_time)::int * 60 + extract(minute from d.start_time)::int + s0.duration_min;

        insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
                              professional_name, customer_name, customer_phone, customer_phone_country,
                              booking_date, start_time, end_time, status, source,
                              customer_package_id, series_id)
        values (v_bid, s0.id, p.id, s0.name, s0.price, s0.duration_min,
                p.name, c.name, c.phone, c.phone_country,
                d.occurs_on, d.start_time, make_time(v_endm / 60 % 24, v_endm % 60, 0), 'confirmed', 'manual',
                v_pkg, v_series[d.rule_idx + 1])
        returning id into v_bk;

        -- adicionais da mesma visita, pagos pelo pacote (estende o horário)
        if array_length(d.service_ids, 1) > 1 then
          v_pos := 0;
          for v_i in 2 .. array_length(d.service_ids, 1) loop
            select * into sx from services where id = d.service_ids[v_i];
            v_pos := v_pos + 1;
            insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                                       position, extends_time, paid_by_package, added_by, customer_package_item_id)
            values (v_bk, v_bid, sx.id, sx.name, sx.price, sx.duration_min,
                    v_pos, true, true, auth.uid(),
                    (select id from customer_package_items
                      where customer_package_id = v_pkg and service_id = sx.id order by position limit 1));
          end loop;
          perform recalc_booking(v_bk);
        end if;
        v_made := v_made + 1;
      exception
        when exclusion_violation then v_bk := null; v_issue := 'OCUPADO';
        when others then
          v_bk := null;
          v_issue := case when sqlerrm like 'PACOTE_%' or sqlerrm in ('MEIA_NOITE')
                          then split_part(sqlerrm, ' ', 1) else 'RECUSADO' end;
      end;
    end if;

    if v_bk is null then v_skip := v_skip + 1; end if;
    v_dates := v_dates || jsonb_build_object(
      'rule', d.rule_idx, 'seq', d.seq, 'date', d.occurs_on, 'time', to_char(d.start_time, 'HH24:MI'),
      'services', d.service_names, 'issue', v_issue, 'booking_id', v_bk);
  end loop;

  -- série sem nenhuma visita não fica guardada
  delete from booking_series bs
   where bs.id = any(v_series)
     and not exists (select 1 from bookings b where b.series_id = bs.id);

  return json_build_object('package_id', v_pkg, 'created', v_made, 'skipped', v_skip, 'dates', v_dates);
end;
$$;


-- =====================================================================
-- PARTE 7 — Fila de retornos (nova coluna no retorno: drop + create;
-- grants iguais: os padrões do Supabase + execute para authenticated da 18)
-- =====================================================================
drop function if exists return_queue(uuid, int);

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
  return_contacted_at timestamptz,
  customer_phone_country text   -- 45
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
    lv.return_contacted_at,
    c.phone_country
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

grant execute on function return_queue(uuid, int) to authenticated;


-- =====================================================================
-- PARTE 8 — WhatsApp automático (mesmas assinaturas: grants mantidos)
-- O número enviado é país + telefone ('phone_country' + 'phone').
-- =====================================================================
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
  if access_tier(b.id) <> 'completo' then return; end if;

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

create or replace function claim_auto_reminder(p_business uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_booking uuid;
  v_attempt smallint;
  bk        bookings;
  b         businesses;
  st        whatsapp_settings;
  inst      whatsapp_instances;
  v_id      uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  select * into inst from whatsapp_instances
   where business_id = p_business and genix_enabled and status = 'connected';
  if not found then return null; end if;

  if inst.phone_number is not null
     and not pg_try_advisory_xact_lock(hashtext('whatsapp_number:' || inst.phone_number)) then
    return null;
  end if;

  select n.booking_id, n.attempt into v_booking, v_attempt from next_auto_reminder(p_business) n;
  if v_booking is null then return null; end if;

  select * into bk from bookings where id = v_booking;
  select * into b  from businesses where id = p_business;
  select * into st from whatsapp_settings where business_id = p_business for update;

  -- linha 'eve' deixada pela fila nova (queued/skipped): vira a reserva
  update whatsapp_reminder_sends
     set status = 'sending', claimed_at = now(), variant = st.next_variant, reason = null, finished_at = null
   where booking_id = bk.id and kind = 'eve'
     and booking_date = bk.booking_date and start_time = bk.start_time
     and attempt = v_attempt and status in ('queued', 'skipped')
  returning id into v_id;

  if v_id is null then
    begin
      insert into whatsapp_reminder_sends (business_id, booking_id, booking_date, start_time, attempt, variant)
      values (p_business, bk.id, bk.booking_date, bk.start_time, v_attempt, st.next_variant)
      returning id into v_id;
    exception when unique_violation then
      return null;
    end;
  end if;

  update whatsapp_settings set next_variant = (next_variant + 1) % 3 where business_id = p_business;

  return json_build_object(
    'send_id',           v_id,
    'booking_id',        bk.id,
    'attempt',           v_attempt,
    'variant',           st.next_variant,
    'template',          case st.next_variant when 0 then st.template_a when 1 then st.template_b else st.template_c end,
    'phone',             normalize_phone(bk.customer_phone, bk.customer_phone_country),
    'phone_country',     bk.customer_phone_country,
    'customer_name',     bk.customer_name,
    'service_name',      bk.service_name,
    'professional_name', bk.professional_name,
    'booking_date',      bk.booking_date,
    'start_time',        to_char(bk.start_time, 'HH24:MI'),
    'business_name',     b.name
  );
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
                          and access_tier(st.business_id) = 'completo')
    returning 1
  )
  select count(*) into v_skip from x;

  for b in
    select bz.id, bz.timezone, st.eve_enabled, st.confirm_enabled, st.confirm_since,
           st.before_enabled, st.before_minutes, st.birthday_enabled
      from businesses bz
      join whatsapp_settings  st on st.business_id = bz.id and st.auto_enabled
      join whatsapp_instances i  on i.business_id  = bz.id and i.genix_enabled
     where access_tier(bz.id) = 'completo'
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

create or replace function claim_auto_message(p_business uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  inst     whatsapp_instances;
  b        businesses;
  st       whatsapp_settings;
  s        whatsapp_reminder_sends;
  bk       bookings;
  c        customers;
  v_id     uuid;
  v_reason text;
  v_phone  text;
  v_country text;
  v_tpl    text;
  v_var    smallint;
  v_last   timestamptz;
  v_due    timestamptz;
  i        int;
begin
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  select * into inst from whatsapp_instances
   where business_id = p_business and genix_enabled and status = 'connected';
  if not found then return null; end if;
  if inst.phone_number is not null
     and not pg_try_advisory_xact_lock(hashtext('whatsapp_number:' || inst.phone_number)) then
    return null;
  end if;

  select * into b  from businesses where id = p_business;
  select * into st from whatsapp_settings where business_id = p_business for update;

  for i in 1..5 loop
    select n.send_id into v_id from next_auto_message(p_business) n;
    if v_id is null then return null; end if;

    select * into s from whatsapp_reminder_sends where id = v_id and status = 'queued' for update skip locked;
    if not found then return null; end if;

    v_reason := null;
    if s.kind = 'birthday' then
      select * into c from customers where id = s.customer_id;
      if not found or c.no_auto_reminders then v_reason := 'OPT_OUT';
      elsif not phone_is_valid(c.phone_country, c.phone) then v_reason := 'NUMERO_INVALIDO';
      elsif not st.birthday_enabled then v_reason := 'DESLIGADO';
      end if;
      v_phone := c.phone;
      v_country := c.phone_country;
    else
      select * into bk from bookings where id = s.booking_id;
      if not found or bk.status = 'cancelled' then v_reason := 'CANCELADO';
      elsif bk.booking_date <> s.booking_date or bk.start_time <> s.start_time then v_reason := 'REMARCADO';
      elsif bk.status <> 'confirmed' then v_reason := 'NAO_CONFIRMADO';
      elsif s.kind = 'eve' and bk.reminder_sent_at is not null then v_reason := 'JA_LEMBRADO';
      elsif (s.kind = 'confirmation' and not st.confirm_enabled)
         or (s.kind = 'before' and not st.before_enabled)
         or (s.kind = 'eve' and not st.eve_enabled) then v_reason := 'DESLIGADO';
      elsif exists (select 1 from customers cc where cc.id = bk.customer_id and cc.no_auto_reminders) then v_reason := 'OPT_OUT';
      elsif not phone_is_valid(bk.customer_phone_country, normalize_phone(bk.customer_phone, bk.customer_phone_country)) then v_reason := 'NUMERO_INVALIDO';
      end if;
      -- regra das 6 h (44): adia para 6 h depois da última mensagem do mesmo
      -- agendamento + horário; DISPENSADA só se não cabe mais na validade
      if v_reason is null then
        select max(o.sent_at) into v_last
          from whatsapp_reminder_sends o
         where o.booking_id = s.booking_id and o.kind <> s.kind
           and o.booking_date = s.booking_date and o.start_time = s.start_time
           and o.status = 'sent' and o.sent_at > now() - interval '6 hours';
        if v_last is not null then
          v_due := whatsapp_window_start(v_last + interval '6 hours', b.timezone);
          if v_due < s.expires_at then
            update whatsapp_reminder_sends set due_at = v_due where id = s.id;
            continue;
          end if;
          v_reason := 'DISPENSADA';
        end if;
      end if;
      v_phone := normalize_phone(bk.customer_phone, bk.customer_phone_country);
      v_country := bk.customer_phone_country;
    end if;

    if v_reason is not null then
      update whatsapp_reminder_sends set status = 'skipped', reason = v_reason, finished_at = now() where id = s.id;
      continue;
    end if;

    v_var := case when s.kind = 'eve' then st.next_variant else 0 end;
    update whatsapp_reminder_sends
       set status = 'sending', claimed_at = now(), variant = v_var
     where id = s.id;
    if s.kind = 'eve' then
      update whatsapp_settings set next_variant = (next_variant + 1) % 3 where business_id = p_business;
    end if;

    v_tpl := case s.kind
               when 'confirmation' then st.template_confirm
               when 'before'       then st.template_before
               when 'birthday'     then st.template_birthday
               else case v_var when 0 then st.template_a when 1 then st.template_b else st.template_c end
             end;

    -- aniversário não tem agendamento (bk pode ter sobrado de uma volta anterior do laço)
    if s.kind = 'birthday' then
      return json_build_object(
        'send_id', s.id, 'kind', s.kind, 'attempt', s.attempt, 'variant', v_var, 'template', v_tpl,
        'phone', v_phone, 'phone_country', v_country, 'customer_name', c.name,
        'service_name', null, 'professional_name', null, 'booking_date', null, 'start_time', null,
        'business_name', b.name
      );
    end if;
    return json_build_object(
      'send_id',           s.id,
      'kind',              s.kind,
      'attempt',           s.attempt,
      'variant',           v_var,
      'template',          v_tpl,
      'phone',             v_phone,
      'phone_country',     v_country,
      'customer_name',     bk.customer_name,
      'service_name',      bk.service_name,
      'professional_name', bk.professional_name,
      'booking_date',      bk.booking_date,
      'start_time',        to_char(bk.start_time, 'HH24:MI'),
      'business_name',     b.name
    );
  end loop;
  return null;
end;
$$;

commit;


-- =====================================================================
-- CONFERÊNCIA (só leitura)
-- =====================================================================
-- 1) GRANTS — rode ANTES da migration, guarde o resultado, rode DEPOIS e
--    compare: cada função deve ter o MESMO conjunto de "executam" (só os
--    argumentos mudam nas 5 que ganharam parâmetro/coluna).
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--          (select string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end, ', ' order by 1)
--             from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
--            where g.privilege_type = 'EXECUTE') as executam
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('create_public_booking', 'check_series_input', 'preview_booking_series',
--                        'create_booking_series', 'return_queue', 'sell_package_fixed', 'link_booking_customer',
--                        'next_auto_reminder', 'claim_auto_reminder', 'whatsapp_queue_refresh',
--                        'claim_auto_message', 'normalize_phone', 'phone_is_valid')
--    order by 1, 2;
--   Esperado depois: create_public_booking → postgres, service_role (sem anon);
--   check_series_input → postgres, service_role; preview/create_booking_series e
--   sell_package_fixed → authenticated, postgres, service_role; return_queue →
--   PUBLIC, anon, authenticated, postgres, service_role (como antes); fila do
--   WhatsApp → postgres, service_role.
--
-- 2) nenhuma linha mudou de país (deve voltar só '55')
--   select phone_country, count(*) from customers group by 1;
--   select customer_phone_country, count(*) from bookings group by 1;
--
-- 3) restrições novas
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'customers'::regclass and conname like 'customers_%phone%';
--
-- 4) normalização
--   select normalize_phone('+55 (35) 99999-0001', '55'), normalize_phone('+351 912 345 678', '351'),
--          normalize_phone('3931234567', '39'), normalize_phone('393931234567', '39');
--   -- esperado: 35999990001 | 912345678 | 3931234567 | 3931234567


-- =====================================================================
-- REVERSÃO (comentada)
-- ATENÇÃO: antes, clientes e agendamentos com país ≠ '55' precisam ser
-- tratados (excluídos ou trocados), porque o check antigo os recusa.
--   select count(*) from customers where phone_country <> '55';
--   select count(*) from bookings  where customer_phone_country <> '55';
-- =====================================================================
-- begin;
-- drop function if exists create_public_booking(text, uuid, date, text, text, text, text, uuid, text);
-- drop function if exists preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text, text);
-- drop function if exists create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid, text);
-- drop function if exists check_series_input(uuid, uuid, uuid, text, int, uuid, text, text);
-- drop function if exists return_queue(uuid, int);
-- -- rodar de novo, no SQL Editor, os blocos "create or replace function" + grants de:
-- --   14_clientes.sql            link_booking_customer
-- --   25_confirmacao_automatica  create_public_booking + revoke/grant (linhas 189–190)
-- --   37_plano_fechado.sql       check_series_input, preview_booking_series, create_booking_series
-- --                              + revoke/grant da 20_recorrencia (linhas 179, 214–215, 306–307)
-- --   39_pacote_datas_fixas.sql  sell_package_fixed
-- --   31_editar_agendamento.sql  return_queue + grant da 18_retornos (linha 74)
-- --   42_whatsapp_tipos_mensagem next_auto_reminder, claim_auto_reminder
-- --   44_whatsapp_vespera_registro whatsapp_queue_refresh, claim_auto_message
-- drop trigger if exists trg_link_booking_customer on bookings;
-- create trigger trg_link_booking_customer before insert or update of customer_phone on bookings
--   for each row execute function link_booking_customer();
-- alter table customers drop constraint if exists customers_business_phone_key;
-- alter table customers drop constraint if exists customers_phone_check;
-- alter table customers drop column if exists phone_e164;
-- alter table customers drop column if exists phone_country;
-- alter table customers add constraint customers_phone_check check (phone ~ '^\d{10,11}$');
-- alter table customers add constraint customers_business_id_phone_key unique (business_id, phone);
-- alter table bookings drop column if exists customer_phone_country;
-- drop function if exists normalize_phone(text, text);
-- drop function if exists phone_is_valid(text, text);
-- commit;
