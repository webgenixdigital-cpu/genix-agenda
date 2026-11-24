-- =====================================================================
-- 63 — Módulo Pet (banho e tosa): pets do cliente, leva e traz, motorista
-- Aditiva e reversível (bloco de reversão no fim).
--
-- JÁ APLICADA em 2026-11-23 pelo SQL Editor (este arquivo só registra o que
-- foi rodado). Não rodar de novo.
--
-- Decisões:
-- - Tutor = customers (nada de cadastro paralelo). Agendamento = bookings.
-- - Pet shop é NICHO dentro do segmento `outros` (enum business_segment
--   não muda). A tela só mostra o módulo quando o nicho do espaço é pet.
-- - Regra "sem área da saúde" (CLAUDE.md §4): health_notes,
--   vaccine_valid_until e flea_valid_until existem no banco mas NÃO aparecem
--   na interface nesta fase. Ficam sempre nulos.
-- - Motorista NÃO entra em business_members (is_business_member/
--   member_role_of continuam iguais). Tabela própria business_drivers e
--   acesso só pelas funções driver_my_routes / driver_update_route.
-- - Em customers e bookings só entram colunas novas opcionais.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- PARTE 1 — Limpeza das tabelas de rascunho (vazias, criadas no mesmo dia)
-- ---------------------------------------------------------------------
drop table if exists rotas_transporte, agendamentos, pets, tutores cascade;

-- ---------------------------------------------------------------------
-- PARTE 2 — Colunas novas (opcionais) em customers e bookings
-- ---------------------------------------------------------------------
alter table customers
  add column if not exists address       text,
  add column if not exists address_ref   text,
  add column if not exists lat           numeric(9,6),
  add column if not exists lng           numeric(9,6),
  add column if not exists alt_contact   text,
  add column if not exists allow_image   boolean not null default false;

alter table bookings
  add column if not exists transport     text not null default 'nenhum'
    check (transport in ('nenhum','busca','entrega','busca_entrega')),
  add column if not exists transport_fee numeric(10,2) not null default 0,
  add column if not exists checkin       jsonb;

-- ---------------------------------------------------------------------
-- PARTE 3 — Pets e vínculo agendamento ↔ pets
-- ---------------------------------------------------------------------
create table pets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  species text not null default 'cao' check (species in ('cao','gato','outro')),
  breed text,
  sex text check (sex in ('macho','femea')),
  birth_date date,
  size text check (size in ('mini','pequeno','medio','grande','gigante')),
  weight_kg numeric(5,2),
  coat_type text,
  coat_condition text,
  neutered boolean,
  behavior text[] not null default '{}',
  health_notes text,            -- fora da interface (regra sem saúde)
  vaccine_valid_until date,     -- fora da interface (regra sem saúde)
  flea_valid_until date,        -- fora da interface (regra sem saúde)
  photo_url text,
  fixed_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pets_customer_idx on pets (business_id, customer_id);

create trigger pets_updated_at before update on pets
  for each row execute function set_updated_at();

-- pet e tutor precisam ser do mesmo espaço
create function guard_pet_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from customers c
                 where c.id = new.customer_id and c.business_id = new.business_id) then
    raise exception 'Tutor não pertence a este negócio';
  end if;
  return new;
end $$;
create trigger pets_guard_customer before insert or update on pets
  for each row execute function guard_pet_customer();

create table booking_pets (
  booking_id uuid not null references bookings(id) on delete cascade,
  pet_id uuid not null references pets(id) on delete cascade,
  primary key (booking_id, pet_id)
);
create index booking_pets_pet_idx on booking_pets (pet_id);

-- ---------------------------------------------------------------------
-- PARTE 4 — Motoristas e rotas de leva e traz
-- ---------------------------------------------------------------------
create table business_drivers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table transport_routes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  driver_id uuid references business_drivers(id) on delete set null,
  kind text not null check (kind in ('busca','entrega')),
  window_start timestamptz,
  window_end timestamptz,
  stop_order int,
  status text not null default 'aguardando'
    check (status in ('aguardando','a_caminho','coletado','na_loja','saiu_entrega','entregue','cancelado')),
  photo_url text,
  notes text,
  updated_at timestamptz not null default now()
);
create index transport_routes_driver_idx on transport_routes (driver_id, window_start);

create trigger transport_routes_updated_at before update on transport_routes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- PARTE 5 — RLS (reaproveita can_see_customer, can_manage_booking etc.)
-- ---------------------------------------------------------------------
alter table pets enable row level security;
alter table booking_pets enable row level security;
alter table business_drivers enable row level security;
alter table transport_routes enable row level security;

create policy "ve pets" on pets for select
  using (can_see_customer(customer_id, business_id));
create policy "cadastra pets" on pets for insert
  with check (member_role_of(business_id) in ('owner','reception','staff'));
create policy "altera pets" on pets for update
  using (member_role_of(business_id) in ('owner','reception','staff')
         and can_see_customer(customer_id, business_id))
  with check (member_role_of(business_id) in ('owner','reception','staff'));
create policy "exclui pets" on pets for delete
  using (member_role_of(business_id) = 'owner');

create policy "ve pets do agendamento" on booking_pets for select
  using (exists (select 1 from bookings b where b.id = booking_id
          and (sees_whole_agenda(b.business_id) or can_manage_booking(b.business_id, b.professional_id))));
create policy "vincula pets" on booking_pets for insert
  with check (exists (select 1 from bookings b join pets p on p.id = pet_id
          where b.id = booking_id and p.business_id = b.business_id
          and can_manage_booking(b.business_id, b.professional_id)));
create policy "desvincula pets" on booking_pets for delete
  using (exists (select 1 from bookings b where b.id = booking_id
          and can_manage_booking(b.business_id, b.professional_id)));

create policy "dono gerencia motoristas" on business_drivers for all
  using (is_business_owner(business_id)) with check (is_business_owner(business_id));
create policy "ve motoristas" on business_drivers for select
  using (sees_whole_agenda(business_id) or user_id = auth.uid());

create policy "ve rotas" on transport_routes for select
  using (sees_whole_agenda(business_id)
         or driver_id in (select id from business_drivers where user_id = auth.uid() and active));
create policy "gerencia rotas" on transport_routes for all
  using (member_role_of(business_id) in ('owner','reception'))
  with check (member_role_of(business_id) in ('owner','reception'));

-- ---------------------------------------------------------------------
-- PARTE 6 — Funções do app do motorista + tempo real
-- ---------------------------------------------------------------------
create function driver_my_routes(p_date date default current_date)
returns table (route_id uuid, kind text, status text, stop_order int,
  window_start timestamptz, window_end timestamptz, booking_id uuid,
  customer_name text, customer_phone text, address text, address_ref text,
  lat numeric, lng numeric, pets text, notes text)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.status, r.stop_order, r.window_start, r.window_end, b.id,
         c.name, c.phone, c.address, c.address_ref, c.lat, c.lng,
         (select string_agg(p.name, ', ') from booking_pets bp join pets p on p.id = bp.pet_id
           where bp.booking_id = b.id),
         r.notes
  from transport_routes r
  join business_drivers d on d.id = r.driver_id and d.user_id = auth.uid() and d.active
  join bookings b on b.id = r.booking_id
  left join customers c on c.id = b.customer_id
  where b.booking_date = p_date
  order by r.stop_order nulls last, r.window_start;
$$;

create function driver_update_route(p_route uuid, p_status text, p_photo_url text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update transport_routes r
     set status = p_status, photo_url = coalesce(p_photo_url, r.photo_url)
   where r.id = p_route
     and exists (select 1 from business_drivers d
                 where d.id = r.driver_id and d.user_id = auth.uid() and d.active);
  if not found then raise exception 'Rota não encontrada ou sem permissão'; end if;
end $$;

revoke execute on function driver_my_routes(date), driver_update_route(uuid,text,text), guard_pet_customer() from public, anon;
grant execute on function driver_my_routes(date), driver_update_route(uuid,text,text) to authenticated;

alter publication supabase_realtime add table transport_routes;

commit;

-- =====================================================================
-- REVERSÃO (só com autorização; apaga pets, motoristas e rotas)
-- =====================================================================
-- begin;
-- alter publication supabase_realtime drop table transport_routes;
-- drop function if exists driver_update_route(uuid,text,text);
-- drop function if exists driver_my_routes(date);
-- drop table if exists transport_routes, business_drivers, booking_pets, pets cascade;
-- drop function if exists guard_pet_customer();
-- alter table bookings
--   drop column if exists checkin,
--   drop column if exists transport_fee,
--   drop column if exists transport;
-- alter table customers
--   drop column if exists allow_image,
--   drop column if exists alt_contact,
--   drop column if exists lng,
--   drop column if exists lat,
--   drop column if exists address_ref,
--   drop column if exists address;
-- commit;
