-- =====================================================================
-- GENIX AGENDA — N4.1 Pacotes de sessões
-- Pacote = N sessões de UM serviço, vendido no painel (matriz/recepção),
-- 1 lançamento no caixa na venda; sessões concluídas não lançam de novo.
-- ATENÇÃO: rode a PARTE 1 SOZINHA primeiro. Depois rode da PARTE 2 ao fim.
-- Aditiva. Reversão comentada no final do arquivo.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Categoria "pacote" no caixa — RODE SOZINHA
-- =====================================================================
alter type cash_category add value if not exists 'pacote';


-- =====================================================================
-- PARTE 2 — Modelos de pacote (cadastrados pela matriz)
-- =====================================================================
create table if not exists package_templates (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  service_id    uuid not null references services(id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 80),
  sessions      int not null check (sessions between 1 and 100),
  price         numeric(10,2) not null check (price >= 0),
  validity_days int check (validity_days is null or validity_days between 1 and 730),
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_package_templates_business on package_templates (business_id, sort_order);

drop trigger if exists trg_package_templates_updated on package_templates;
create trigger trg_package_templates_updated before update on package_templates
for each row execute function set_updated_at();


-- =====================================================================
-- PARTE 3 — Pacotes vendidos (snapshot do modelo no momento da venda)
-- =====================================================================
create table if not exists customer_packages (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete restrict,
  template_id    uuid references package_templates(id) on delete set null,
  service_id     uuid references services(id) on delete set null,
  service_name   text not null,
  name           text not null,
  sessions_total int not null check (sessions_total between 1 and 100),
  price          numeric(10,2) not null check (price >= 0),
  sold_at        timestamptz not null default now(),
  expires_at     date,                       -- null = sem validade
  -- guarda só active | cancelled; finished/expired são calculados (view abaixo)
  status         text not null default 'active' check (status in ('active', 'finished', 'expired', 'cancelled')),
  cash_entry_id  uuid references cash_entries(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_customer_packages_customer on customer_packages (business_id, customer_id);

alter table bookings add column if not exists customer_package_id uuid
  references customer_packages(id) on delete restrict;

create index if not exists idx_bookings_package on bookings (customer_package_id)
  where customer_package_id is not null;


-- =====================================================================
-- PARTE 4 — RLS
-- =====================================================================
alter table package_templates enable row level security;
alter table customer_packages enable row level security;

drop policy if exists "membro ve modelos de pacote" on package_templates;
drop policy if exists "matriz cria modelos de pacote" on package_templates;
drop policy if exists "matriz altera modelos de pacote" on package_templates;
drop policy if exists "matriz exclui modelos de pacote" on package_templates;

create policy "membro ve modelos de pacote" on package_templates
  for select to authenticated using (member_role_of(business_id) is not null);

create policy "matriz cria modelos de pacote" on package_templates
  for insert to authenticated
  with check (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');

create policy "matriz altera modelos de pacote" on package_templates
  for update to authenticated
  using (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');

create policy "matriz exclui modelos de pacote" on package_templates
  for delete to authenticated
  using (member_role_of(business_id) = 'owner' and access_tier(business_id) = 'completo');

-- Pacotes vendidos: só leitura direta. Venda e cancelamento passam pelas funções abaixo.
drop policy if exists "ve pacotes de clientes" on customer_packages;
create policy "ve pacotes de clientes" on customer_packages
  for select to authenticated
  using (can_see_customer(customer_id, business_id));


-- =====================================================================
-- PARTE 5 — Saldo calculado (nunca guardado em coluna)
-- A view roda com o dono (enxerga todos os agendamentos do pacote, para o
-- saldo ser o mesmo para todos os papéis) e filtra quem pode ver o cliente.
-- =====================================================================
create or replace view customer_package_balance as
select
  cp.id, cp.business_id, cp.customer_id, cp.template_id, cp.service_id, cp.service_name,
  cp.name, cp.sessions_total, cp.price, cp.sold_at, cp.expires_at, cp.status,
  coalesce(u.used, 0)::int                         as used,
  greatest(cp.sessions_total - coalesce(u.used, 0), 0)::int as remaining,
  case
    when cp.status = 'cancelled' then 'cancelled'
    when cp.expires_at is not null and cp.expires_at < (now() at time zone 'America/Sao_Paulo')::date then 'expired'
    when coalesce(u.used, 0) >= cp.sessions_total then 'finished'
    else 'active'
  end                                              as effective_status
from customer_packages cp
left join lateral (
  select count(*) as used
  from bookings b
  where b.customer_package_id = cp.id
    and b.status in ('pending', 'confirmed', 'completed')
) u on true
where can_see_customer(cp.customer_id, cp.business_id);

grant select on customer_package_balance to authenticated;


-- =====================================================================
-- PARTE 6 — Vender pacote (pacote + caixa numa transação só)
-- =====================================================================
create or replace function sell_package(p_customer uuid, p_template uuid, p_method text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  t      package_templates;
  c      customers;
  v_cash uuid;
  v_id   uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from package_templates where id = p_template;
  if not found or not t.active then raise exception 'MODELO_INVALIDO'; end if;
  if coalesce(member_role_of(t.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(t.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;

  select * into c from customers where id = p_customer and business_id = t.business_id;
  if not found then raise exception 'CLIENTE_INVALIDO'; end if;

  if t.price > 0 then
    if p_method is null or p_method not in ('pix', 'dinheiro', 'credito', 'debito') then
      raise exception 'FORMA_INVALIDA';
    end if;
    insert into cash_entries (business_id, kind, category, method, description, amount, entry_date, created_by)
    values (t.business_id, 'income', 'pacote', p_method::payment_method,
            'Pacote ' || t.name || ' — ' || c.name, t.price, v_today, auth.uid())
    returning id into v_cash;
  end if;

  insert into customer_packages (business_id, customer_id, template_id, service_id, service_name, name,
                                 sessions_total, price, expires_at, cash_entry_id, created_by)
  select t.business_id, c.id, t.id, t.service_id, s.name, t.name, t.sessions, t.price,
         case when t.validity_days is null then null else v_today + t.validity_days end,
         v_cash, auth.uid()
  from services s where s.id = t.service_id
  returning id into v_id;

  if v_id is null then raise exception 'MODELO_INVALIDO'; end if;
  return v_id;
end;
$$;

revoke all on function sell_package(uuid, uuid, text) from public, anon;
grant execute on function sell_package(uuid, uuid, text) to authenticated;


-- =====================================================================
-- PARTE 7 — Cancelar pacote (não estorna o caixa; estorno é manual)
-- =====================================================================
create or replace function cancel_customer_package(p_package uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  cp customer_packages;
begin
  select * into cp from customer_packages where id = p_package;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if coalesce(member_role_of(cp.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  update customer_packages set status = 'cancelled' where id = p_package;
end;
$$;

revoke all on function cancel_customer_package(uuid) from public, anon;
grant execute on function cancel_customer_package(uuid) to authenticated;


-- =====================================================================
-- PARTE 8 — Validação: só usa pacote válido do mesmo cliente e serviço
-- Valida no INSERT com pacote; no UPDATE só quando muda pacote, data,
-- serviço ou cliente, ou quando o status volta de cancelado para ativo.
-- Concluir ou cancelar NUNCA é bloqueado.
-- O nome ordena depois de trg_link_booking_customer (customer_id já ligado).
-- =====================================================================
create or replace function validate_booking_package()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cp     customer_packages;
  v_used int;
begin
  if new.customer_package_id is null or new.status = 'cancelled' then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (
       new.customer_package_id is distinct from old.customer_package_id
    or new.booking_date        is distinct from old.booking_date
    or new.service_id          is distinct from old.service_id
    or new.customer_id         is distinct from old.customer_id
    or (old.status = 'cancelled' and new.status in ('pending', 'confirmed'))
  ) then
    return new;
  end if;

  -- trava o pacote para dois agendamentos simultâneos não estourarem o saldo
  select * into cp from customer_packages where id = new.customer_package_id for update;
  if not found
     or cp.business_id <> new.business_id
     or cp.customer_id is distinct from new.customer_id
     or cp.service_id  is distinct from new.service_id
     or cp.status <> 'active' then
    raise exception 'PACOTE_INVALIDO';
  end if;

  if cp.expires_at is not null and new.booking_date > cp.expires_at then
    raise exception 'PACOTE_VENCIDO';
  end if;

  select count(*) into v_used from bookings
  where customer_package_id = cp.id
    and status in ('pending', 'confirmed', 'completed')
    and id <> new.id;
  if v_used >= cp.sessions_total then raise exception 'PACOTE_SEM_SALDO'; end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_package on bookings;
create trigger trg_validate_package
before insert or update on bookings
for each row execute function validate_booking_package();


-- =====================================================================
-- PARTE 9 — Número da sessão ("Pacote 3/10") para a agenda
-- =====================================================================
create or replace function booking_package_info(p_business uuid, p_bookings uuid[])
returns table (booking_id uuid, session_no int, sessions_total int, package_name text)
language sql stable security definer set search_path = public
as $$
  with numbered as (
    select b.id, b.professional_id, cp.sessions_total, cp.name,
           (row_number() over (partition by b.customer_package_id
                               order by b.booking_date, b.start_time))::int as n
    from bookings b
    join customer_packages cp on cp.id = b.customer_package_id
    where b.business_id = p_business
      and b.status in ('pending', 'confirmed', 'completed')
      and b.customer_package_id in (select customer_package_id from bookings where id = any(p_bookings))
  )
  select id, n, sessions_total, name from numbered
  where id = any(p_bookings)
    and (sees_whole_agenda(p_business) or professional_id = my_professional_id(p_business));
$$;

revoke all on function booking_package_info(uuid, uuid[]) from public, anon;
grant execute on function booking_package_info(uuid, uuid[]) to authenticated;


-- =====================================================================
-- PARTE 10 — complete_booking: sessão de pacote não lança no caixa
-- (cópia exata da versão da 10_papeis_equipe.sql + "customer_package_id is null")
-- =====================================================================
create or replace function complete_booking(p_booking uuid, p_method text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk bookings;
  v_cash boolean := false;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if p_method is not null and p_method not in ('pix', 'dinheiro', 'credito', 'debito') then
    raise exception 'FORMA_INVALIDA';
  end if;

  update bookings set status = 'completed' where id = p_booking;

  -- lança no caixa só no Completo, com forma de pagamento e valor > 0 (1 vez por atendimento)
  -- sessão de pacote não lança: o valor entrou no caixa na venda do pacote
  if p_method is not null and bk.price > 0 and access_tier(bk.business_id) = 'completo'
     and bk.customer_package_id is null then
    insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
    values (bk.business_id, bk.id, 'income', 'atendimento', p_method::payment_method,
            bk.service_name || ' — ' || bk.customer_name, bk.price, bk.booking_date, auth.uid())
    on conflict (booking_id) where booking_id is not null do nothing;
    v_cash := found;
  end if;

  return json_build_object('ok', true, 'cash', v_cash);
end;
$$;

revoke all on function complete_booking(uuid, text) from public, anon;
grant execute on function complete_booking(uuid, text) to authenticated;


-- =====================================================================
-- PARTE 11 — customer_summary: sessão de pacote conta pelo valor proporcional
-- (preço do pacote ÷ sessões). Atendimento avulso continua pelo price.
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
      case when cp.id is not null then cp.price / cp.sessions_total else b.price end
    ) filter (where b.status = 'completed'), 0), 2)
  from bookings b
  left join customer_packages cp on cp.id = b.customer_package_id
  where b.business_id = bid and b.customer_id is not null
  group by b.customer_id;
$$;

grant execute on function customer_summary(uuid) to authenticated;


-- =====================================================================
-- PARTE 12 — Conferência
-- =====================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('package_templates', 'customer_packages')
order by tablename, cmd;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- 1) Antes, restaure complete_booking com o texto da PARTE 8 de 10_papeis_equipe.sql
--    e customer_summary com o texto de 15_resumo_clientes.sql.
-- 2) Depois:
-- drop function if exists booking_package_info(uuid, uuid[]);
-- drop trigger if exists trg_validate_package on bookings;
-- drop function if exists validate_booking_package();
-- drop function if exists cancel_customer_package(uuid);
-- drop function if exists sell_package(uuid, uuid, text);
-- drop view if exists customer_package_balance;
-- drop index if exists idx_bookings_package;
-- alter table bookings drop column if exists customer_package_id;
-- drop table if exists customer_packages;
-- drop table if exists package_templates;
-- (o valor 'pacote' de cash_category não pode ser removido no Postgres; fica sem uso.
--  Lançamentos 'pacote' já feitos continuam no caixa.)
-- =====================================================================
