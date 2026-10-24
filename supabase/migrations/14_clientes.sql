-- =====================================================================
-- GENIX AGENDA — B1.1: CLIENTES E HISTÓRICO DOS AGENDAMENTOS
-- Rode o arquivo inteiro no SQL Editor.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Telefone padronizado (só dígitos, sem o 55 do Brasil)
-- =====================================================================
create or replace function normalize_phone(p text)
returns text
language sql immutable
as $$
  select case
    when d ~ '^55\d{10,11}$' then substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;


-- =====================================================================
-- PARTE 2 — Tabela de clientes (1 por número de WhatsApp em cada espaço)
-- =====================================================================
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  phone       text not null check (phone ~ '^\d{10,11}$'),
  email       text,
  notes       text check (notes is null or char_length(notes) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, phone)
);

create index if not exists idx_customers_business_name on customers (business_id, name);

drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers for each row execute function set_updated_at();

alter table bookings add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists idx_bookings_customer on bookings (customer_id, booking_date desc);


-- =====================================================================
-- PARTE 3 — Ligar os agendamentos ANTIGOS aos clientes
-- =====================================================================
-- 3.1 cria 1 cliente por telefone, com o nome do agendamento mais antigo
insert into customers (business_id, name, phone, created_at)
select distinct on (b.business_id, normalize_phone(b.customer_phone))
       b.business_id, trim(b.customer_name), normalize_phone(b.customer_phone), b.created_at
from bookings b
where normalize_phone(b.customer_phone) ~ '^\d{10,11}$'
order by b.business_id, normalize_phone(b.customer_phone), b.created_at
on conflict (business_id, phone) do nothing;

-- 3.2 liga cada agendamento ao seu cliente
update bookings b
set customer_id = c.id
from customers c
where b.customer_id is null
  and c.business_id = b.business_id
  and c.phone = normalize_phone(b.customer_phone);


-- =====================================================================
-- PARTE 4 — Ligação AUTOMÁTICA dos agendamentos novos
-- =====================================================================
create or replace function link_booking_customer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := normalize_phone(new.customer_phone);
  v_id    uuid;
begin
  if v_phone !~ '^\d{10,11}$' then
    return new;
  end if;

  insert into customers (business_id, name, phone)
  values (new.business_id, trim(new.customer_name), v_phone)
  on conflict (business_id, phone) do update set updated_at = now()   -- mantém o nome já cadastrado
  returning id into v_id;

  new.customer_id := v_id;
  return new;
end;
$$;

drop trigger if exists trg_link_booking_customer on bookings;
create trigger trg_link_booking_customer
before insert or update of customer_phone on bookings
for each row execute function link_booking_customer();


-- =====================================================================
-- PARTE 5 — Histórico de cada agendamento (gravado pelo banco)
-- =====================================================================
create table if not exists booking_events (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  action      text not null,   -- created | confirmed | cancelled | completed | pending | rescheduled | reminder
  actor_id    uuid,            -- null = cliente pela vitrine
  actor_role  text,            -- owner | reception | staff | online | sistema
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_booking_events_booking on booking_events (booking_id, created_at);

create or replace function log_booking_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text := case when auth.uid() is null then 'online' else coalesce(member_role_of(new.business_id), 'sistema') end;
begin
  if tg_op = 'INSERT' then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, 'created', v_actor, v_role,
            jsonb_build_object('source', new.source, 'status', new.status,
                               'date', new.booking_date, 'time', to_char(new.start_time, 'HH24:MI'),
                               'professional', new.professional_name));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, new.status::text, v_actor, v_role, jsonb_build_object('from', old.status));
  end if;

  if new.booking_date is distinct from old.booking_date
     or new.start_time is distinct from old.start_time
     or new.professional_id is distinct from old.professional_id then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, 'rescheduled', v_actor, v_role,
            jsonb_build_object(
              'from', jsonb_build_object('date', old.booking_date, 'time', to_char(old.start_time, 'HH24:MI'), 'professional', old.professional_name),
              'to',   jsonb_build_object('date', new.booking_date, 'time', to_char(new.start_time, 'HH24:MI'), 'professional', new.professional_name)));
  end if;

  if new.reminder_sent_at is not null and old.reminder_sent_at is null then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role)
    values (new.id, new.business_id, 'reminder', v_actor, v_role);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_booking_event on bookings;
create trigger trg_log_booking_event
after insert or update on bookings
for each row execute function log_booking_event();


-- =====================================================================
-- PARTE 6 — Segurança (quem vê e altera clientes e histórico)
-- =====================================================================
alter table customers enable row level security;
alter table booking_events enable row level security;

-- Profissional: só clientes que já atendeu (ou tem agendado)
create or replace function can_see_customer(cid uuid, bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select sees_whole_agenda(bid)
      or (member_role_of(bid) = 'staff' and exists (
            select 1 from bookings b
            where b.customer_id = cid and b.professional_id = my_professional_id(bid)));
$$;

drop policy if exists "ve clientes" on customers;
drop policy if exists "cadastra clientes" on customers;
drop policy if exists "altera clientes" on customers;
drop policy if exists "exclui clientes" on customers;

create policy "ve clientes" on customers
  for select to authenticated using (can_see_customer(id, business_id));

create policy "cadastra clientes" on customers
  for insert to authenticated with check (member_role_of(business_id) in ('owner', 'reception'));

create policy "altera clientes" on customers
  for update to authenticated
  using (member_role_of(business_id) in ('owner', 'reception', 'staff') and can_see_customer(id, business_id))
  with check (member_role_of(business_id) in ('owner', 'reception', 'staff'));

create policy "exclui clientes" on customers
  for delete to authenticated using (member_role_of(business_id) = 'owner');

-- Histórico: visível para quem vê o agendamento; ninguém altera pela tela
drop policy if exists "ve historico" on booking_events;
create policy "ve historico" on booking_events
  for select to authenticated
  using (exists (
    select 1 from bookings b
    where b.id = booking_id
      and (sees_whole_agenda(b.business_id) or can_manage_booking(b.business_id, b.professional_id))
  ));


-- =====================================================================
-- PARTE 7 — Conferência
-- =====================================================================
select
  (select count(*) from customers)                                as clientes,
  (select count(*) from bookings where customer_id is not null)   as agendamentos_ligados,
  (select count(*) from bookings where customer_id is null)       as agendamentos_sem_cliente;
