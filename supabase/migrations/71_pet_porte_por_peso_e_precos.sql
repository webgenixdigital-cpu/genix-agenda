-- =====================================================================
-- 71 — Pet: porte pelo peso + preço do serviço por porte × pelagem
--
-- PARTE 1 — Porte pelo peso (mesmos valores de pets.size, sem mudar o check):
--   mini até 4 kg · pequeno 4,1–9 · medio 9,1–16 · grande 16,1–25 · gigante > 25
--   pet_size_from_weight(peso). Gatilho em pets: preenche o porte quando ele
--   está vazio, ou quando o peso muda e o porte NÃO foi mudado na mesma
--   gravação (escolha manual sempre vence). Reclassifica os pets com peso.
-- PARTE 2 — pet_coat_key(texto): lê a pelagem salva (texto da tela) como
--   curta|media|longa|crespa|dupla; outras (“Dura”, “Sem pelo”) = null.
--   Não altera dados salvos.
-- PARTE 3 — service_pet_prices: preço (e duração opcional) por serviço +
--   porte + pelagem (coat_key null = qualquer pelagem). Sem linha = preço e
--   duração do serviço, como sempre. RLS igual a services.
--   get_pet_service_price(serviço, pet): porte+pelagem > porte > base.
--
-- Só afeta o nicho pet (tabela pets e a tabela nova); demais nichos não mudam.
-- JÁ APLICADA em produção em 26/11/2026 (via MCP), com o ajuste do gatilho
-- abaixo. Rodar de novo é seguro (create or replace / if not exists).
-- Reversão no fim.
-- =====================================================================

-- PARTE 1 ------------------------------------------------------------
create or replace function public.pet_size_from_weight(w numeric)
returns text language sql immutable as $$
  select case
    when w is null or w <= 0 then null
    when w <= 4  then 'mini'
    when w <= 9  then 'pequeno'
    when w <= 16 then 'medio'
    when w <= 25 then 'grande'
    else 'gigante'
  end
$$;

create or replace function public.trg_pets_size_from_weight()
returns trigger language plpgsql as $$
begin
  if new.weight_kg is not null and new.weight_kg > 0 and (
       new.size is null
       or (tg_op = 'UPDATE'
           and new.weight_kg is distinct from old.weight_kg
           and new.size is not distinct from old.size)) then
    new.size := public.pet_size_from_weight(new.weight_kg);
  end if;
  return new;
end $$;

drop trigger if exists pets_size_from_weight on public.pets;
create trigger pets_size_from_weight
before insert or update of weight_kg, size on public.pets
for each row execute function public.trg_pets_size_from_weight();

update public.pets
set size = public.pet_size_from_weight(weight_kg)
where weight_kg > 0
  and size is distinct from public.pet_size_from_weight(weight_kg);

-- PARTE 2 ------------------------------------------------------------
create or replace function public.pet_coat_key(c text)
returns text language sql immutable as $$
  select case
    when c is null or btrim(c) = '' then null
    when lower(c) ~ '(dupla|subpelo)'       then 'dupla'
    when lower(c) ~ '(cresp|encarac|enrol)' then 'crespa'
    when lower(c) ~ 'long'                  then 'longa'
    when lower(c) ~ '(m[eé]dia|media)'      then 'media'
    when lower(c) ~ '(curt|rasa)'           then 'curta'
    else null
  end
$$;

-- PARTE 3 ------------------------------------------------------------
create table if not exists public.service_pet_prices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  size text not null check (size in ('mini','pequeno','medio','grande','gigante')),
  coat_key text check (coat_key in ('curta','media','longa','crespa','dupla')),
  price numeric(10,2) not null check (price >= 0),
  duration_min smallint check (duration_min > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists service_pet_prices_uniq
  on public.service_pet_prices (service_id, size, coalesce(coat_key, '*'));
create index if not exists service_pet_prices_business_idx on public.service_pet_prices (business_id);

alter table public.service_pet_prices enable row level security;
drop policy if exists "matriz insere" on public.service_pet_prices;
drop policy if exists "matriz altera" on public.service_pet_prices;
drop policy if exists "matriz exclui" on public.service_pet_prices;
drop policy if exists "membro le" on public.service_pet_prices;
drop policy if exists "public le precos" on public.service_pet_prices;
create policy "matriz insere" on public.service_pet_prices for insert to authenticated with check (is_business_owner(business_id));
create policy "matriz altera" on public.service_pet_prices for update to authenticated using (is_business_owner(business_id)) with check (is_business_owner(business_id));
create policy "matriz exclui" on public.service_pet_prices for delete to authenticated using (is_business_owner(business_id));
create policy "membro le" on public.service_pet_prices for select to authenticated using (is_business_member(business_id));
create policy "public le precos" on public.service_pet_prices for select to public using (is_business_published(business_id) or is_business_member(business_id));

create or replace function public.trg_service_pet_prices_check()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.services s where s.id = new.service_id and s.business_id = new.business_id) then
    raise exception 'service_pet_prices: serviço não pertence a este negócio';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists service_pet_prices_check on public.service_pet_prices;
create trigger service_pet_prices_check before insert or update on public.service_pet_prices
for each row execute function public.trg_service_pet_prices_check();

create or replace function public.get_pet_service_price(p_service_id uuid, p_pet_id uuid)
returns table(price numeric, duration_min smallint, source text)
language sql stable security invoker as $$
  with s as (select id, price, duration_min from public.services where id = p_service_id),
       p as (select size, public.pet_coat_key(coat_type) ck from public.pets where id = p_pet_id),
       m as (
         select spp.price, spp.duration_min,
                case when spp.coat_key is not null then 1 else 2 end prio
         from public.service_pet_prices spp, p
         where spp.service_id = p_service_id and spp.size = p.size
           and (spp.coat_key = p.ck or spp.coat_key is null)
         order by prio limit 1)
  select coalesce(m.price, s.price),
         coalesce(m.duration_min, s.duration_min),
         case when m.prio = 1 then 'porte_pelagem' when m.prio = 2 then 'porte' else 'base' end
  from s left join m on true
$$;

-- =====================================================================
-- REVERSÃO (não roda junto):
-- drop function if exists public.get_pet_service_price(uuid, uuid);
-- drop table if exists public.service_pet_prices;
-- drop function if exists public.trg_service_pet_prices_check();
-- drop function if exists public.pet_coat_key(text);
-- drop trigger if exists pets_size_from_weight on public.pets;
-- drop function if exists public.trg_pets_size_from_weight();
-- drop function if exists public.pet_size_from_weight(numeric);
-- (o porte reclassificado de 1 pet — 10 kg, pequeno → medio — não volta sozinho)
-- =====================================================================
