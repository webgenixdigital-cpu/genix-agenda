-- =====================================================================
-- 64 — Atendimento por pet (nicho "Banho e tosa")
-- Aditiva e reversível (bloco de reversão no fim).
--
-- Decisão (2026-11-23): no banho e tosa quem é atendido é o PET.
-- - Tutor continua sendo o cliente (customers): WhatsApp, lembretes e
--   cobrança seguem para ele. Um tutor pode ter vários pets (pets).
-- - Cada agendamento é de 1 pet (bookings.pet_id). Vários pets do mesmo
--   tutor no mesmo horário = um agendamento por pet (encaixe sobreposto).
-- - Pacote é vendido para o pet (customer_packages.pet_id); quem paga é o tutor.
-- - Combos não mudam: entram no agendamento e herdam o pet dele.
-- - Colunas novas são opcionais: beleza/estética continuam com pet_id nulo.
-- - booking_pets (63, vazia) sai; driver_my_routes passa a usar bookings.pet_id.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- PARTE 1 — Colunas novas (opcionais)
-- ---------------------------------------------------------------------
alter table bookings
  add column if not exists pet_id uuid references pets(id) on delete set null;
create index if not exists bookings_pet_idx on bookings (pet_id) where pet_id is not null;

alter table customer_packages
  add column if not exists pet_id uuid references pets(id) on delete set null;
create index if not exists customer_packages_pet_idx on customer_packages (pet_id) where pet_id is not null;

-- ---------------------------------------------------------------------
-- PARTE 2 — Coerência: o pet é do mesmo espaço e do mesmo tutor
--   Nome com "zz" para rodar DEPOIS de trg_link_booking_customer
--   (gatilhos BEFORE rodam em ordem alfabética), quando customer_id já
--   foi preenchido pelo telefone.
-- ---------------------------------------------------------------------
create function guard_booking_pet() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pet pets%rowtype;
  v_pkg_pet uuid;
begin
  if new.pet_id is null then return new; end if;

  select * into v_pet from pets where id = new.pet_id;
  if v_pet.id is null or v_pet.business_id <> new.business_id then
    raise exception 'Pet não pertence a este espaço';
  end if;
  if new.customer_id is not null and v_pet.customer_id <> new.customer_id then
    raise exception 'Este pet é de outro tutor';
  end if;

  -- agendamento por pacote: o pacote precisa ser do mesmo pet (se tiver pet)
  if new.customer_package_id is not null then
    select pet_id into v_pkg_pet from customer_packages where id = new.customer_package_id;
    if v_pkg_pet is not null and v_pkg_pet <> new.pet_id then
      raise exception 'Este pacote é de outro pet';
    end if;
  end if;
  return new;
end $$;

create trigger trg_zz_guard_booking_pet before insert or update of pet_id, customer_id, customer_package_id
  on bookings for each row execute function guard_booking_pet();

create function guard_package_pet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pet_id is null then return new; end if;
  if not exists (select 1 from pets p
                 where p.id = new.pet_id and p.business_id = new.business_id
                   and p.customer_id = new.customer_id) then
    raise exception 'Pet não pertence a este tutor';
  end if;
  return new;
end $$;

create trigger trg_zz_guard_package_pet before insert or update of pet_id, customer_id
  on customer_packages for each row execute function guard_package_pet();

revoke execute on function guard_booking_pet(), guard_package_pet() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- PARTE 3 — Rotas do motorista usam o pet do agendamento
-- ---------------------------------------------------------------------
create or replace function driver_my_routes(p_date date default current_date)
returns table (route_id uuid, kind text, status text, stop_order int,
  window_start timestamptz, window_end timestamptz, booking_id uuid,
  customer_name text, customer_phone text, address text, address_ref text,
  lat numeric, lng numeric, pets text, notes text)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.status, r.stop_order, r.window_start, r.window_end, b.id,
         c.name, c.phone, c.address, c.address_ref, c.lat, c.lng,
         p.name,
         r.notes
  from transport_routes r
  join business_drivers d on d.id = r.driver_id and d.user_id = auth.uid() and d.active
  join bookings b on b.id = r.booking_id
  left join customers c on c.id = b.customer_id
  left join pets p on p.id = b.pet_id
  where b.booking_date = p_date
  order by r.stop_order nulls last, r.window_start;
$$;

-- ---------------------------------------------------------------------
-- PARTE 4 — Remove booking_pets (63), substituída por bookings.pet_id
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from booking_pets) then
    raise exception 'booking_pets tem dados: migrar para bookings.pet_id antes';
  end if;
end $$;
drop table booking_pets;

commit;

-- =====================================================================
-- REVERSÃO (só com autorização)
-- =====================================================================
-- begin;
-- create table booking_pets (
--   booking_id uuid not null references bookings(id) on delete cascade,
--   pet_id uuid not null references pets(id) on delete cascade,
--   primary key (booking_id, pet_id)
-- );
-- alter table booking_pets enable row level security;
-- -- (recriar as 3 políticas de booking_pets da 63, PARTE 5)
-- -- (recriar driver_my_routes da 63, PARTE 6)
-- drop trigger if exists trg_zz_guard_package_pet on customer_packages;
-- drop trigger if exists trg_zz_guard_booking_pet on bookings;
-- drop function if exists guard_package_pet();
-- drop function if exists guard_booking_pet();
-- alter table customer_packages drop column if exists pet_id;
-- alter table bookings drop column if exists pet_id;
-- commit;
