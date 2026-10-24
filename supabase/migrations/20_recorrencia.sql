-- =====================================================================
-- GENIX AGENDA — N4.2 Agendamentos recorrentes
-- Série semanal, quinzenal ou mensal (mesmo horário e profissional).
-- Cada ocorrência é um booking normal; datas com conflito são PULADAS.
-- Aditiva. Pode rodar inteira de uma vez. Reversão comentada no final.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Série e vínculo no agendamento
-- =====================================================================
create table if not exists booking_series (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  professional_id     uuid not null references professionals(id) on delete cascade,
  service_id          uuid references services(id) on delete set null,
  customer_package_id uuid references customer_packages(id) on delete set null,
  frequency           text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  start_date          date not null,
  start_time          time not null,
  occurrences         int not null check (occurrences between 1 and 52),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_booking_series_business on booking_series (business_id);

alter table bookings add column if not exists series_id uuid references booking_series(id) on delete set null;
create index if not exists idx_bookings_series on bookings (series_id) where series_id is not null;

-- leitura: quem vê a agenda inteira, ou o profissional da própria série.
-- Escrita só pelas funções abaixo.
alter table booking_series enable row level security;
drop policy if exists "ve series" on booking_series;
create policy "ve series" on booking_series
  for select to authenticated
  using (sees_whole_agenda(business_id) or professional_id = my_professional_id(business_id));


-- =====================================================================
-- PARTE 2 — Datas da série
-- Mensal: sempre a partir do dia original; se o dia não existe no mês
-- (29, 30, 31), usa o último dia do mês. Ex.: 31/01 → 28/02 → 31/03 → 30/04.
-- =====================================================================
create or replace function series_dates(p_frequency text, p_start date, p_count int)
returns table (seq int, occurs_on date)
language sql immutable
as $$
  select i + 1,
         case p_frequency
           when 'weekly'   then p_start + i * 7
           when 'biweekly' then p_start + i * 14
           else least(
             (date_trunc('month', p_start) + make_interval(months => i))::date + (extract(day from p_start)::int - 1),
             (date_trunc('month', p_start) + make_interval(months => i + 1))::date - 1
           )
         end
  from generate_series(0, greatest(least(p_count, 52), 1) - 1) as i;
$$;


-- =====================================================================
-- PARTE 3 — Uma data está livre? (regra única da prévia e da criação)
-- Devolve null (livre) ou o motivo:
--   PASSADO | FECHADO | FORA_EXPEDIENTE | PROFISSIONAL_INDISPONIVEL | BLOQUEIO | OCUPADO
-- Uso interno das funções abaixo (que conferem a permissão).
-- =====================================================================
create or replace function booking_slot_issue(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_start time
)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  b       businesses;
  s       services;
  h       business_hours;
  v_endm  int;
  v_end   time;
begin
  select * into b from businesses where id = p_business;
  select * into s from services where id = p_service and business_id = p_business;
  if not found then return 'PROFISSIONAL_INDISPONIVEL'; end if;

  if (p_date + p_start) <= (now() at time zone b.timezone) then return 'PASSADO'; end if;

  v_endm := extract(hour from p_start)::int * 60 + extract(minute from p_start)::int + s.duration_min;
  if v_endm >= 24 * 60 then return 'FORA_EXPEDIENTE'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  select * into h from business_hours where business_id = p_business and weekday = extract(dow from p_date)::int;
  if not found or h.closed then return 'FECHADO'; end if;
  if p_start < h.open_time or v_endm > extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int then
    return 'FORA_EXPEDIENTE';
  end if;

  -- profissional ativo e que faz o serviço (sem vínculos = faz todos)
  if not exists (
    select 1 from professionals p
    where p.id = p_professional and p.business_id = p_business and p.active
      and ( not exists (select 1 from professional_services ps where ps.professional_id = p.id)
            or exists (select 1 from professional_services ps where ps.professional_id = p.id and ps.service_id = p_service) )
  ) then
    return 'PROFISSIONAL_INDISPONIVEL';
  end if;

  if slot_conflicts_block(p_business, p_professional, p_date, p_start, v_end) then return 'BLOQUEIO'; end if;

  if exists (
    select 1 from bookings bk
    where bk.professional_id = p_professional
      and bk.status in ('pending', 'confirmed')
      and bk.period && tsrange(p_date + p_start, p_date + p_start + make_interval(mins => s.duration_min), '[)')
  ) then
    return 'OCUPADO';
  end if;

  return null;
end;
$$;

revoke all on function booking_slot_issue(uuid, uuid, uuid, date, time) from public, anon, authenticated;


-- =====================================================================
-- PARTE 4 — Quantas sessões do pacote cabem (saldo e validade)
-- Considera TODAS as datas pedidas (antes dos pulos): data pulada não
-- consome saldo, mas a série inteira precisa caber no pacote.
-- =====================================================================
create or replace function series_package_fit(p_package uuid, p_frequency text, p_start date, p_count int)
returns int
language sql stable security definer set search_path = public
as $$
  select least(
    greatest(cp.sessions_total - (
      select count(*) from bookings b
      where b.customer_package_id = cp.id and b.status in ('pending', 'confirmed', 'completed')
    ), 0)::int,
    (select count(*) from series_dates(p_frequency, p_start, p_count) d
      where cp.expires_at is null or d.occurs_on <= cp.expires_at)::int
  )
  from customer_packages cp where cp.id = p_package;
$$;

revoke all on function series_package_fit(uuid, text, date, int) from public, anon, authenticated;


-- =====================================================================
-- PARTE 5 — Validações comuns (prévia e criação)
-- =====================================================================
create or replace function check_series_input(
  p_business uuid, p_professional uuid, p_service uuid, p_frequency text, p_count int, p_package uuid, p_phone text
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
    if not found or cp.business_id <> p_business or cp.service_id is distinct from p_service or cp.status <> 'active'
       or not exists (select 1 from customers c where c.id = cp.customer_id and c.phone = normalize_phone(p_phone)) then
      raise exception 'PACOTE_INVALIDO';
    end if;
  end if;
end;
$$;

revoke all on function check_series_input(uuid, uuid, uuid, text, int, uuid, text) from public, anon, authenticated;


-- =====================================================================
-- PARTE 6 — Prévia: cada data com o motivo (null = vai criar)
-- package_fit: quantas sessões cabem no pacote (null sem pacote)
-- =====================================================================
create or replace function preview_booking_series(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_time text,
  p_frequency text, p_count int, p_package uuid default null, p_phone text default null
)
returns table (seq int, occurs_on date, issue text, package_fit int, package_expires date)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_fit int;
  v_exp date;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'DADOS_INVALIDOS'; end if;
  perform check_series_input(p_business, p_professional, p_service, p_frequency, p_count, p_package, p_phone);

  if p_package is not null then
    v_fit := series_package_fit(p_package, p_frequency, p_date, p_count);
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

revoke all on function preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text) from public, anon;
grant execute on function preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text) to authenticated;


-- =====================================================================
-- PARTE 7 — Criar a série
-- Cada data num bloco BEGIN/EXCEPTION próprio (savepoint): uma recusa
-- (no_overlap, PACOTE_*, bloqueio...) pula só aquela data.
-- Os triggers de bookings (cliente, pacote, histórico) disparam normalmente.
-- Sem nenhuma data criada, a série é apagada (nada órfão).
-- =====================================================================
create or replace function create_booking_series(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_time text,
  p_frequency text, p_count int,
  p_customer_name text, p_customer_phone text, p_notes text default null, p_package uuid default null
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
  v_phone text := normalize_phone(p_customer_phone);
  v_name  text := trim(coalesce(p_customer_name, ''));
  v_fit   int;
  v_series uuid;
  v_id    uuid;
  v_issue text;
  v_made  int := 0;
  d       record;
begin
  if p_time !~ '^\d{2}:\d{2}$' or char_length(v_name) < 2 or v_phone !~ '^\d{10,11}$' then
    raise exception 'DADOS_INVALIDOS';
  end if;
  perform check_series_input(p_business, p_professional, p_service, p_frequency, p_count, p_package, p_customer_phone);

  select * into s from services where id = p_service;
  select * into p from professionals where id = p_professional;
  v_time := p_time::time;
  v_endm := extract(hour from v_time)::int * 60 + extract(minute from v_time)::int + s.duration_min;
  if v_endm >= 24 * 60 then raise exception 'DADOS_INVALIDOS'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  -- pacote: trava a linha (dois usuários ao mesmo tempo esperam um ao outro)
  -- e exige que a série inteira caiba no saldo e na validade
  if p_package is not null then
    perform 1 from customer_packages where id = p_package for update;
    v_fit := series_package_fit(p_package, p_frequency, p_date, p_count);
    if v_fit < p_count then raise exception 'PACOTE_NAO_CABE:%', v_fit; end if;
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
                              professional_name, customer_name, customer_phone, customer_notes,
                              booking_date, start_time, end_time, status, source,
                              customer_package_id, series_id)
        values (p_business, s.id, p.id, s.name, s.price, s.duration_min,
                p.name, v_name, v_phone, nullif(trim(coalesce(p_notes, '')), ''),
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

revoke all on function create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid) from public, anon;
grant execute on function create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid) to authenticated;


-- =====================================================================
-- PARTE 8 — Cancelar as próximas da série
-- Só futuras, pending/confirmed, e só onde can_manage_booking é verdadeiro
-- (profissional: só as da própria agenda). Com pacote, voltam ao saldo.
-- Retorna quantas foram canceladas.
-- =====================================================================
create or replace function cancel_series_future(p_series uuid)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  sr booking_series;
  v_now timestamp;
  v_count int;
begin
  select * into sr from booking_series where id = p_series;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;

  select now() at time zone timezone into v_now from businesses where id = sr.business_id;

  update bookings b
     set status = 'cancelled'
   where b.series_id = p_series
     and b.status in ('pending', 'confirmed')
     and (b.booking_date + b.start_time) > v_now
     and can_manage_booking(b.business_id, b.professional_id);
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function cancel_series_future(uuid) from public, anon;
grant execute on function cancel_series_future(uuid) to authenticated;


-- =====================================================================
-- PARTE 9 — Conferência
-- =====================================================================
select * from series_dates('monthly', date '2027-01-31', 4);   -- 31/01, 28/02, 31/03, 30/04


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- drop function if exists cancel_series_future(uuid);
-- drop function if exists create_booking_series(uuid, uuid, uuid, date, text, text, int, text, text, text, uuid);
-- drop function if exists preview_booking_series(uuid, uuid, uuid, date, text, text, int, uuid, text);
-- drop function if exists check_series_input(uuid, uuid, uuid, text, int, uuid, text);
-- drop function if exists series_package_fit(uuid, text, date, int);
-- drop function if exists booking_slot_issue(uuid, uuid, uuid, date, time);
-- drop function if exists series_dates(text, date, int);
-- drop index if exists idx_bookings_series;
-- alter table bookings drop column if exists series_id;
-- drop table if exists booking_series;
-- =====================================================================
