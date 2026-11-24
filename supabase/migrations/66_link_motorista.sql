-- =====================================================================
-- 66 — App do motorista por link simples (leva e traz, banho e tosa)
-- Aditiva e reversível (bloco de reversão no fim).
--
-- Decisão do dono (2026-11-23): o motorista entra por um LINK, sem senha.
-- Para reduzir o risco (endereços de clientes, LGPD):
-- - código longo e aleatório por motorista (48 caracteres), impossível de adivinhar,
--   guardado numa tabela fechada (driver_links) que a API não lê;
-- - a matriz gera um código novo ou desliga o link a qualquer momento;
-- - o link só mostra as paradas do DIA atribuídas a esse motorista, com o mínimo:
--   primeiro nome do tutor, WhatsApp, endereço, referência, pets e horário;
-- - o motorista só muda o status das próprias paradas, nos status do tipo da parada.
-- Nenhuma tabela, função ou política existente muda.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- PARTE 1 — Código do link (tabela própria, fechada para a API)
--   RLS ligado e SEM política: ninguém lê nem grava pela API, nem a equipe.
--   Só as funções abaixo (security definer) tocam nesta tabela.
-- ---------------------------------------------------------------------
create table driver_links (
  driver_id uuid primary key references business_drivers(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table driver_links enable row level security;
revoke all on driver_links from anon, authenticated;

-- ---------------------------------------------------------------------
-- PARTE 2 — Matriz: gerar código novo / desligar o link
-- ---------------------------------------------------------------------
create function driver_link_reset(p_driver uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select business_id into v_bid from business_drivers where id = p_driver;
  if v_bid is null then raise exception 'NAO_ENCONTRADO'; end if;
  if not is_business_owner(v_bid) then raise exception 'SEM_PERMISSAO'; end if;
  insert into driver_links (driver_id, token) values (p_driver, v_token)
  on conflict (driver_id) do update set token = excluded.token, created_at = now();
  return v_token;
end $$;

create function driver_link_revoke(p_driver uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bid uuid;
begin
  select business_id into v_bid from business_drivers where id = p_driver;
  if v_bid is null then raise exception 'NAO_ENCONTRADO'; end if;
  if not is_business_owner(v_bid) then raise exception 'SEM_PERMISSAO'; end if;
  delete from driver_links where driver_id = p_driver;
end $$;

-- a tela da matriz só precisa saber SE o link está ligado
create function driver_link_status(p_business uuid)
returns table (driver_id uuid, has_link boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, l.driver_id is not null, l.created_at
    from business_drivers d
    left join driver_links l on l.driver_id = d.id
   where d.business_id = p_business and is_business_owner(p_business);
$$;

-- ---------------------------------------------------------------------
-- PARTE 3 — Motorista (sem login): rota do dia e status
-- ---------------------------------------------------------------------
create function driver_link_routes(p_token text)
returns table (
  route_id uuid, kind text, status text, stop_order int,
  booking_date date, start_time time, end_time time,
  tutor_first_name text, tutor_phone text, tutor_phone_country text,
  address text, address_ref text, pet_name text,
  driver_name text, business_name text
)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.id, d.name, d.business_id, b.name as business_name,
           (now() at time zone coalesce(b.timezone, 'America/Sao_Paulo'))::date as today
      from driver_links l
      join business_drivers d on d.id = l.driver_id and d.active
      join businesses b on b.id = d.business_id
     where p_token is not null and length(p_token) = 48
       and l.token = p_token
  )
  select r.id, r.kind, r.status, r.stop_order,
         bk.booking_date, bk.start_time, bk.end_time,
         split_part(trim(bk.customer_name), ' ', 1), bk.customer_phone, bk.customer_phone_country,
         c.address, c.address_ref, p.name,
         d.name, d.business_name
    from d
    join transport_routes r on r.driver_id = d.id and r.business_id = d.business_id
    join bookings bk on bk.id = r.booking_id and bk.booking_date = d.today and bk.status in ('pending', 'confirmed', 'completed')
    left join customers c on c.id = bk.customer_id
    left join pets p on p.id = bk.pet_id
   order by r.stop_order nulls last, bk.start_time;
$$;

create function driver_link_update(p_token text, p_route uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
begin
  select r.kind into v_kind
    from transport_routes r
    join business_drivers d on d.id = r.driver_id and d.active
    join driver_links l on l.driver_id = d.id
   where r.id = p_route
     and p_token is not null and length(p_token) = 48
     and l.token = p_token;
  if v_kind is null then raise exception 'NAO_ENCONTRADO'; end if;

  if (v_kind = 'busca' and p_status not in ('a_caminho', 'coletado', 'na_loja'))
     or (v_kind = 'entrega' and p_status not in ('saiu_entrega', 'entregue')) then
    raise exception 'STATUS_INVALIDO';
  end if;

  update transport_routes set status = p_status where id = p_route;
end $$;

-- ---------------------------------------------------------------------
-- PARTE 4 — Permissões
-- ---------------------------------------------------------------------
revoke execute on function driver_link_reset(uuid), driver_link_revoke(uuid), driver_link_status(uuid),
  driver_link_routes(text), driver_link_update(text, uuid, text) from public;
revoke execute on function driver_link_reset(uuid), driver_link_revoke(uuid), driver_link_status(uuid) from anon;
grant execute on function driver_link_reset(uuid), driver_link_revoke(uuid), driver_link_status(uuid) to authenticated;
grant execute on function driver_link_routes(text), driver_link_update(text, uuid, text) to anon, authenticated;

commit;

-- =====================================================================
-- REVERSÃO (só com autorização; os links param de funcionar)
-- =====================================================================
-- begin;
-- drop function if exists driver_link_update(text, uuid, text);
-- drop function if exists driver_link_routes(text);
-- drop function if exists driver_link_status(uuid);
-- drop function if exists driver_link_revoke(uuid);
-- drop function if exists driver_link_reset(uuid);
-- drop table if exists driver_links;
-- commit;
