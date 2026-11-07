-- =====================================================================
-- GENIX AGENDA — N4.3 Plano fechado: pacote com VÁRIOS serviços
-- Ex.: "Mãos & Pés" = 4 manicures + 2 pedicures, preço fechado, validade.
-- Saldo controlado POR SERVIÇO e consumido POR ITEM do agendamento
-- (booking_items.customer_package_item_id): uma visita pode baixar
-- manicure (item 0) e pedicure (adicional do Editar) do mesmo pacote.
-- Pacotes de 1 serviço continuam iguais (viram pacote com 1 item).
--
-- ORDEM: supabase/manual/37a_backup.sql → ESTE ARQUIVO →
--        supabase/manual/37b_conferencia.sql (uma consulta por vez).
-- Rode inteira de uma vez, ANTES do merge (só acrescenta; o código atual
-- continua funcionando com ela). Tudo dentro de begin/commit: se qualquer
-- comando falhar, nada fica aplicado. Reversão comentada no final.
-- Datas fixas (venda com série) ficam para o PR B (migration 38).
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Serviços do modelo de pacote
-- package_templates.service_id/sessions continuam: pacote de 1 serviço
-- preenche os dois; com vários serviços, service_id = null e
-- sessions = total. A fonte da verdade passa a ser package_template_items.
-- =====================================================================
alter table package_templates alter column service_id drop not null;

create table if not exists package_template_items (
  template_id uuid not null references package_templates(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  sessions    int not null check (sessions between 1 and 100),
  position    smallint not null default 0,
  primary key (template_id, service_id)
);

create index if not exists idx_package_template_items_service on package_template_items (service_id);

-- leitura igual à dos modelos; gravação só por save_package_template (ou pelo gatilho da PARTE 5)
alter table package_template_items enable row level security;
drop policy if exists "membro ve servicos do modelo de pacote" on package_template_items;
create policy "membro ve servicos do modelo de pacote" on package_template_items
  for select to authenticated using (member_role_of(business_id) is not null);


-- =====================================================================
-- PARTE 2 — Serviços do pacote vendido (snapshot na venda)
-- value_total = parte do preço fechado que cabe a este serviço
-- (rateio pelo preço avulso × quantidade; centavos no último).
-- Valor de 1 sessão = value_total ÷ sessions_total.
-- =====================================================================
alter table customer_packages add column if not exists schedule_mode text not null default 'free';
alter table customer_packages drop constraint if exists customer_packages_schedule_mode_valid;
alter table customer_packages add constraint customer_packages_schedule_mode_valid
  check (schedule_mode in ('free', 'fixed'));

create table if not exists customer_package_items (
  id                  uuid primary key default gen_random_uuid(),
  customer_package_id uuid not null references customer_packages(id) on delete cascade,
  business_id         uuid not null references businesses(id) on delete cascade,
  service_id          uuid references services(id) on delete set null,
  service_name        text not null,
  sessions_total      int not null check (sessions_total between 1 and 100),
  value_total         numeric(10,2) not null default 0 check (value_total >= 0),
  position            smallint not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists idx_customer_package_items_package on customer_package_items (customer_package_id, position);
create index if not exists idx_customer_package_items_service on customer_package_items (service_id) where service_id is not null;

alter table customer_package_items enable row level security;
drop policy if exists "ve servicos do pacote vendido" on customer_package_items;
create policy "ve servicos do pacote vendido" on customer_package_items
  for select to authenticated
  using (exists (select 1 from customer_packages cp
                  where cp.id = customer_package_id and can_see_customer(cp.customer_id, cp.business_id)));

-- item do agendamento pago por um serviço do pacote
alter table booking_items add column if not exists customer_package_item_id uuid
  references customer_package_items(id) on delete restrict;
create index if not exists idx_booking_items_package_item on booking_items (customer_package_item_id)
  where customer_package_item_id is not null;


-- =====================================================================
-- PARTE 3 — Backfill: tudo o que existe vira pacote de 1 serviço
-- (antes dos gatilhos novos, para não reconferir saldo do passado)
-- =====================================================================
insert into package_template_items (template_id, service_id, business_id, sessions, position)
select t.id, t.service_id, t.business_id, t.sessions, 0
  from package_templates t
 where t.service_id is not null
   and not exists (select 1 from package_template_items i where i.template_id = t.id);

insert into customer_package_items (customer_package_id, business_id, service_id, service_name,
                                    sessions_total, value_total, position, created_at)
select cp.id, cp.business_id, cp.service_id, cp.service_name, cp.sessions_total, cp.price, 0, cp.created_at
  from customer_packages cp
 where not exists (select 1 from customer_package_items i where i.customer_package_id = cp.id);

-- item 0 das sessões de pacote já feitas aponta para o (único) serviço do pacote
update booking_items i
   set customer_package_item_id = pi.id,
       paid_by_package = true
  from bookings b
  join customer_package_items pi on pi.customer_package_id = b.customer_package_id
 where i.booking_id = b.id
   and i.position = 0
   and b.customer_package_id is not null
   and i.customer_package_item_id is null;


-- =====================================================================
-- PARTE 4 — Saldo calculado (nunca guardado em coluna)
-- Conta itens ligados ao serviço do pacote em agendamentos
-- pending/confirmed/completed (cancelado devolve, como antes).
-- =====================================================================
create or replace function package_item_used(p_item uuid, p_ignore_booking uuid default null)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int
    from booking_items i
    join bookings b on b.id = i.booking_id
   where i.customer_package_item_id = p_item
     and b.status in ('pending', 'confirmed', 'completed')
     and b.id is distinct from p_ignore_booking;
$$;

revoke all on function package_item_used(uuid, uuid) from public, anon, authenticated;

-- por serviço do pacote
create or replace view customer_package_item_balance as
select
  pi.id, pi.customer_package_id, cp.business_id, cp.customer_id, cp.name as package_name,
  pi.service_id, pi.service_name, pi.sessions_total, pi.value_total, pi.position,
  cp.expires_at, cp.sold_at,
  coalesce(u.used, 0)::int                                    as used,
  greatest(pi.sessions_total - coalesce(u.used, 0), 0)::int   as remaining,
  case
    when cp.status = 'cancelled' then 'cancelled'
    when cp.expires_at is not null and cp.expires_at < (now() at time zone 'America/Sao_Paulo')::date then 'expired'
    when coalesce(t.used, 0) >= cp.sessions_total then 'finished'
    else 'active'
  end                                                          as package_status
from customer_package_items pi
join customer_packages cp on cp.id = pi.customer_package_id
left join lateral (
  select count(*) as used
    from booking_items i join bookings b on b.id = i.booking_id
   where i.customer_package_item_id = pi.id and b.status in ('pending', 'confirmed', 'completed')
) u on true
left join lateral (
  select count(*) as used
    from booking_items i
    join customer_package_items x on x.id = i.customer_package_item_id
    join bookings b on b.id = i.booking_id
   where x.customer_package_id = cp.id and b.status in ('pending', 'confirmed', 'completed')
) t on true
where can_see_customer(cp.customer_id, cp.business_id);

grant select on customer_package_item_balance to authenticated;

-- por pacote: mesmas colunas de antes (sessions_total/used/remaining = somas)
create or replace view customer_package_balance as
select
  cp.id, cp.business_id, cp.customer_id, cp.template_id, cp.service_id, cp.service_name,
  cp.name, cp.sessions_total, cp.price, cp.sold_at, cp.expires_at, cp.status,
  coalesce(u.used, 0)::int                                    as used,
  greatest(cp.sessions_total - coalesce(u.used, 0), 0)::int   as remaining,
  case
    when cp.status = 'cancelled' then 'cancelled'
    when cp.expires_at is not null and cp.expires_at < (now() at time zone 'America/Sao_Paulo')::date then 'expired'
    when coalesce(u.used, 0) >= cp.sessions_total then 'finished'
    else 'active'
  end                                                          as effective_status
from customer_packages cp
left join lateral (
  select count(*) as used
    from booking_items i
    join customer_package_items x on x.id = i.customer_package_item_id
    join bookings b on b.id = i.booking_id
   where x.customer_package_id = cp.id and b.status in ('pending', 'confirmed', 'completed')
) u on true
where can_see_customer(cp.customer_id, cp.business_id);

grant select on customer_package_balance to authenticated;


-- =====================================================================
-- PARTE 5 — Modelos: criar / editar com vários serviços (só a matriz)
-- p_items = [{"service_id": "...", "sessions": 4}, ...] — 1 a 6 serviços
-- comuns, ativos e distintos; 1 a 100 sessões cada; até 100 no total.
-- Erros: SEM_PERMISSAO | PLANO_GRATIS | NOME_INVALIDO | QUANTIDADE_INVALIDA
--        SERVICOS_INVALIDOS | SESSOES_INVALIDAS | PRECO_INVALIDO | VALIDADE_INVALIDA | NAO_ENCONTRADO
-- =====================================================================
create or replace function save_package_template(
  p_business uuid, p_id uuid, p_name text, p_price numeric, p_validity_days int, p_items jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_n     int;
  v_found int;
  v_total int;
  v_min   int;
  v_max   int;
  v_one   uuid;
  v_id    uuid;
  v_prev  text := coalesce(current_setting('genix.package_edit', true), '');
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(p_business) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'NOME_INVALIDO'; end if;
  if p_price is null or p_price < 0 or p_price > 99999999 then raise exception 'PRECO_INVALIDO'; end if;
  if p_validity_days is not null and p_validity_days not between 1 and 730 then raise exception 'VALIDADE_INVALIDA'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'QUANTIDADE_INVALIDA'; end if;

  begin
    select count(*), count(distinct x.service_id), coalesce(sum(x.sessions), 0), min(x.sessions), max(x.sessions),
           min(x.service_id::text)::uuid
      into v_n, v_found, v_total, v_min, v_max, v_one
      from jsonb_to_recordset(p_items) as x(service_id uuid, sessions int);
  exception
    when others then raise exception 'QUANTIDADE_INVALIDA';
  end;
  if v_n < 1 or v_n > 6 or v_found <> v_n then raise exception 'QUANTIDADE_INVALIDA'; end if;
  if v_min is null or v_min < 1 or v_max > 100 or v_total > 100 then raise exception 'SESSOES_INVALIDAS'; end if;

  select count(*) into v_found
    from services s join jsonb_to_recordset(p_items) as x(service_id uuid, sessions int) on x.service_id = s.id
   where s.business_id = p_business and s.kind = 'servico' and s.active;
  if v_found <> v_n then raise exception 'SERVICOS_INVALIDOS'; end if;

  if v_n <> 1 then v_one := null; end if;

  perform set_config('genix.package_edit', '1', true);

  if p_id is null then
    insert into package_templates (business_id, service_id, name, sessions, price, validity_days, sort_order)
    values (p_business, v_one, v_name, v_total, round(p_price, 2), p_validity_days,
            coalesce((select max(sort_order) from package_templates where business_id = p_business), 0) + 1)
    returning id into v_id;
  else
    update package_templates
       set service_id = v_one, name = v_name, sessions = v_total,
           price = round(p_price, 2), validity_days = p_validity_days
     where id = p_id and business_id = p_business
    returning id into v_id;
    if v_id is null then raise exception 'NAO_ENCONTRADO'; end if;
    delete from package_template_items where template_id = v_id;
  end if;

  insert into package_template_items (template_id, service_id, business_id, sessions, position)
  select v_id, x.service_id, p_business, x.sessions, (t.ord - 1)::smallint
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    cross join lateral jsonb_to_record(t.e) as x(service_id uuid, sessions int);

  perform set_config('genix.package_edit', v_prev, true);
  return v_id;
end;
$$;

revoke all on function save_package_template(uuid, uuid, text, numeric, int, jsonb) from public, anon;
grant execute on function save_package_template(uuid, uuid, text, numeric, int, jsonb) to authenticated;

-- Compatibilidade: o código anterior grava service_id + sessions direto na
-- tabela. Fora de save_package_template, isso vira o item único do modelo.
create or replace function sync_package_template_items()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('genix.package_edit', true), '') = '1' or new.service_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.service_id is not distinct from old.service_id
     and new.sessions is not distinct from old.sessions then
    return new;
  end if;
  delete from package_template_items where template_id = new.id;
  insert into package_template_items (template_id, service_id, business_id, sessions, position)
  values (new.id, new.service_id, new.business_id, new.sessions, 0);
  return new;
end;
$$;

drop trigger if exists trg_sync_package_template_items on package_templates;
create trigger trg_sync_package_template_items
after insert or update of service_id, sessions on package_templates
for each row execute function sync_package_template_items();

-- serviço do modelo é sempre serviço comum (combo em pacote: não)
create or replace function guard_package_template_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from services where id = new.service_id and business_id = new.business_id and kind = 'servico') then
    raise exception 'SERVICOS_INVALIDOS';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_package_template_item on package_template_items;
create trigger trg_guard_package_template_item
before insert or update on package_template_items
for each row execute function guard_package_template_item();


-- =====================================================================
-- PARTE 6 — Vender pacote (pacote + serviços + caixa numa transação)
-- Mesma assinatura da 19. Rateio do preço fechado pelo preço avulso ×
-- quantidade (sem preço avulso: pelas sessões); centavos no último.
-- =====================================================================
create or replace function sell_package(p_customer uuid, p_template uuid, p_method text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  t       package_templates;
  c       customers;
  v_cash  uuid;
  v_id    uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n     int;
  v_total int;
  v_wsum  numeric;
  v_names text;
  v_i     int := 0;
  v_acc   numeric := 0;
  v_val   numeric;
  r       record;
begin
  select * into t from package_templates where id = p_template;
  if not found or not t.active then raise exception 'MODELO_INVALIDO'; end if;
  if coalesce(member_role_of(t.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(t.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;

  select * into c from customers where id = p_customer and business_id = t.business_id;
  if not found then raise exception 'CLIENTE_INVALIDO'; end if;

  select count(*), coalesce(sum(i.sessions), 0), coalesce(sum(s.price * i.sessions), 0),
         string_agg(s.name, ' + ' order by i.position, s.name)
    into v_n, v_total, v_wsum, v_names
    from package_template_items i join services s on s.id = i.service_id
   where i.template_id = t.id;
  if v_n = 0 or v_total < 1 or v_total > 100 then raise exception 'MODELO_INVALIDO'; end if;

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
                                 sessions_total, price, expires_at, cash_entry_id, created_by, schedule_mode)
  values (t.business_id, c.id, t.id, case when v_n = 1 then t.service_id end, v_names, t.name,
          v_total, t.price,
          case when t.validity_days is null then null else v_today + t.validity_days end,
          v_cash, auth.uid(), 'free')
  returning id into v_id;

  for r in
    select s.id, s.name, s.price, i.sessions
      from package_template_items i join services s on s.id = i.service_id
     where i.template_id = t.id
     order by i.position, s.name
  loop
    v_i := v_i + 1;
    v_val := case
               when v_i = v_n    then t.price - v_acc
               when v_wsum > 0   then round(t.price * r.price * r.sessions / v_wsum, 2)
               else round(t.price * r.sessions / v_total, 2)
             end;
    v_val := greatest(v_val, 0);
    v_acc := v_acc + v_val;
    insert into customer_package_items (customer_package_id, business_id, service_id, service_name,
                                        sessions_total, value_total, position)
    values (v_id, t.business_id, r.id, r.name, r.sessions, v_val, (v_i - 1)::smallint);
  end loop;

  return v_id;
end;
$$;

-- (mantém as permissões da 19)


-- =====================================================================
-- PARTE 7 — Cancelar pacote; p_cancel_future cancela junto os
-- agendamentos FUTUROS (pending/confirmed) cujo serviço principal é do
-- pacote. Adicional do pacote dentro de outra visita fica como está.
-- Não estorna o caixa (estorno é manual). Devolve quantos cancelou.
-- =====================================================================
drop function if exists cancel_customer_package(uuid);

create or replace function cancel_customer_package(p_package uuid, p_cancel_future boolean default false)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  cp      customer_packages;
  v_now   timestamp;
  v_count int := 0;
begin
  select * into cp from customer_packages where id = p_package for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if coalesce(member_role_of(cp.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;

  if p_cancel_future then
    select now() at time zone timezone into v_now from businesses where id = cp.business_id;
    update bookings b
       set status = 'cancelled'
     where b.customer_package_id = p_package
       and b.status in ('pending', 'confirmed')
       and (b.booking_date + b.start_time) > v_now;
    get diagnostics v_count = row_count;
  end if;

  update customer_packages set status = 'cancelled' where id = p_package;
  return v_count;
end;
$$;

revoke all on function cancel_customer_package(uuid, boolean) from public, anon;
grant execute on function cancel_customer_package(uuid, boolean) to authenticated;


-- =====================================================================
-- PARTE 8 — Validação no agendamento (substitui a da 19)
-- Pacote do serviço principal: mesmo espaço e cliente, ativo, dentro da
-- validade e com esse serviço. O SALDO de cada serviço é conferido no
-- item (PARTE 9); aqui só quando um cancelado volta a valer.
-- No UPDATE, só quando muda pacote, data, serviço ou cliente, ou quando
-- o status volta de cancelado. Concluir ou cancelar NUNCA é bloqueado.
-- =====================================================================
create or replace function validate_booking_package()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cp       customer_packages;
  r        record;
  v_reopen boolean := false;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_reopen := old.status = 'cancelled' and new.status in ('pending', 'confirmed');
  end if;

  if tg_op = 'UPDATE' and not (
       new.customer_package_id is distinct from old.customer_package_id
    or new.booking_date        is distinct from old.booking_date
    or new.service_id          is distinct from old.service_id
    or new.customer_id         is distinct from old.customer_id
    or v_reopen
  ) then
    return new;
  end if;

  if new.customer_package_id is not null then
    -- trava o pacote para dois agendamentos simultâneos não estourarem o saldo
    select * into cp from customer_packages where id = new.customer_package_id for update;
    if not found
       or cp.business_id <> new.business_id
       or cp.customer_id is distinct from new.customer_id
       or cp.status <> 'active'
       or not exists (select 1 from customer_package_items pi
                       where pi.customer_package_id = cp.id and pi.service_id = new.service_id) then
      raise exception 'PACOTE_INVALIDO';
    end if;
    if cp.expires_at is not null and new.booking_date > cp.expires_at then
      raise exception 'PACOTE_VENCIDO';
    end if;
  end if;

  -- itens já ligados a pacotes (remarcar, trocar cliente, reabrir)
  if tg_op = 'UPDATE' then
    for r in
      select pi.id, pi.sessions_total, count(*)::int as n,
             p.id as package_id, p.business_id, p.customer_id, p.status, p.expires_at
        from booking_items i
        join customer_package_items pi on pi.id = i.customer_package_item_id
        join customer_packages p on p.id = pi.customer_package_id
       where i.booking_id = new.id
       group by pi.id, pi.sessions_total, p.id, p.business_id, p.customer_id, p.status, p.expires_at
    loop
      perform 1 from customer_packages where id = r.package_id for update;
      if r.customer_id is distinct from new.customer_id or r.status <> 'active' then
        raise exception 'PACOTE_INVALIDO';
      end if;
      if r.expires_at is not null and new.booking_date > r.expires_at then
        raise exception 'PACOTE_VENCIDO';
      end if;
      if v_reopen and package_item_used(r.id, new.id) + r.n > r.sessions_total then
        raise exception 'PACOTE_SEM_SALDO';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- (trg_validate_package da 19 continua apontando para esta função)


-- =====================================================================
-- PARTE 9 — Validação no item: serviço do pacote, cliente, validade e
-- SALDO do serviço. Ligar o item marca paid_by_package.
-- =====================================================================
create or replace function validate_booking_item_package()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pi customer_package_items;
  cp customer_packages;
  bk bookings;
begin
  if new.customer_package_item_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.customer_package_item_id is not distinct from old.customer_package_item_id then
    return new;
  end if;

  select * into pi from customer_package_items where id = new.customer_package_item_id;
  if not found then raise exception 'PACOTE_INVALIDO'; end if;
  select * into cp from customer_packages where id = pi.customer_package_id for update;
  select * into bk from bookings where id = new.booking_id;

  if cp.business_id <> new.business_id
     or cp.customer_id is distinct from bk.customer_id
     or pi.service_id is distinct from new.service_id
     or new.combo_group is not null
     or cp.status <> 'active' then
    raise exception 'PACOTE_INVALIDO';
  end if;

  if bk.status <> 'cancelled' then
    if cp.expires_at is not null and bk.booking_date > cp.expires_at then
      raise exception 'PACOTE_VENCIDO';
    end if;
    if (select count(*) from booking_items i
          join bookings b on b.id = i.booking_id
         where i.customer_package_item_id = pi.id
           and b.status in ('pending', 'confirmed', 'completed')
           and i.id <> new.id) >= pi.sessions_total then
      raise exception 'PACOTE_SEM_SALDO';
    end if;
  end if;

  new.paid_by_package := true;
  return new;
end;
$$;

drop trigger if exists trg_validate_item_package on booking_items;
create trigger trg_validate_item_package
before insert or update of customer_package_item_id on booking_items
for each row execute function validate_booking_item_package();


-- =====================================================================
-- PARTE 10 — Item 0 do agendamento novo (versão da 32 + pacote)
-- Com pacote: o item 0 liga ao serviço do pacote igual ao do agendamento.
-- =====================================================================
create or replace function create_booking_first_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text;
  v_pi   uuid;
begin
  if new.customer_package_id is not null then
    select id into v_pi from customer_package_items
     where customer_package_id = new.customer_package_id and service_id = new.service_id
     order by position limit 1;
    if v_pi is null then raise exception 'PACOTE_INVALIDO'; end if;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from booking_items where booking_id = new.id) then return new; end if;
    select kind into v_kind from services where id = new.service_id;

    if v_kind = 'combo' then
      if new.customer_package_id is not null then raise exception 'PACOTE_INVALIDO'; end if;
      if access_tier(new.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
      if not professional_does_service(new.professional_id, new.service_id) then
        raise exception 'PROFISSIONAL_NAO_FAZ';
      end if;
      perform add_service_items(new.id, new.service_id, 0, true, false, new.price, new.created_at);
      perform recalc_booking(new.id);
    else
      insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                                 position, extends_time, paid_by_package, added_by, created_at,
                                 customer_package_item_id)
      values (new.id, new.business_id, new.service_id, new.service_name, new.price, new.duration_min,
              0, true, new.customer_package_id is not null, auth.uid(), new.created_at,
              v_pi)
      on conflict (booking_id, position) do nothing;
    end if;
  elsif new.customer_package_id is distinct from old.customer_package_id then
    update booking_items
       set customer_package_item_id = v_pi,
           paid_by_package = v_pi is not null
     where booking_id = new.id and position = 0;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- PARTE 11 — Editar: adicional pago pelo pacote (versão da 32 + pacote)
-- p_package_item = serviço do pacote da cliente a usar (null = cobra).
-- Saldo, validade e cliente conferidos no item (PARTE 9).
-- Erros extras: PACOTE_INVALIDO | PACOTE_VENCIDO | PACOTE_SEM_SALDO
-- =====================================================================
drop function if exists booking_add_item(uuid, uuid, boolean);

create or replace function booking_add_item(
  p_booking uuid, p_service uuid, p_extend boolean default true, p_package_item uuid default null
)
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
  if s.kind = 'combo' and access_tier(bk.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if not professional_does_service(bk.professional_id, s.id) then raise exception 'PROFISSIONAL_NAO_FAZ'; end if;

  -- 37_plano_fechado: o serviço do pacote precisa ser este serviço
  if p_package_item is not null and (
       s.kind = 'combo'
       or not exists (select 1 from customer_package_items where id = p_package_item and service_id = s.id)
     ) then
    raise exception 'PACOTE_INVALIDO';
  end if;

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

  if p_package_item is not null then
    insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                               position, extends_time, paid_by_package, added_by, customer_package_item_id)
    values (bk.id, bk.business_id, s.id, s.name, s.price, s.duration_min,
            v_pos, p_extend, true, auth.uid(), p_package_item);
  else
    perform add_service_items(bk.id, s.id, v_pos, p_extend, false, s.price);
  end if;

  begin
    perform recalc_booking(bk.id);
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'item_added', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('service', s.name, 'price', s.price, 'duration', s.duration_min, 'extended', p_extend,
                             'combo', s.kind = 'combo', 'package', p_package_item is not null));

  return json_build_object('ok', true);
end;
$$;

revoke all on function booking_add_item(uuid, uuid, boolean, uuid) from public, anon;
grant execute on function booking_add_item(uuid, uuid, boolean, uuid) to authenticated;


-- =====================================================================
-- PARTE 12 — Dados do "Editar" (versão da 32 + pacote)
-- items[].package_item_id e package_options = serviços de pacotes ativos
-- da cliente com saldo e validade na data do agendamento.
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
               'paid_by_package', i.paid_by_package, 'combo_group', i.combo_group, 'combo_name', i.combo_name,
               'package_item_id', i.customer_package_item_id)
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
         and professional_does_service(bk.professional_id, s.id)), '[]'::json),
    'package_options', coalesce((
      select json_agg(json_build_object('id', pi.id, 'service_id', pi.service_id, 'package_name', cp.name,
                                        'remaining', pi.sessions_total - package_item_used(pi.id))
                      order by cp.sold_at, pi.position)
        from customer_package_items pi
        join customer_packages cp on cp.id = pi.customer_package_id
       where bk.customer_id is not null
         and cp.customer_id = bk.customer_id
         and cp.business_id = bk.business_id
         and cp.status = 'active'
         and (cp.expires_at is null or cp.expires_at >= bk.booking_date)
         and pi.service_id is not null
         and package_item_used(pi.id) < pi.sessions_total), '[]'::json)
  );
end;
$$;


-- =====================================================================
-- PARTE 13 — "Pacote 3/10" na agenda, agora por serviço
-- Mesmas colunas de antes + label ("Mãos & Pés · Manicure 2/4 · Pedicure 1/2").
-- session_no/sessions_total = serviço do item 0 (ou o primeiro ligado).
-- =====================================================================
drop function if exists booking_package_info(uuid, uuid[]);

create or replace function booking_package_info(p_business uuid, p_bookings uuid[])
returns table (booking_id uuid, session_no int, sessions_total int, package_name text, label text)
language sql stable security definer set search_path = public
as $$
  with mine as (
    select i.customer_package_item_id as item
      from booking_items i
     where i.booking_id = any(p_bookings) and i.customer_package_item_id is not null
  ),
  numbered as (
    select i.booking_id, i.position, pi.id as item, pi.service_name, pi.sessions_total,
           cp.name, (select count(*) from customer_package_items x where x.customer_package_id = cp.id) as n_services,
           (row_number() over (partition by i.customer_package_item_id
                               order by b.booking_date, b.start_time, i.position))::int as n,
           b.professional_id
      from booking_items i
      join bookings b on b.id = i.booking_id
      join customer_package_items pi on pi.id = i.customer_package_item_id
      join customer_packages cp on cp.id = pi.customer_package_id
     where b.business_id = p_business
       and b.status in ('pending', 'confirmed', 'completed')
       and i.customer_package_item_id in (select item from mine)
  )
  select distinct on (nb.booking_id)
         nb.booking_id, nb.n, nb.sessions_total, nb.name,
         (select string_agg(case when y.n_services > 1 then y.service_name || ' ' else 'Pacote ' end
                            || y.n || '/' || y.sessions_total, ' · ' order by y.position)
            from numbered y where y.booking_id = nb.booking_id)
    from numbered nb
   where nb.booking_id = any(p_bookings)
     and (sees_whole_agenda(p_business) or nb.professional_id = my_professional_id(p_business))
   order by nb.booking_id, nb.position;
$$;

revoke all on function booking_package_info(uuid, uuid[]) from public, anon;
grant execute on function booking_package_info(uuid, uuid[]) to authenticated;


-- =====================================================================
-- PARTE 14 — Recorrência com pacote de vários serviços (versão da 20)
-- Muda só: o pacote precisa TER o serviço da série, e o saldo/validade
-- que cabem são os desse serviço.
-- =====================================================================
create or replace function series_package_fit(p_package uuid, p_service uuid, p_frequency text, p_start date, p_count int)
returns int
language sql stable security definer set search_path = public
as $$
  select least(
    greatest(pi.sessions_total - package_item_used(pi.id), 0)::int,
    (select count(*) from series_dates(p_frequency, p_start, p_count) d
      where cp.expires_at is null or d.occurs_on <= cp.expires_at)::int
  )
  from customer_packages cp
  join customer_package_items pi on pi.customer_package_id = cp.id and pi.service_id = p_service
  where cp.id = p_package
  order by pi.position
  limit 1;
$$;

revoke all on function series_package_fit(uuid, uuid, text, date, int) from public, anon, authenticated;
drop function if exists series_package_fit(uuid, text, date, int);

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
    if not found or cp.business_id <> p_business or cp.status <> 'active'
       or not exists (select 1 from customer_package_items pi where pi.customer_package_id = cp.id and pi.service_id = p_service)
       or not exists (select 1 from customers c where c.id = cp.customer_id and c.phone = normalize_phone(p_phone)) then
      raise exception 'PACOTE_INVALIDO';
    end if;
  end if;
end;
$$;

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

-- (preview/create/check mantêm as permissões da 20)


-- =====================================================================
-- PARTE 15 — Valor de uma sessão = value_total ÷ sessões do serviço
-- customer_summary (versão da 31) e billing_monthly (versão da 24)
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
      coalesce(pk.units, 0) + greatest(b.price - coalesce(pk.amount, 0), 0)
    ) filter (where b.status = 'completed'), 0), 2)
  from bookings b
  left join lateral (
    select sum(i.price) filter (where i.paid_by_package)                      as amount,
           sum(pi.value_total / pi.sessions_total) filter (where pi.id is not null) as units
      from booking_items i
      left join customer_package_items pi on pi.id = i.customer_package_item_id
     where i.booking_id = b.id
  ) pk on true
  where b.business_id = bid and b.customer_id is not null
  group by b.customer_id;
$$;

create or replace function billing_monthly(p_business uuid, p_from date, p_to date)
returns table (month text, kind text, category text, method text, amount numeric, partner_amount numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_partner boolean;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  select coalesce(f.partner_salon, false) into v_partner from business_fiscal f where f.business_id = p_business;
  v_partner := coalesce(v_partner, false);

  return query
  select to_char(c.entry_date, 'YYYY-MM'), c.kind::text, c.category::text, c.method::text,
         sum(c.amount)::numeric,
         sum(case
               when c.kind = 'income' and bk.id is not null then
                 round(c.amount * coalesce(bk.partner_pct,
                                           case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2)
               else 0
             end)::numeric
    from cash_entries c
    left join bookings bk on bk.id = c.booking_id
    left join professionals p on p.id = bk.professional_id
   where c.business_id = p_business
     and c.entry_date between p_from and p_to
   group by 1, 2, 3, 4

  union all

  -- 37_plano_fechado: uma linha por serviço do pacote usado na visita
  select to_char(bk.booking_date, 'YYYY-MM'), 'repasse_pacote', 'pacote', null::text,
         0::numeric,
         sum(round(pi.value_total / pi.sessions_total
                   * coalesce(bk.partner_pct,
                              case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2))::numeric
    from bookings bk
    join booking_items i on i.booking_id = bk.id
    join customer_package_items pi on pi.id = i.customer_package_item_id
    left join professionals p on p.id = bk.professional_id
   where bk.business_id = p_business
     and bk.status = 'completed'
     and bk.booking_date between p_from and p_to
   group by 1
  having sum(round(pi.value_total / pi.sessions_total
                   * coalesce(bk.partner_pct,
                              case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2)) > 0;
end;
$$;

revoke all on function guard_package_template_item()       from public, anon, authenticated;
revoke all on function sync_package_template_items()       from public, anon, authenticated;
revoke all on function validate_booking_item_package()     from public, anon, authenticated;

commit;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- 1) Restaure as funções antigas, colando e rodando:
--    - sell_package, validate_booking_package, booking_package_info: PARTES 6, 8 e 9 de 19_pacotes.sql
--      (antes: drop function if exists booking_package_info(uuid, uuid[]);)
--    - view customer_package_balance: PARTE 5 de 19_pacotes.sql
--    - check_series_input, preview_booking_series, create_booking_series e
--      series_package_fit(uuid, text, date, int): PARTES 4 a 7 de 20_recorrencia.sql
--    - billing_monthly: PARTE 5 de 24_faturamento.sql
--    - customer_summary: PARTE 13 de 31_editar_agendamento.sql
--    - create_booking_first_item, booking_edit_info: PARTES 5 e 9 de 32_combos.sql
--    - booking_add_item: drop function if exists booking_add_item(uuid, uuid, boolean, uuid);
--      e PARTE 7 de 32_combos.sql + grant execute ... (uuid, uuid, boolean) to authenticated;
--    - cancel_customer_package: drop function if exists cancel_customer_package(uuid, boolean);
--      e PARTE 7 de 19_pacotes.sql (com o revoke/grant de lá)
-- 2) Depois:
-- drop function if exists series_package_fit(uuid, uuid, text, date, int);
-- drop function if exists save_package_template(uuid, uuid, text, numeric, int, jsonb);
-- drop trigger  if exists trg_validate_item_package on booking_items;
-- drop trigger  if exists trg_guard_package_template_item on package_template_items;
-- drop trigger  if exists trg_sync_package_template_items on package_templates;
-- drop function if exists validate_booking_item_package();
-- drop function if exists guard_package_template_item();
-- drop function if exists sync_package_template_items();
-- drop view     if exists customer_package_item_balance;
-- drop function if exists package_item_used(uuid, uuid);
-- drop index    if exists idx_booking_items_package_item;
-- alter table booking_items drop column if exists customer_package_item_id;
-- drop table    if exists customer_package_items;
-- drop table    if exists package_template_items;
-- alter table customer_packages drop constraint if exists customer_packages_schedule_mode_valid;
-- alter table customer_packages drop column if exists schedule_mode;
-- (package_templates.service_id volta a ser not null só se nenhum modelo de vários serviços
--  tiver sido criado: alter table package_templates alter column service_id set not null;)
-- Pacotes de vários serviços vendidos depois desta migration não têm como voltar ao formato
-- antigo (1 serviço): cancele-os antes de reverter.
-- =====================================================================
