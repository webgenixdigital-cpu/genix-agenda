-- =====================================================================
-- GENIX AGENDA — 68: pagamento parcial e dividido
-- Antes: o “Registrar pagamento” dava baixa total com qualquer valor
-- (fatura de R$ 250 + pagamento de R$ 80 = paga) e o caixa aceitava só
-- 1 lançamento por atendimento (índice cash_entries_one_per_booking, 07).
-- Agora: cada parte do pagamento = 1 lançamento ligado ao atendimento ou
-- ao pacote; a fatura só fica paga quando o saldo zera. O Concluir e o
-- Registrar aceitam dividir (ex.: R$ 80 no débito + R$ 170 no crédito).
--
--   PARTE 1  colunas (amount_paid, cash_entries.customer_package_id) e índice
--   PARTE 2  apoio: booking_charge, payment_parts_total
--   PARTE 3  travas do payment_status/amount_paid (49) + amount_paid
--   PARTE 4  gatilhos do caixa: recusa passar do cobrado (VALOR_ACIMA_DO_SALDO)
--            e recalcula pago/pendente; vínculo do lançamento da venda do pacote
--   PARTE 5  dados existentes (backfill)
--   PARTE 6  complete_booking (cópia da 49) + p_payments + trava de conclusão em dobro
--   PARTE 7  register_booking_payment (partes) + versão antiga como embrulho
--   PARTE 8  register_package_payment (partes) + versão antiga como embrulho
--   PARTE 9  reopen_booking (cópia da 49): desfaz todas as partes
--   PARTE 10 pending_payments: saldo, total e pago
--   PARTE 11 payment_balance (só leitura, para o diálogo)
--   PARTE 12 goals_with_progress (cópia da 58): ticket médio por atendimento
--   PARTE 13 billing_monthly (cópia da 59b): salão-parceiro arredondado no total
--
-- payment_status continua igual (49): null = como sempre; 'pending' = falta
-- pagar (tudo ou parte); 'paid' = quitado depois. amount_paid = soma das
-- entradas ligadas (vale para leitura quando payment_status não é null).
--
-- Rode inteira de uma vez, ANTES do merge: o código atual continua
-- funcionando (complete_booking(id, forma) e as versões antigas do
-- registrar seguem aceitas). Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Colunas e índice
-- =====================================================================
alter table bookings add column if not exists amount_paid numeric(10,2) not null default 0;
alter table customer_packages add column if not exists amount_paid numeric(10,2) not null default 0;

alter table cash_entries add column if not exists customer_package_id uuid
  references customer_packages(id) on delete set null;
create index if not exists idx_cash_entries_package on cash_entries (customer_package_id)
  where customer_package_id is not null;

-- várias partes por atendimento: sai o índice único da 07, entra um comum
drop index if exists cash_entries_one_per_booking;
create index if not exists idx_cash_entries_booking on cash_entries (booking_id)
  where booking_id is not null;


-- =====================================================================
-- PARTE 2 — Apoio
-- =====================================================================
-- Valor a cobrar do atendimento: total − itens pagos pelo pacote (sem itens = regra antiga)
create or replace function booking_charge(p_booking uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select greatest(b.price - coalesce(
           (select sum(i.price) from booking_items i where i.booking_id = b.id and i.paid_by_package),
           case when b.customer_package_id is not null then b.price else 0 end), 0)
    from bookings b
   where b.id = p_booking;
$$;
revoke all on function booking_charge(uuid) from public, anon, authenticated;

-- Confere a lista de partes [{method, amount}] (1 a 4) e devolve a soma.
-- Erros: DADOS_INVALIDOS | FORMA_INVALIDA | VALOR_INVALIDO
create or replace function payment_parts_total(p_payments jsonb)
returns numeric
language plpgsql immutable set search_path = public
as $$
declare
  e   jsonb;
  v   numeric;
  tot numeric := 0;
begin
  if p_payments is null or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) < 1 or jsonb_array_length(p_payments) > 4 then
    raise exception 'DADOS_INVALIDOS';
  end if;
  for e in select x from jsonb_array_elements(p_payments) x loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'method', '') not in ('pix', 'dinheiro', 'credito', 'debito') then
      raise exception 'FORMA_INVALIDA';
    end if;
    begin
      v := (e->>'amount')::numeric;
    exception when others then
      raise exception 'VALOR_INVALIDO';
    end;
    if v is null or v <= 0 or v > 99999999 or v <> round(v, 2) then raise exception 'VALOR_INVALIDO'; end if;
    tot := tot + v;
  end loop;
  return tot;
end;
$$;
revoke all on function payment_parts_total(jsonb) from public, anon, authenticated;


-- =====================================================================
-- PARTE 3 — Travas (cópia da 49 PARTE 2 + amount_paid)
-- payment_status e amount_paid só mudam pelas funções/gatilhos (sinal
-- genix.payment_edit). Sair de 'completed' (reabrir) limpa os dois.
-- =====================================================================
create or replace function guard_booking_payment_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    new.payment_status := null;
    new.amount_paid := 0;
    return new;
  end if;
  if auth.uid() is null or coalesce(current_setting('genix.payment_edit', true), '') = '1' then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.payment_status is not null or new.amount_paid <> 0))
     or (tg_op = 'UPDATE' and (new.payment_status is distinct from old.payment_status
                               or new.amount_paid is distinct from old.amount_paid)) then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;

create or replace function guard_package_payment_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(current_setting('genix.payment_edit', true), '') = '1' then
    return new;
  end if;
  if (tg_op = 'INSERT' and (new.payment_status is not null or new.amount_paid <> 0))
     or (tg_op = 'UPDATE' and (new.payment_status is distinct from old.payment_status
                               or new.amount_paid is distinct from old.amount_paid)) then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;
-- (os gatilhos da 49 continuam apontando para estas funções)


-- =====================================================================
-- PARTE 4 — Gatilhos do caixa
-- =====================================================================

-- 4a) Recalcula o pago e a situação de um atendimento / pacote.
-- payment_status null (como sempre) não muda; 'pending'/'paid' seguem o saldo.
create or replace function payment_sync_booking(p_booking uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  v_paid  numeric;
  v_st    text;
  v_flag  text := coalesce(current_setting('genix.payment_edit', true), '');
begin
  if p_booking is null then return; end if;
  select * into bk from bookings where id = p_booking for update;
  if not found then return; end if;
  select coalesce(sum(amount), 0) into v_paid
    from cash_entries where booking_id = p_booking and kind = 'income';
  v_st := case
            when bk.status <> 'completed' or bk.payment_status is null then bk.payment_status
            when v_paid >= booking_charge(bk.id) then 'paid'
            else 'pending'
          end;
  if v_paid is distinct from bk.amount_paid or v_st is distinct from bk.payment_status then
    perform set_config('genix.payment_edit', '1', true);
    update bookings set amount_paid = v_paid, payment_status = v_st where id = p_booking;
    perform set_config('genix.payment_edit', v_flag, true);
  end if;
end;
$$;
revoke all on function payment_sync_booking(uuid) from public, anon, authenticated;

create or replace function payment_sync_package(p_package uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  cp      customer_packages;
  v_paid  numeric;
  v_st    text;
  v_flag  text := coalesce(current_setting('genix.payment_edit', true), '');
begin
  if p_package is null then return; end if;
  select * into cp from customer_packages where id = p_package for update;
  if not found then return; end if;
  select coalesce(sum(amount), 0) into v_paid
    from cash_entries where customer_package_id = p_package and kind = 'income';
  v_st := case
            when cp.payment_status is null then null
            when v_paid >= cp.price then 'paid'
            else 'pending'
          end;
  if v_paid is distinct from cp.amount_paid or v_st is distinct from cp.payment_status then
    perform set_config('genix.payment_edit', '1', true);
    update customer_packages set amount_paid = v_paid, payment_status = v_st where id = p_package;
    perform set_config('genix.payment_edit', v_flag, true);
  end if;
end;
$$;
revoke all on function payment_sync_package(uuid) from public, anon, authenticated;

-- 4b) ANTES de gravar: entrada ligada a atendimento/pacote não pode passar do cobrado.
-- Vale para as funções e para lançamento/edição direto no Caixa. Trava a linha do
-- atendimento/pacote (for update): duas gravações ao mesmo tempo não passam juntas.
create or replace function cash_entry_check_balance()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_other  numeric;
  v_charge numeric;
  v_price  numeric;
begin
  if new.kind <> 'income' then return new; end if;
  if tg_op = 'UPDATE'
     and new.amount = old.amount and new.kind = old.kind
     and new.booking_id is not distinct from old.booking_id
     and new.customer_package_id is not distinct from old.customer_package_id then
    return new;   -- só descrição/forma/data: o saldo não muda
  end if;

  if new.booking_id is not null then
    perform 1 from bookings where id = new.booking_id for update;
    if found then
      v_charge := booking_charge(new.booking_id);
      select coalesce(sum(amount), 0) into v_other
        from cash_entries
       where booking_id = new.booking_id and kind = 'income' and id <> new.id;
      if v_other + new.amount > v_charge then raise exception 'VALOR_ACIMA_DO_SALDO'; end if;
    end if;
  end if;

  if new.customer_package_id is not null then
    select price into v_price from customer_packages where id = new.customer_package_id for update;
    if found then
      select coalesce(sum(amount), 0) into v_other
        from cash_entries
       where customer_package_id = new.customer_package_id and kind = 'income' and id <> new.id;
      if v_other + new.amount > v_price then raise exception 'VALOR_ACIMA_DO_SALDO'; end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_entry_check_balance on cash_entries;
create trigger trg_cash_entry_check_balance
before insert or update on cash_entries
for each row execute function cash_entry_check_balance();

-- 4c) DEPOIS de gravar/excluir: recalcula (excluir uma parte reabre a pendência)
create or replace function cash_entry_sync_payment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform payment_sync_booking(old.booking_id);
    perform payment_sync_package(old.customer_package_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT' or new.booking_id is distinct from old.booking_id then
      perform payment_sync_booking(new.booking_id);
    end if;
    if tg_op = 'INSERT' or new.customer_package_id is distinct from old.customer_package_id then
      perform payment_sync_package(new.customer_package_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_cash_entry_sync_payment on cash_entries;
create trigger trg_cash_entry_sync_payment
after insert or update or delete on cash_entries
for each row execute function cash_entry_sync_payment();

-- 4d) Venda de pacote paga na hora (sell_package_core, sem mudança): o lançamento
-- nasce antes do pacote; quando o pacote aponta para ele, ganha o vínculo.
create or replace function customer_package_link_cash()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.cash_entry_id is not null
     and (tg_op = 'INSERT' or new.cash_entry_id is distinct from old.cash_entry_id) then
    update cash_entries set customer_package_id = new.id
     where id = new.cash_entry_id and customer_package_id is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_customer_package_link_cash on customer_packages;
create trigger trg_customer_package_link_cash
after insert or update of cash_entry_id on customer_packages
for each row execute function customer_package_link_cash();


-- =====================================================================
-- PARTE 5 — Dados existentes
-- Só quem tem payment_status (49) ganha amount_paid; o resto segue 0 e
-- não é lido. Lançamentos de venda de pacote ganham o vínculo.
-- =====================================================================
do $$
begin
  perform set_config('genix.payment_edit', '1', true);

  update cash_entries ce set customer_package_id = cp.id
    from customer_packages cp
   where cp.cash_entry_id = ce.id and ce.customer_package_id is null;

  update bookings b set amount_paid = s.paid
    from (select booking_id, sum(amount) as paid from cash_entries
           where booking_id is not null and kind = 'income' group by booking_id) s
   where s.booking_id = b.id and b.payment_status is not null and b.amount_paid <> s.paid;

  update customer_packages cp set amount_paid = s.paid
    from (select customer_package_id, sum(amount) as paid from cash_entries
           where customer_package_id is not null and kind = 'income' group by customer_package_id) s
   where s.customer_package_id = cp.id and cp.payment_status is not null and cp.amount_paid <> s.paid;

  perform set_config('genix.payment_edit', '', true);
end;
$$;


-- =====================================================================
-- PARTE 6 — complete_booking (cópia da 49 PARTE 3) + partes
-- Novo:
--   • já concluído → JA_CONCLUIDO (antes o índice único segurava o clique duplo)
--   • p_payments [{method, amount}]: um lançamento por parte, na data do
--     atendimento; soma acima do cobrado → VALOR_ACIMA_DO_SALDO; abaixo →
--     fica Pagamento pendente com o saldo
-- A versão de 2 parâmetros sai (a de 3 atende a chamada antiga).
-- =====================================================================
drop function if exists complete_booking(uuid, text);

create or replace function complete_booking(p_booking uuid, p_method text default null, p_payments jsonb default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk       bookings;
  v_cash   boolean := false;
  v_charge numeric;
  v_later  boolean := false;
  v_total  numeric;
  v_id     uuid;
  e        jsonb;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status = 'completed' then raise exception 'JA_CONCLUIDO'; end if;
  if p_method is not null and p_method not in ('pix', 'dinheiro', 'credito', 'debito', 'pendente') then
    raise exception 'FORMA_INVALIDA';
  end if;
  if p_payments is not null and p_method is not null then raise exception 'DADOS_INVALIDOS'; end if;

  update bookings set status = 'completed' where id = p_booking;

  v_charge := booking_charge(bk.id);

  -- 49: "Escolher depois" — sem lançamento, fica Pagamento pendente
  if p_method = 'pendente' then
    if v_charge > 0 and access_tier(bk.business_id) = 'completo' then
      perform set_config('genix.payment_edit', '1', true);
      update bookings set payment_status = 'pending' where id = bk.id;
      perform set_config('genix.payment_edit', '', true);
      v_later := true;
    end if;
    return json_build_object('ok', true, 'cash', false, 'pending', v_later);
  end if;

  -- 68: pagamento dividido (uma ou mais formas; pode ser parcial)
  if p_payments is not null then
    if v_charge <= 0 or access_tier(bk.business_id) <> 'completo' then raise exception 'DADOS_INVALIDOS'; end if;
    v_total := payment_parts_total(p_payments);
    if v_total > v_charge then raise exception 'VALOR_ACIMA_DO_SALDO'; end if;
    if v_total < v_charge then
      perform set_config('genix.payment_edit', '1', true);
      update bookings set payment_status = 'pending' where id = bk.id;
      perform set_config('genix.payment_edit', '', true);
      v_later := true;
    end if;
    for e in select x from jsonb_array_elements(p_payments) x loop
      insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
      values (bk.business_id, bk.id, 'income', 'atendimento', (e->>'method')::payment_method,
              bk.service_name || ' — ' || bk.customer_name, (e->>'amount')::numeric, bk.booking_date, auth.uid())
      returning id into v_id;
      insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
      values (bk.id, bk.business_id, 'payment_registered', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
              jsonb_build_object('amount', (e->>'amount')::numeric, 'method', e->>'method', 'entry_date', bk.booking_date,
                                 'cash_entry_id', v_id, 'source', 'conclusao'));
    end loop;
    return json_build_object('ok', true, 'cash', true, 'pending', v_later, 'remaining', v_charge - v_total);
  end if;

  -- uma forma, valor cheio (como sempre): só no plano pago, com valor > 0
  if p_method is not null and v_charge > 0 and access_tier(bk.business_id) = 'completo' then
    insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
    values (bk.business_id, bk.id, 'income', 'atendimento', p_method::payment_method,
            bk.service_name || ' — ' || bk.customer_name, v_charge, bk.booking_date, auth.uid());
    v_cash := true;
  end if;

  return json_build_object('ok', true, 'cash', v_cash, 'pending', false);
end;
$$;

revoke all on function complete_booking(uuid, text, jsonb) from public, anon;
grant execute on function complete_booking(uuid, text, jsonb) to authenticated;


-- =====================================================================
-- PARTE 7 — Registrar pagamento de atendimento pendente, em partes
-- Quem: can_manage_booking (como na 49). Soma das partes ≤ saldo.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | PLANO_GRATIS | NAO_PENDENTE |
--        DADOS_INVALIDOS | FORMA_INVALIDA | VALOR_INVALIDO | DATA_INVALIDA |
--        VALOR_ACIMA_DO_SALDO
-- =====================================================================
create or replace function register_booking_payment(p_booking uuid, p_payments jsonb, p_date date)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  v_today date;
  v_total numeric;
  v_rem   numeric;
  v_id    uuid;
  e       jsonb;
begin
  -- trava a linha ANTES de calcular o saldo (duas gravações ao mesmo tempo esperam)
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(bk.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if bk.status <> 'completed' or bk.payment_status is distinct from 'pending' then raise exception 'NAO_PENDENTE'; end if;
  v_total := payment_parts_total(p_payments);
  select (now() at time zone coalesce(timezone, 'America/Sao_Paulo'))::date into v_today from businesses where id = bk.business_id;
  if p_date is null or p_date > v_today or p_date < v_today - 3650 then raise exception 'DATA_INVALIDA'; end if;

  select booking_charge(bk.id) - coalesce(sum(amount), 0) into v_rem
    from cash_entries where booking_id = bk.id and kind = 'income';
  if v_total > v_rem then raise exception 'VALOR_ACIMA_DO_SALDO'; end if;

  for e in select x from jsonb_array_elements(p_payments) x loop
    insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
    values (bk.business_id, bk.id, 'income', 'atendimento', (e->>'method')::payment_method,
            bk.service_name || ' — ' || bk.customer_name, (e->>'amount')::numeric, p_date, auth.uid())
    returning id into v_id;
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (bk.id, bk.business_id, 'payment_registered', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
            jsonb_build_object('amount', (e->>'amount')::numeric, 'method', e->>'method', 'entry_date', p_date,
                               'cash_entry_id', v_id, 'source', 'registro'));
  end loop;
  -- pago/pendente: gatilho do caixa (PARTE 4c)

  return json_build_object('ok', true, 'remaining', v_rem - v_total, 'paid', booking_charge(bk.id) - (v_rem - v_total));
end;
$$;

revoke all on function register_booking_payment(uuid, jsonb, date) from public, anon;
grant execute on function register_booking_payment(uuid, jsonb, date) to authenticated;

-- versão antiga (forma + valor): agora é uma parte só (pode ser parcial)
create or replace function register_booking_payment(p_booking uuid, p_method text, p_amount numeric, p_date date)
returns json
language sql volatile security definer set search_path = public
as $$
  select register_booking_payment(p_booking, jsonb_build_array(jsonb_build_object('method', p_method, 'amount', p_amount)), p_date);
$$;


-- =====================================================================
-- PARTE 8 — Registrar pagamento de pacote pendente, em partes
-- Quem: matriz e recepção (como na 49). Lançamentos 'pacote' com
-- customer_package_id; o 1º também vira o cash_entry_id do pacote.
-- =====================================================================
create or replace function register_package_payment(p_package uuid, p_payments jsonb, p_date date)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  cp      customer_packages;
  c       customers;
  v_today date;
  v_total numeric;
  v_rem   numeric;
  v_id    uuid;
  v_first uuid;
  e       jsonb;
begin
  select * into cp from customer_packages where id = p_package for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if coalesce(member_role_of(cp.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(cp.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if cp.payment_status is distinct from 'pending' or cp.status = 'cancelled' then raise exception 'NAO_PENDENTE'; end if;
  v_total := payment_parts_total(p_payments);
  select (now() at time zone coalesce(timezone, 'America/Sao_Paulo'))::date into v_today from businesses where id = cp.business_id;
  if p_date is null or p_date > v_today or p_date < v_today - 3650 then raise exception 'DATA_INVALIDA'; end if;
  select * into c from customers where id = cp.customer_id;

  select cp.price - coalesce(sum(amount), 0) into v_rem
    from cash_entries where customer_package_id = cp.id and kind = 'income';
  if v_total > v_rem then raise exception 'VALOR_ACIMA_DO_SALDO'; end if;

  for e in select x from jsonb_array_elements(p_payments) x loop
    insert into cash_entries (business_id, customer_package_id, kind, category, method, description, amount, entry_date, created_by)
    values (cp.business_id, cp.id, 'income', 'pacote', (e->>'method')::payment_method,
            'Pacote ' || cp.name || ' — ' || coalesce(c.name, 'cliente'), (e->>'amount')::numeric, p_date, auth.uid())
    returning id into v_id;
    v_first := coalesce(v_first, v_id);
  end loop;

  if cp.cash_entry_id is null then
    update customer_packages set cash_entry_id = v_first where id = cp.id;
  end if;
  -- pago/pendente: gatilho do caixa (PARTE 4c)

  return json_build_object('ok', true, 'remaining', v_rem - v_total, 'cash_entry_id', v_first);
end;
$$;

revoke all on function register_package_payment(uuid, jsonb, date) from public, anon;
grant execute on function register_package_payment(uuid, jsonb, date) to authenticated;

create or replace function register_package_payment(p_package uuid, p_method text, p_amount numeric, p_date date)
returns json
language sql volatile security definer set search_path = public
as $$
  select register_package_payment(p_package, jsonb_build_array(jsonb_build_object('method', p_method, 'amount', p_amount)), p_date);
$$;


-- =====================================================================
-- PARTE 9 — reopen_booking (cópia da 49 PARTE 7): desfaz TODAS as partes
-- Cada lançamento precisa bater com o evento 'payment_registered' do mesmo
-- cash_entry_id (valor, forma, data). Lançamento sem evento = automático da
-- conclusão com uma forma: só vale se for o único, com o valor cobrado e a
-- data do atendimento. Senão CAIXA_EDITADO.
-- =====================================================================
create or replace function reopen_booking(p_booking uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk        bookings;
  v_role    text;
  v_tz      text;
  v_done_at timestamptz;
  v_from    text;
  v_to      text;
  ce        cash_entries;
  v_ev      jsonb;
  v_n       int;
  v_total   numeric := 0;
  v_methods text[] := '{}';
  v_first   date;
  v_parts   jsonb := '[]'::jsonb;
  v_cash    jsonb := null;
  v_name    text;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if bk.status <> 'completed' then raise exception 'STATUS_INVALIDO'; end if;

  -- matriz e recepção (profissional e demonstração não reabrem)
  v_role := member_role_of(bk.business_id);
  if coalesce(v_role in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;

  -- quando foi concluído e de que status veio (último evento 'completed')
  select e.created_at, e.details->>'from' into v_done_at, v_from
    from booking_events e
   where e.booking_id = bk.id and e.action = 'completed'
   order by e.created_at desc
   limit 1;

  -- recepção: só até 30 dias da conclusão (sem evento, vale a data do atendimento)
  select coalesce(b.timezone, 'America/Sao_Paulo') into v_tz from businesses b where b.id = bk.business_id;
  if v_role = 'reception'
     and coalesce((v_done_at at time zone v_tz)::date, bk.booking_date)
         < (now() at time zone v_tz)::date - 30 then
    raise exception 'PRAZO_SO_DONO';
  end if;

  v_to := case when v_from in ('pending', 'confirmed') then v_from else 'confirmed' end;

  -- caixa: todas as partes deste atendimento, do jeito que foram gravadas
  select count(*) into v_n from cash_entries where booking_id = bk.id;
  for ce in select * from cash_entries where booking_id = bk.id order by created_at, id for update loop
    select e.details into v_ev
      from booking_events e
     where e.booking_id = bk.id and e.action = 'payment_registered'
       and e.details->>'cash_entry_id' = ce.id::text
     order by e.created_at desc
     limit 1;
    if v_ev is not null then
      if ce.kind <> 'income' or ce.category <> 'atendimento'
         or ce.amount <> (v_ev->>'amount')::numeric
         or ce.method::text <> v_ev->>'method'
         or ce.entry_date <> (v_ev->>'entry_date')::date then
        raise exception 'CAIXA_EDITADO';
      end if;
    else
      if v_n <> 1 or ce.kind <> 'income' or ce.category <> 'atendimento'
         or ce.entry_date <> bk.booking_date or ce.amount <> booking_charge(bk.id) then
        raise exception 'CAIXA_EDITADO';
      end if;
    end if;
    v_total := v_total + ce.amount;
    v_first := coalesce(v_first, ce.entry_date);
    if not (ce.method::text = any (v_methods)) then v_methods := v_methods || ce.method::text; end if;
    v_parts := v_parts || jsonb_build_object('amount', ce.amount, 'method', ce.method, 'entry_date', ce.entry_date);
  end loop;

  if v_n > 0 then
    v_cash := jsonb_build_object('amount', v_total,
                                 'method', case when array_length(v_methods, 1) = 1 then v_methods[1] end,
                                 'entry_date', v_first,
                                 'parts', v_parts);
    delete from cash_entries where booking_id = bk.id;
  end if;

  -- status anterior; o gatilho de histórico não grava 'confirmed' (o evento é o 'reopened')
  perform set_config('genix.booking_reopen', '1', true);
  begin
    update bookings set status = v_to::booking_status where id = bk.id;
  exception
    when exclusion_violation then raise exception 'HORARIO_OCUPADO';
  end;
  perform set_config('genix.booking_reopen', '', true);

  -- nome de quem reabriu (guardado no evento: o histórico mostra mesmo se o acesso sair)
  select coalesce(nullif(trim(m.display_name), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), ''))
    into v_name
    from business_members m
    left join auth.users u on u.id = m.user_id
   where m.business_id = bk.business_id and m.user_id = auth.uid();

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'reopened', auth.uid(), v_role,
          jsonb_build_object(
            'actor_name',   v_name,
            'from',         'completed',
            'to',           v_to,
            'completed_at', v_done_at,
            'cash',         v_cash,
            'review_kept',  exists (select 1 from reviews r where r.booking_id = bk.id)));

  return json_build_object('ok', true, 'status', v_to,
                           'cash_amount', v_cash->'amount', 'cash_method', v_cash->>'method');
end;
$$;
-- (assinatura igual: os grants da 46 continuam valendo)


-- =====================================================================
-- PARTE 10 — Pagamentos pendentes: amount = SALDO; total e pago à parte
-- (o retorno muda: apaga e recria)
-- =====================================================================
drop function if exists pending_payments(uuid);

create or replace function pending_payments(p_business uuid)
returns table (
  kind              text,
  id                uuid,
  customer_id       uuid,
  customer_name     text,
  customer_phone    text,
  customer_phone_country text,
  ref_date          date,
  description       text,
  professional_name text,
  amount            numeric,
  total             numeric,
  paid              numeric
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if member_role_of(p_business) is null then raise exception 'SEM_PERMISSAO'; end if;

  return query
  select 'booking'::text, b.id, b.customer_id, b.customer_name, b.customer_phone, b.customer_phone_country,
         b.booking_date, b.service_name, b.professional_name,
         greatest(booking_charge(b.id) - b.amount_paid, 0), booking_charge(b.id), b.amount_paid
    from bookings b
   where b.business_id = p_business
     and b.status = 'completed'
     and b.payment_status = 'pending'
     and (sees_whole_agenda(p_business) or b.professional_id = my_professional_id(p_business))
  union all
  select 'package'::text, cp.id, cp.customer_id, c.name, c.phone, c.phone_country,
         (cp.sold_at at time zone coalesce(bz.timezone, 'America/Sao_Paulo'))::date, 'Pacote ' || cp.name, null::text,
         greatest(cp.price - cp.amount_paid, 0), cp.price, cp.amount_paid
    from customer_packages cp
    join customers c on c.id = cp.customer_id
    join businesses bz on bz.id = cp.business_id
   where cp.business_id = p_business
     and cp.payment_status = 'pending'
     and cp.status <> 'cancelled'
     and sees_whole_agenda(p_business)
   order by 7, 4;
end;
$$;

revoke all on function pending_payments(uuid) from public, anon;
grant execute on function pending_payments(uuid) to authenticated;


-- =====================================================================
-- PARTE 11 — Saldo de um atendimento/pacote (só leitura, para o diálogo)
-- Atendimento: quem vê o agendamento (matriz, recepção, demonstração; o
-- profissional, os dele). Pacote: matriz, recepção e demonstração.
-- =====================================================================
create or replace function payment_balance(p_kind text, p_id uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  bk bookings;
  cp customer_packages;
  v_total numeric;
begin
  if p_kind = 'booking' then
    select * into bk from bookings where id = p_id;
    if not found then raise exception 'NAO_ENCONTRADO'; end if;
    if member_role_of(bk.business_id) is null
       or not (sees_whole_agenda(bk.business_id) or bk.professional_id = my_professional_id(bk.business_id)) then
      raise exception 'SEM_PERMISSAO';
    end if;
    v_total := booking_charge(bk.id);
    return json_build_object('total', v_total, 'paid', bk.amount_paid,
                             'remaining', greatest(v_total - bk.amount_paid, 0), 'status', bk.payment_status);
  elsif p_kind = 'package' then
    select * into cp from customer_packages where id = p_id;
    if not found then raise exception 'NAO_ENCONTRADO'; end if;
    if coalesce(member_role_of(cp.business_id) in ('owner', 'reception', 'viewer'), false) = false then
      raise exception 'SEM_PERMISSAO';
    end if;
    return json_build_object('total', cp.price, 'paid', cp.amount_paid,
                             'remaining', greatest(cp.price - cp.amount_paid, 0), 'status', cp.payment_status);
  end if;
  raise exception 'DADOS_INVALIDOS';
end;
$$;

revoke all on function payment_balance(text, uuid) from public, anon;
grant execute on function payment_balance(text, uuid) to authenticated;


-- =====================================================================
-- PARTE 12 — goals_with_progress (cópia da 58): ticket médio por atendimento
-- Várias partes do mesmo atendimento contam como 1 (antes, 80 + 170 viravam
-- 2 “atendimentos” de 125). Faturamento: base = atendimentos distintos.
-- =====================================================================
create or replace function goals_with_progress(p_business uuid)
returns table (
  id              uuid,
  kind            text,
  target          numeric,
  period_start    date,
  period_end      date,
  professional_id uuid,
  professional_name text,
  realized        numeric,
  base_count      int
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if not plan_allows(p_business, 'profissional') then
    raise exception 'PLANO_PROFISSIONAL';
  end if;

  return query
  with first_visit as (
    -- 1º atendimento concluído de cada cliente no espaço
    select distinct on (b.customer_id) b.customer_id, b.booking_date, b.professional_id
      from bookings b
     where b.business_id = p_business and b.status = 'completed' and b.customer_id is not null
     order by b.customer_id, b.booking_date, b.start_time, b.created_at
  )
  select g.id, g.kind, g.target, g.period_start, g.period_end, g.professional_id, pr.name,
         m.realized, m.base_count
    from business_goals g
    left join professionals pr on pr.id = g.professional_id
    cross join lateral (
      select
        case g.kind
          when 'faturamento' then coalesce((
            select sum(ce.amount) from cash_entries ce
              left join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id)), 0)
          when 'ticket_medio' then coalesce((
            -- 68: soma as partes de cada atendimento antes da média
            select round(avg(t.total), 2) from (
              select sum(ce.amount) as total from cash_entries ce
                join bookings bk on bk.id = ce.booking_id
               where ce.business_id = p_business and ce.kind = 'income'
                 and ce.entry_date between g.period_start and g.period_end
                 and (g.professional_id is null or bk.professional_id = g.professional_id)
               group by ce.booking_id) t), 0)
          when 'atendimentos' then (
            select count(*) from bookings bk
             where bk.business_id = p_business and bk.status = 'completed'
               and bk.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::numeric
          else (
            select count(*) from first_visit fv
             where fv.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or fv.professional_id = g.professional_id))::numeric
        end as realized,
        case g.kind
          when 'faturamento' then (
            -- 68: partes do mesmo atendimento contam 1
            select count(distinct coalesce(ce.booking_id, ce.id)) from cash_entries ce
              left join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::int
          when 'ticket_medio' then (
            select count(distinct ce.booking_id) from cash_entries ce
              join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::int
          when 'atendimentos' then (
            select count(*) from bookings bk
             where bk.business_id = p_business and bk.status = 'completed'
               and bk.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::int
          else (
            select count(*) from first_visit fv
             where fv.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or fv.professional_id = g.professional_id))::int
        end as base_count
    ) m
   where g.business_id = p_business
   order by g.period_end desc, g.period_start desc, g.created_at;
end;
$$;


-- =====================================================================
-- PARTE 13 — billing_monthly (cópia da 59b): parte do salão-parceiro
-- arredondada no total do grupo (antes, por lançamento: 2 partes podiam
-- dar 1 centavo de diferença).
-- =====================================================================
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
  v_partner := coalesce(v_partner, false) and plan_allows(p_business, 'equipe');   -- 59

  return query
  select to_char(c.entry_date, 'YYYY-MM'), c.kind::text, c.category::text, c.method::text,
         sum(c.amount)::numeric,
         -- 68: arredonda no total (várias partes do mesmo atendimento não somam centavos a mais)
         round(sum(case
               when c.kind = 'income' and bk.id is not null then
                 c.amount * coalesce(bk.partner_pct,
                                     case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100
               else 0
             end), 2)::numeric
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

commit;


-- =====================================================================
-- CONFERÊNCIA (só leitura; rodar depois)
-- =====================================================================
-- 1) funções novas/reescritas (deve listar 14 linhas)
--   select proname, pg_get_function_identity_arguments(oid) from pg_proc
--    where proname in ('booking_charge', 'payment_parts_total', 'payment_sync_booking', 'payment_sync_package',
--                      'cash_entry_check_balance', 'cash_entry_sync_payment', 'customer_package_link_cash',
--                      'complete_booking', 'register_booking_payment', 'register_package_payment',
--                      'reopen_booking', 'pending_payments', 'payment_balance')
--    order by 1, 2;
-- 2) o índice único saiu (deve voltar 0 linhas)
--   select indexname from pg_indexes where indexname = 'cash_entries_one_per_booking';
-- 3) nenhum pendente com pago acima do cobrado (deve voltar 0 linhas)
--   select id, amount_paid, booking_charge(id) from bookings
--    where payment_status is not null and amount_paid > booking_charge(id);


-- =====================================================================
-- REVERSÃO (só se precisar desfazer)
-- Antes: recriar complete_booking(uuid, text), register_booking_payment e
-- register_package_payment (uuid, text, numeric, date), reopen_booking e
-- pending_payments com os corpos da 49; goals_with_progress com o da 58;
-- billing_monthly com o da 59b. O índice único só volta se nenhum
-- atendimento tiver 2+ lançamentos (conferir antes).
-- =====================================================================
-- begin;
-- drop function if exists payment_balance(text, uuid);
-- drop function if exists register_package_payment(uuid, jsonb, date);
-- drop function if exists register_booking_payment(uuid, jsonb, date);
-- drop function if exists complete_booking(uuid, text, jsonb);
-- drop trigger if exists trg_customer_package_link_cash on customer_packages;
-- drop trigger if exists trg_cash_entry_sync_payment on cash_entries;
-- drop trigger if exists trg_cash_entry_check_balance on cash_entries;
-- drop function if exists customer_package_link_cash();
-- drop function if exists cash_entry_sync_payment();
-- drop function if exists cash_entry_check_balance();
-- drop function if exists payment_sync_package(uuid);
-- drop function if exists payment_sync_booking(uuid);
-- drop function if exists payment_parts_total(jsonb);
-- drop function if exists booking_charge(uuid);
-- drop index if exists idx_cash_entries_booking;
-- create unique index if not exists cash_entries_one_per_booking on cash_entries (booking_id) where booking_id is not null;
-- drop index if exists idx_cash_entries_package;
-- alter table cash_entries drop column if exists customer_package_id;
-- alter table customer_packages drop column if exists amount_paid;
-- alter table bookings drop column if exists amount_paid;
-- commit;
