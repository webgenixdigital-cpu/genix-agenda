-- =====================================================================
-- GENIX AGENDA — 49: "Escolher depois" na forma de pagamento
-- A forma de pagamento nunca impede concluir um atendimento nem vender um
-- pacote. Com "Escolher depois" o atendimento fica concluído (e o pacote,
-- vendido e usável) SEM lançamento no caixa e com o selo "Pagamento
-- pendente", até alguém registrar o pagamento.
--
-- Estado guardado (não derivado): "concluído sem lançamento" também é o
-- Grátis (sem caixa) e o "Concluir sem lançar no caixa" (escolha de não
-- controlar), que NÃO são pendentes.
--   payment_status null      = como sempre (pago na conclusão / sem caixa / Grátis)
--   payment_status 'pending' = concluído/vendido com "Escolher depois"
--   payment_status 'paid'    = pago DEPOIS (Registrar pagamento)
-- Dados existentes: todos null (nada muda).
--
--   PARTE 1  colunas + índice
--   PARTE 2  trava: payment_status só muda pelas funções desta migration
--            (sinal genix.payment_edit); sair de 'completed' (reabrir) limpa
--   PARTE 3  complete_booking (cópia EXATA da 31) + p_method 'pendente'
--   PARTE 4  register_booking_payment
--   PARTE 5  sell_package_core (cópia EXATA da 39) + p_method 'pendente'
--   PARTE 6  register_package_payment
--   PARTE 7  reopen_booking (cópia EXATA da 46) + pago depois
--   PARTE 8  pending_payments (só leitura)
--
-- Faturamento, limites e relatório do contador leem só cash_entries: entra
-- só o que foi pago, na data do pagamento. "Meus ganhos"/comissão, ficha,
-- avaliação e partner_pct seguem status = 'completed' (sem mudança).
--
-- Rode inteira de uma vez, ANTES do merge (só acrescenta; o código atual
-- continua funcionando). Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Colunas
-- =====================================================================
alter table bookings add column if not exists payment_status text;
alter table bookings drop constraint if exists bookings_payment_status_valid;
alter table bookings add constraint bookings_payment_status_valid
  check (payment_status is null or payment_status in ('pending', 'paid'));
create index if not exists idx_bookings_payment_pending on bookings (business_id, booking_date)
  where payment_status = 'pending';

alter table customer_packages add column if not exists payment_status text;
alter table customer_packages drop constraint if exists customer_packages_payment_status_valid;
alter table customer_packages add constraint customer_packages_payment_status_valid
  check (payment_status is null or payment_status in ('pending', 'paid'));
create index if not exists idx_customer_packages_payment_pending on customer_packages (business_id)
  where payment_status = 'pending';


-- =====================================================================
-- PARTE 2 — Trava do payment_status
-- Só as funções desta migration mudam (ligam genix.payment_edit = '1',
-- vale na transação). Atendimento que sai de 'completed' (reabrir) volta a
-- null sozinho: o selo some. Sem usuário (SQL Editor/service role): livre.
-- =====================================================================
create or replace function guard_booking_payment_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    new.payment_status := null;
    return new;
  end if;
  if auth.uid() is null or coalesce(current_setting('genix.payment_edit', true), '') = '1' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.payment_status is not null)
     or (tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status) then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_booking_payment_status on bookings;
create trigger trg_guard_booking_payment_status
before insert or update on bookings
for each row execute function guard_booking_payment_status();

create or replace function guard_package_payment_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(current_setting('genix.payment_edit', true), '') = '1' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.payment_status is not null)
     or (tg_op = 'UPDATE' and new.payment_status is distinct from old.payment_status) then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_package_payment_status on customer_packages;
create trigger trg_guard_package_payment_status
before insert or update on customer_packages
for each row execute function guard_package_payment_status();


-- =====================================================================
-- PARTE 3 — complete_booking (cópia da 31 PARTE 12) + "Escolher depois"
-- p_method 'pendente': com valor a cobrar > 0 no plano pago, conclui SEM
-- lançar e marca 'pending'. Sessão 100% paga pelo pacote (cobrado = 0) ou
-- Grátis: conclui normal, sem pendência.
-- =====================================================================
create or replace function complete_booking(p_booking uuid, p_method text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk       bookings;
  v_cash   boolean := false;
  v_pkg    numeric;
  v_charge numeric;
  v_later  boolean := false;   -- 49
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if p_method is not null and p_method not in ('pix', 'dinheiro', 'credito', 'debito', 'pendente') then
    raise exception 'FORMA_INVALIDA';
  end if;

  update bookings set status = 'completed' where id = p_booking;

  -- 31_editar_agendamento: parte paga pelo pacote (sem itens = regra antiga)
  select sum(price) filter (where paid_by_package) into v_pkg from booking_items where booking_id = bk.id;
  v_pkg := coalesce(v_pkg, case when bk.customer_package_id is not null then bk.price else 0 end);
  v_charge := greatest(bk.price - v_pkg, 0);

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

  -- lança no caixa só no plano pago, com forma de pagamento e valor > 0 (1 vez por atendimento)
  if p_method is not null and v_charge > 0 and access_tier(bk.business_id) = 'completo' then
    insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
    values (bk.business_id, bk.id, 'income', 'atendimento', p_method::payment_method,
            bk.service_name || ' — ' || bk.customer_name, v_charge, bk.booking_date, auth.uid())
    on conflict (booking_id) where booking_id is not null do nothing;
    v_cash := found;
  end if;

  return json_build_object('ok', true, 'cash', v_cash, 'pending', false);
end;
$$;
-- (assinatura igual: os grants de antes continuam valendo)


-- =====================================================================
-- PARTE 4 — Registrar pagamento de um atendimento pendente
-- Quem: quem pode concluir (can_manage_booking: matriz e recepção em todos,
-- profissional nos dele). Cria 1 lançamento ligado ao atendimento e tira o
-- selo; o histórico guarda valor, forma e data (o reabrir confere por eles).
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | PLANO_GRATIS | NAO_PENDENTE |
--        FORMA_INVALIDA | VALOR_INVALIDO | DATA_INVALIDA | JA_LANCADO
-- =====================================================================
create or replace function register_booking_payment(p_booking uuid, p_method text, p_amount numeric, p_date date)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  v_today date;
  v_id    uuid;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(bk.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if bk.status <> 'completed' or bk.payment_status is distinct from 'pending' then raise exception 'NAO_PENDENTE'; end if;
  if p_method is null or p_method not in ('pix', 'dinheiro', 'credito', 'debito') then raise exception 'FORMA_INVALIDA'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999 then raise exception 'VALOR_INVALIDO'; end if;
  select (now() at time zone coalesce(timezone, 'America/Sao_Paulo'))::date into v_today from businesses where id = bk.business_id;
  if p_date is null or p_date > v_today or p_date < v_today - 3650 then raise exception 'DATA_INVALIDA'; end if;

  insert into cash_entries (business_id, booking_id, kind, category, method, description, amount, entry_date, created_by)
  values (bk.business_id, bk.id, 'income', 'atendimento', p_method::payment_method,
          bk.service_name || ' — ' || bk.customer_name, round(p_amount, 2), p_date, auth.uid())
  on conflict (booking_id) where booking_id is not null do nothing
  returning id into v_id;
  if v_id is null then raise exception 'JA_LANCADO'; end if;

  perform set_config('genix.payment_edit', '1', true);
  update bookings set payment_status = 'paid' where id = bk.id;
  perform set_config('genix.payment_edit', '', true);

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'payment_registered', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
          jsonb_build_object('amount', round(p_amount, 2), 'method', p_method, 'entry_date', p_date, 'cash_entry_id', v_id));

  return json_build_object('ok', true, 'cash_entry_id', v_id);
end;
$$;

revoke all on function register_booking_payment(uuid, text, numeric, date) from public, anon;
grant execute on function register_booking_payment(uuid, text, numeric, date) to authenticated;


-- =====================================================================
-- PARTE 5 — sell_package_core (cópia da 39 PARTE 4) + "Escolher depois"
-- p_method 'pendente' (pacote com preço): vende SEM caixa, pacote já usável,
-- payment_status 'pending'. sell_package e sell_package_fixed_visits passam
-- o p_method adiante (sem mudança).
-- =====================================================================
create or replace function sell_package_core(p_customer uuid, p_template uuid, p_method text, p_mode text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  t       package_templates;
  c       customers;
  v_cash  uuid;
  v_id    uuid;
  v_today date;
  v_n     int;
  v_total int;
  v_wsum  numeric;
  v_names text;
  v_i     int := 0;
  v_acc   numeric := 0;
  v_val   numeric;
  v_later boolean := false;   -- 49
  r       record;
begin
  if p_mode not in ('free', 'fixed') then raise exception 'DADOS_INVALIDOS'; end if;
  perform check_package_sale(p_customer, p_template);
  select * into t from package_templates where id = p_template;
  select * into c from customers where id = p_customer;
  select (now() at time zone timezone)::date into v_today from businesses where id = t.business_id;

  select count(*), coalesce(sum(i.sessions), 0), coalesce(sum(s.price * i.sessions), 0),
         string_agg(s.name, ' + ' order by i.position, s.name)
    into v_n, v_total, v_wsum, v_names
    from package_template_items i join services s on s.id = i.service_id
   where i.template_id = t.id;
  if v_n = 0 or v_total < 1 or v_total > 100 then raise exception 'MODELO_INVALIDO'; end if;

  if t.price > 0 then
    if p_method = 'pendente' then
      v_later := true;   -- 49: sem caixa agora; "Registrar pagamento" depois
    else
      if p_method is null or p_method not in ('pix', 'dinheiro', 'credito', 'debito') then
        raise exception 'FORMA_INVALIDA';
      end if;
      insert into cash_entries (business_id, kind, category, method, description, amount, entry_date, created_by)
      values (t.business_id, 'income', 'pacote', p_method::payment_method,
              'Pacote ' || t.name || ' — ' || c.name, t.price, v_today, auth.uid())
      returning id into v_cash;
    end if;
  end if;

  if v_later then perform set_config('genix.payment_edit', '1', true); end if;
  insert into customer_packages (business_id, customer_id, template_id, service_id, service_name, name,
                                 sessions_total, price, expires_at, cash_entry_id, created_by, schedule_mode,
                                 payment_status)
  values (t.business_id, c.id, t.id, case when v_n = 1 then t.service_id end, v_names, t.name,
          v_total, t.price,
          case when t.validity_days is null then null else v_today + t.validity_days end,
          v_cash, auth.uid(), p_mode,
          case when v_later then 'pending' end)
  returning id into v_id;
  if v_later then perform set_config('genix.payment_edit', '', true); end if;

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
-- (mantém as permissões da 39: revogada de public, anon, authenticated)


-- =====================================================================
-- PARTE 6 — Registrar pagamento de um pacote pendente
-- Quem: matriz e recepção (os mesmos que vendem). Lançamento 'pacote'.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | PLANO_GRATIS | NAO_PENDENTE |
--        FORMA_INVALIDA | VALOR_INVALIDO | DATA_INVALIDA
-- =====================================================================
create or replace function register_package_payment(p_package uuid, p_method text, p_amount numeric, p_date date)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  cp      customer_packages;
  c       customers;
  v_today date;
  v_id    uuid;
begin
  select * into cp from customer_packages where id = p_package for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if coalesce(member_role_of(cp.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(cp.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if cp.payment_status is distinct from 'pending' or cp.status = 'cancelled' then raise exception 'NAO_PENDENTE'; end if;
  if p_method is null or p_method not in ('pix', 'dinheiro', 'credito', 'debito') then raise exception 'FORMA_INVALIDA'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999 then raise exception 'VALOR_INVALIDO'; end if;
  select (now() at time zone coalesce(timezone, 'America/Sao_Paulo'))::date into v_today from businesses where id = cp.business_id;
  if p_date is null or p_date > v_today or p_date < v_today - 3650 then raise exception 'DATA_INVALIDA'; end if;
  select * into c from customers where id = cp.customer_id;

  insert into cash_entries (business_id, kind, category, method, description, amount, entry_date, created_by)
  values (cp.business_id, 'income', 'pacote', p_method::payment_method,
          'Pacote ' || cp.name || ' — ' || coalesce(c.name, 'cliente'), round(p_amount, 2), p_date, auth.uid())
  returning id into v_id;

  perform set_config('genix.payment_edit', '1', true);
  update customer_packages set payment_status = 'paid', cash_entry_id = v_id where id = cp.id;
  perform set_config('genix.payment_edit', '', true);

  return json_build_object('ok', true, 'cash_entry_id', v_id);
end;
$$;

revoke all on function register_package_payment(uuid, text, numeric, date) from public, anon;
grant execute on function register_package_payment(uuid, text, numeric, date) to authenticated;


-- =====================================================================
-- PARTE 7 — reopen_booking (cópia da 46 PARTE 2) + pagamento registrado depois
-- Única mudança: com payment_status = 'paid', o lançamento a desfazer é o do
-- "Registrar pagamento" e a conferência é com o último evento
-- 'payment_registered' (valor, forma e data). Pendente: não há lançamento.
-- O selo sai pelo gatilho da PARTE 2 (status deixa de ser 'completed').
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
  v_pkg     numeric;
  v_charge  numeric;
  ce        cash_entries;
  v_cash    jsonb := null;
  v_name    text;
  v_paid    jsonb;   -- 49
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

  -- caixa: só o lançamento automático deste atendimento, do jeito que a conclusão gravou
  select * into ce from cash_entries where booking_id = bk.id for update;
  if found then
    if bk.payment_status = 'paid' then
      -- 49: pago depois — confere com o que o "Registrar pagamento" gravou
      select e.details into v_paid
        from booking_events e
       where e.booking_id = bk.id and e.action = 'payment_registered'
       order by e.created_at desc
       limit 1;
      if v_paid is null or ce.kind <> 'income' or ce.category <> 'atendimento'
         or ce.amount <> (v_paid->>'amount')::numeric
         or ce.method::text <> v_paid->>'method'
         or ce.entry_date <> (v_paid->>'entry_date')::date then
        raise exception 'CAIXA_EDITADO';
      end if;
    else
      select sum(price) filter (where paid_by_package) into v_pkg from booking_items where booking_id = bk.id;
      v_pkg := coalesce(v_pkg, case when bk.customer_package_id is not null then bk.price else 0 end);
      v_charge := greatest(bk.price - v_pkg, 0);

      if ce.kind <> 'income' or ce.category <> 'atendimento'
         or ce.entry_date <> bk.booking_date or ce.amount <> v_charge then
        raise exception 'CAIXA_EDITADO';
      end if;
    end if;

    v_cash := jsonb_build_object('amount', ce.amount, 'method', ce.method, 'entry_date', ce.entry_date);
    delete from cash_entries where id = ce.id;
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
-- PARTE 8 — Pagamentos pendentes (só leitura; lista da Agenda e quadro do Início)
-- Atendimentos: os que a pessoa vê na agenda (matriz, recepção e demonstração:
-- todos; profissional: os dele). Pacotes: matriz, recepção e demonstração.
-- amount = valor sugerido (atendimento: cobrado = total − itens do pacote;
-- pacote: preço).
-- =====================================================================
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
  amount            numeric
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if member_role_of(p_business) is null then raise exception 'SEM_PERMISSAO'; end if;

  return query
  select 'booking'::text, b.id, b.customer_id, b.customer_name, b.customer_phone, b.customer_phone_country,
         b.booking_date, b.service_name, b.professional_name,
         greatest(b.price - coalesce((select sum(i.price) from booking_items i
                                       where i.booking_id = b.id and i.paid_by_package),
                                     case when b.customer_package_id is not null then b.price else 0 end), 0)
    from bookings b
   where b.business_id = p_business
     and b.status = 'completed'
     and b.payment_status = 'pending'
     and (sees_whole_agenda(p_business) or b.professional_id = my_professional_id(p_business))
  union all
  select 'package'::text, cp.id, cp.customer_id, c.name, c.phone, c.phone_country,
         (cp.sold_at at time zone coalesce(bz.timezone, 'America/Sao_Paulo'))::date, 'Pacote ' || cp.name, null::text,
         cp.price
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

commit;

-- Conferência
select proname from pg_proc
 where proname in ('complete_booking', 'register_booking_payment', 'sell_package_core', 'register_package_payment',
                   'reopen_booking', 'pending_payments', 'guard_booking_payment_status', 'guard_package_payment_status')
 order by 1;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- Antes: recriar complete_booking com o corpo da 31 (PARTE 12),
-- sell_package_core com o da 39 (PARTE 4) e reopen_booking com o da 46
-- (PARTE 2). Lançamentos já registrados continuam no caixa.
-- =====================================================================
-- begin;
-- drop function if exists pending_payments(uuid);
-- drop function if exists register_package_payment(uuid, text, numeric, date);
-- drop function if exists register_booking_payment(uuid, text, numeric, date);
-- drop trigger if exists trg_guard_package_payment_status on customer_packages;
-- drop trigger if exists trg_guard_booking_payment_status on bookings;
-- drop function if exists guard_package_payment_status();
-- drop function if exists guard_booking_payment_status();
-- drop index if exists idx_customer_packages_payment_pending;
-- drop index if exists idx_bookings_payment_pending;
-- alter table customer_packages drop constraint if exists customer_packages_payment_status_valid;
-- alter table customer_packages drop column if exists payment_status;
-- alter table bookings drop constraint if exists bookings_payment_status_valid;
-- alter table bookings drop column if exists payment_status;
-- commit;
