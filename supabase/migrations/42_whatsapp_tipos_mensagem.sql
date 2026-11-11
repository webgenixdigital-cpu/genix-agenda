-- =====================================================================
-- GENIX AGENDA — 42: WhatsApp automático com 4 tipos de mensagem
--
--   confirmation  5 min depois de ficar 'confirmed' (criado confirmado,
--                 confirmado depois ou remarcado já confirmado)
--   before        1h, 1h30 ou 2h antes do horário
--   eve           véspera (o atual, com os textos A/B/C em rodízio)
--   birthday      no dia de customers.birth_date (29/02 → 28/02)
--
-- A fila passa a ser GRAVADA em whatsapp_reminder_sends:
--   queued → sending → sent | failed      (envio)
--   queued → skipped (reason)             (EXPIRADA, CANCELADO, REMARCADO,
--                                          NAO_CONFIRMADO, JA_LEMBRADO,
--                                          OPT_OUT, NUMERO_INVALIDO,
--                                          DESLIGADO, DISPENSADA)
--
-- Prioridade quando disputam o ritmo do número:
--   1 confirmação → 2 antes do horário → 3 véspera → 4 aniversário
-- Ritmo POR NÚMERO da 35 (sorteio 7–13 min + 0–59 s, máx. 6/h) vale para
-- todos os tipos juntos. Janela 08:00–20:00 no fuso do espaço.
-- DISPENSADA: no máx. 1 mensagem a cada 6 h por agendamento + horário.
--
-- Funções do CÓDIGO NOVO (env WHATSAPP_QUEUE_V2=1):
--   whatsapp_queue_refresh()        enfileira e limpa (todos os espaços)
--   whatsapp_tick_candidates_v2()   espaços para o relógio
--   next_auto_message(espaço)       próxima linha da fila (sem gravar)
--   claim_auto_message(espaço)      reserva e devolve o texto + dados
--   save_whatsapp_messages(...)     painel do dono (tipos, minutos, textos)
--   whatsapp_auto_stats(espaço)     últimos 7 dias por tipo
--
-- CAMINHO ANTIGO (WHATSAPP_QUEUE_V2 desligada) continua funcionando:
-- next_auto_reminder / claim_auto_reminder / whatsapp_tick_candidates só
-- recebem ajustes para conviver com a fila (ignoram linhas queued/skipped
-- e de outros tipos; o claim aproveita a linha 'eve' que estiver na fila).
-- finish_auto_reminder e expire_stale_auto_reminders servem aos dois.
--
-- ORDEM: rodar ANTES do merge. O código atual continua funcionando
-- (as linhas existentes viram kind = 'eve'). Tudo dentro de begin/commit.
-- Conferência e REVERSÃO no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Fila: colunas novas em whatsapp_reminder_sends
-- claimed_at = quando virou 'sending' (é o que conta no ritmo).
-- O default now() vale para o claim antigo, que insere direto 'sending';
-- as linhas existentes recebem created_at (antes do default).
-- =====================================================================
alter table whatsapp_reminder_sends add column if not exists kind        text;
alter table whatsapp_reminder_sends add column if not exists customer_id uuid references customers(id) on delete cascade;
alter table whatsapp_reminder_sends add column if not exists due_at      timestamptz;
alter table whatsapp_reminder_sends add column if not exists expires_at  timestamptz;
alter table whatsapp_reminder_sends add column if not exists priority    smallint;
alter table whatsapp_reminder_sends add column if not exists claimed_at  timestamptz;

update whatsapp_reminder_sends set kind = 'eve' where kind is null;
update whatsapp_reminder_sends set priority = 3 where priority is null;
update whatsapp_reminder_sends set claimed_at = created_at where claimed_at is null;

alter table whatsapp_reminder_sends alter column kind set default 'eve';
alter table whatsapp_reminder_sends alter column kind set not null;
alter table whatsapp_reminder_sends alter column priority set default 3;
alter table whatsapp_reminder_sends alter column priority set not null;
alter table whatsapp_reminder_sends alter column claimed_at set default now();

-- aniversário não tem agendamento
alter table whatsapp_reminder_sends alter column booking_id drop not null;

alter table whatsapp_reminder_sends drop constraint if exists whatsapp_reminder_sends_kind_check;
alter table whatsapp_reminder_sends add constraint whatsapp_reminder_sends_kind_check
  check (kind in ('confirmation', 'before', 'eve', 'birthday'));

alter table whatsapp_reminder_sends drop constraint if exists whatsapp_reminder_sends_target_check;
alter table whatsapp_reminder_sends add constraint whatsapp_reminder_sends_target_check
  check ((kind <> 'birthday' and booking_id is not null) or (kind = 'birthday' and customer_id is not null));

-- status: a check da 23 foi criada sem nome; o bloco acha e troca
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid = 'whatsapp_reminder_sends'::regclass
       and pg_get_constraintdef(c.oid) ~* '\mstatus\M'
  loop
    execute format('alter table whatsapp_reminder_sends drop constraint %I', r.conname);
  end loop;
end $$;
alter table whatsapp_reminder_sends add constraint whatsapp_reminder_sends_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'));

-- unicidade por (agendamento, tipo, data/hora alvo, tentativa) e
-- (cliente, aniversário, dia, tentativa). As linhas atuais são todas 'eve'.
drop index if exists uq_whatsapp_reminder_attempt;
create unique index if not exists uq_whatsapp_send_booking
  on whatsapp_reminder_sends (booking_id, kind, booking_date, start_time, attempt)
  where booking_id is not null;
create unique index if not exists uq_whatsapp_send_birthday
  on whatsapp_reminder_sends (customer_id, booking_date, attempt)
  where kind = 'birthday';
create index if not exists idx_whatsapp_send_queue
  on whatsapp_reminder_sends (business_id, status, due_at);
create index if not exists idx_whatsapp_send_claimed
  on whatsapp_reminder_sends (business_id, claimed_at desc);

-- leitura: linhas com agendamento como antes; aniversário só para quem vê a agenda toda
drop policy if exists "ve envios automaticos" on whatsapp_reminder_sends;
create policy "ve envios automaticos" on whatsapp_reminder_sends
  for select to authenticated
  using (
    (booking_id is not null and exists (
      select 1 from bookings b
      where b.id = booking_id
        and (sees_whole_agenda(b.business_id) or can_manage_booking(b.business_id, b.professional_id))))
    or (booking_id is null and sees_whole_agenda(business_id))
  );


-- =====================================================================
-- PARTE 2 — Preferências por tipo (whatsapp_settings)
-- Véspera continua ligada (comportamento atual); tipos novos desligados.
-- Textos null = padrão do código (src/lib/whatsapp/templates.ts).
-- =====================================================================
alter table whatsapp_settings add column if not exists eve_enabled       boolean not null default true;
alter table whatsapp_settings add column if not exists confirm_enabled   boolean not null default false;
alter table whatsapp_settings add column if not exists confirm_since     timestamptz;
alter table whatsapp_settings add column if not exists before_enabled    boolean not null default false;
alter table whatsapp_settings add column if not exists before_minutes    smallint not null default 120;
alter table whatsapp_settings add column if not exists birthday_enabled  boolean not null default false;
alter table whatsapp_settings add column if not exists template_confirm  text;
alter table whatsapp_settings add column if not exists template_before   text;
alter table whatsapp_settings add column if not exists template_birthday text;

alter table whatsapp_settings drop constraint if exists whatsapp_settings_before_minutes_check;
alter table whatsapp_settings add constraint whatsapp_settings_before_minutes_check
  check (before_minutes in (60, 90, 120));
alter table whatsapp_settings drop constraint if exists whatsapp_settings_new_templates_check;
alter table whatsapp_settings add constraint whatsapp_settings_new_templates_check
  check (coalesce(char_length(template_confirm), 0) <= 1000
     and coalesce(char_length(template_before), 0) <= 1000
     and coalesce(char_length(template_birthday), 0) <= 1000);


-- =====================================================================
-- PARTE 3 — Apoio
-- =====================================================================
-- Se o horário cai fora de 08:00–20:00 (fuso do espaço), vai para a
-- próxima abertura (08:00 do mesmo dia ou do dia seguinte).
create or replace function whatsapp_window_start(p_ts timestamptz, p_tz text)
returns timestamptz
language sql stable set search_path = public
as $$
  select case
    when (p_ts at time zone p_tz)::time < time '08:00'
      then (((p_ts at time zone p_tz)::date + time '08:00') at time zone p_tz)
    when (p_ts at time zone p_tz)::time >= time '20:00'
      then ((((p_ts at time zone p_tz)::date + 1) + time '08:00') at time zone p_tz)
    else p_ts
  end;
$$;

-- Aniversário hoje? (29/02 conta em 28/02 nos anos sem 29/02)
create or replace function whatsapp_is_birthday(p_birth date, p_day date)
returns boolean
language sql immutable
as $$
  select p_birth is not null and (
    to_char(p_birth, 'MM-DD') = to_char(p_day, 'MM-DD')
    or (to_char(p_birth, 'MM-DD') = '02-29' and to_char(p_day, 'MM-DD') = '02-28'
        -- ano sem 29/02: 1º/jan + 1 mês + 28 dias cai em 1º/mar
        and extract(day from (date_trunc('year', p_day::timestamp) + interval '1 month 28 days')) <> 29)
  );
$$;

-- Ritmo por número (o mesmo da 35, contando só o que já saiu da fila):
-- true = o número pode enviar agora
create or replace function whatsapp_number_ready(p_business uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  inst whatsapp_instances;
begin
  select * into inst from whatsapp_instances where business_id = p_business;
  if not found then return false; end if;

  -- (1) intervalo sorteado no último resultado (maior entre as instâncias do número)
  if now() < (select coalesce(max(i2.next_send_at), '-infinity'::timestamptz)
                from whatsapp_instances i2
               where i2.business_id = p_business
                  or (inst.phone_number is not null and i2.phone_number = inst.phone_number)) then
    return false;
  end if;

  -- (2) piso de 7 min desde a última reserva e (3) no máx. 6 por hora (falhas contam)
  if exists (select 1 from whatsapp_reminder_sends s
              where s.claimed_at > now() - interval '7 minutes'
                and (s.business_id = p_business
                     or (inst.phone_number is not null and s.business_id in
                           (select i2.business_id from whatsapp_instances i2 where i2.phone_number = inst.phone_number)))) then
    return false;
  end if;
  if (select count(*) from whatsapp_reminder_sends s
       where s.claimed_at > now() - interval '1 hour'
         and (s.business_id = p_business
              or (inst.phone_number is not null and s.business_id in
                    (select i2.business_id from whatsapp_instances i2 where i2.phone_number = inst.phone_number)))) >= 6 then
    return false;
  end if;
  return true;
end;
$$;


-- =====================================================================
-- PARTE 4 — Enfileirar e limpar (relógio, a cada minuto)
-- Só espaços liberados + automático ligado + plano pago; só agendamentos
-- de hoje até depois de amanhã e aniversários de hoje. Idempotente:
-- insere com "on conflict do nothing" e só mexe em linhas 'queued'.
-- Uma linha só entra na fila quando já pode sair (due_at <= agora) e
-- ainda vale (agora < expires_at); o aniversário entra no começo do dia
-- com o horário sorteado.
-- Devolve {"enfileiradas", "expiradas", "descartadas"}.
-- =====================================================================
create or replace function whatsapp_queue_refresh()
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  b        record;
  v_now    timestamp;
  v_today  date;
  v_n      int;
  v_queued int := 0;
  v_exp    int := 0;
  v_skip   int := 0;
begin
  -- espaço que saiu das condições (automático desligado, sem liberação ou
  -- plano Grátis): o que estava na fila não sai mais
  with x as (
    update whatsapp_reminder_sends s
       set status = 'skipped', reason = 'DESLIGADO', finished_at = now()
     where s.status = 'queued'
       and not exists (select 1
                         from whatsapp_settings st
                         join whatsapp_instances i on i.business_id = st.business_id and i.genix_enabled
                        where st.business_id = s.business_id and st.auto_enabled
                          and access_tier(st.business_id) = 'completo')
    returning 1
  )
  select count(*) into v_skip from x;

  for b in
    select bz.id, bz.timezone, st.eve_enabled, st.confirm_enabled, st.confirm_since,
           st.before_enabled, st.before_minutes, st.birthday_enabled
      from businesses bz
      join whatsapp_settings  st on st.business_id = bz.id and st.auto_enabled
      join whatsapp_instances i  on i.business_id  = bz.id and i.genix_enabled
     where access_tier(bz.id) = 'completo'
  loop
    v_now   := now() at time zone b.timezone;
    v_today := v_now::date;

    -- (a) linhas da fila que perderam o sentido
    with x as (
      update whatsapp_reminder_sends s
         set status = 'skipped', finished_at = now(),
             reason = case
               when (s.kind = 'confirmation' and not b.confirm_enabled)
                 or (s.kind = 'before' and not b.before_enabled)
                 or (s.kind = 'eve' and not b.eve_enabled)
                 or (s.kind = 'birthday' and not b.birthday_enabled)        then 'DESLIGADO'
               when s.kind = 'birthday' and (c.id is null or c.no_auto_reminders) then 'OPT_OUT'
               when s.kind = 'birthday'                                     then 'NUMERO_INVALIDO'
               when bk.id is null or bk.status = 'cancelled'                then 'CANCELADO'
               when bk.booking_date <> s.booking_date or bk.start_time <> s.start_time then 'REMARCADO'
               when bk.status <> 'confirmed'                                then 'NAO_CONFIRMADO'
               when s.kind = 'eve' and bk.reminder_sent_at is not null      then 'JA_LEMBRADO'
               when coalesce(bc.no_auto_reminders, false)                   then 'OPT_OUT'
               else 'NUMERO_INVALIDO'
             end
        from whatsapp_reminder_sends s0
        left join bookings  bk on bk.id = s0.booking_id
        left join customers bc on bc.id = bk.customer_id
        left join customers c  on c.id  = s0.customer_id
       where s.id = s0.id
         and s0.business_id = b.id
         and s0.status = 'queued'
         and ( (s0.kind = 'confirmation' and not b.confirm_enabled)
            or (s0.kind = 'before' and not b.before_enabled)
            or (s0.kind = 'eve' and not b.eve_enabled)
            or (s0.kind = 'birthday' and not b.birthday_enabled)
            or (s0.kind = 'birthday' and (c.id is null or c.no_auto_reminders or c.phone !~ '^\d{10,11}$'))
            or (s0.kind <> 'birthday' and (
                  bk.id is null
               or bk.status <> 'confirmed'
               or bk.booking_date <> s0.booking_date or bk.start_time <> s0.start_time
               or (s0.kind = 'eve' and bk.reminder_sent_at is not null)
               or coalesce(bc.no_auto_reminders, false)
               or normalize_phone(bk.customer_phone) !~ '^\d{10,11}$')) )
      returning 1
    )
    select count(*) into v_n from x;
    v_skip := v_skip + v_n;

    -- (b) DISPENSADA: outra mensagem do mesmo agendamento + horário saiu há menos de 6 h
    with x as (
      update whatsapp_reminder_sends s
         set status = 'skipped', reason = 'DISPENSADA', finished_at = now()
       where s.business_id = b.id
         and s.status = 'queued'
         and s.booking_id is not null
         and exists (select 1 from whatsapp_reminder_sends o
                      where o.booking_id = s.booking_id and o.kind <> s.kind
                        and o.booking_date = s.booking_date and o.start_time = s.start_time
                        and o.status = 'sent' and o.sent_at > now() - interval '6 hours')
      returning 1
    )
    select count(*) into v_n from x;
    v_skip := v_skip + v_n;

    -- (c) EXPIRADA: passou da validade sem sair (fica no histórico do agendamento)
    with x as (
      update whatsapp_reminder_sends s
         set status = 'skipped', reason = 'EXPIRADA', finished_at = now()
       where s.business_id = b.id
         and s.status = 'queued'
         and s.expires_at <= now()
      returning s.booking_id, s.kind
    ), ev as (
      insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
      select x.booking_id, b.id, 'whatsapp_auto_expired', null, 'automatico', jsonb_build_object('kind', x.kind)
        from x where x.booking_id is not null
      returning 1
    )
    select count(*) into v_n from x;
    v_exp := v_exp + v_n;

    -- (d) 2ª tentativa: falha temporária há 30 min ou mais, ainda dentro da validade
    with x as (
      insert into whatsapp_reminder_sends
        (business_id, booking_id, customer_id, kind, booking_date, start_time, attempt, variant,
         status, priority, due_at, expires_at, claimed_at)
      select s.business_id, s.booking_id, s.customer_id, s.kind, s.booking_date, s.start_time, 2, 0,
             'queued', s.priority, now(), s.expires_at, null
        from whatsapp_reminder_sends s
       where s.business_id = b.id
         and s.status = 'failed' and s.retryable and s.attempt = 1
         and s.due_at is not null
         and coalesce(s.finished_at, s.created_at) <= now() - interval '30 minutes'
         and s.expires_at > now()
      on conflict do nothing
      returning 1
    )
    select count(*) into v_n from x;
    v_queued := v_queued + v_n;

    -- (e) CONFIRMAÇÃO: 5 min depois do último "ficou confirmado" (criado
    -- confirmado, confirmado ou remarcado), levado à abertura da janela se
    -- cair fora dela; vale 2 h, nunca depois do horário.
    if b.confirm_enabled and b.confirm_since is not null then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time,
               whatsapp_window_start(a.anchor + interval '5 minutes', b.timezone) as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) as start_ts
          from bookings bk
          cross join lateral (
            select max(e.created_at) as anchor
              from booking_events e
             where e.booking_id = bk.id
               and (e.action in ('confirmed', 'rescheduled')
                    or (e.action = 'created' and e.details->>'status' = 'confirmed'))
          ) a
         where bk.business_id = b.id
           and bk.status = 'confirmed'
           and bk.booking_date between v_today and v_today + 2
           and a.anchor >= b.confirm_since
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'confirmation', c.booking_date, c.start_time, 1, 0,
               'queued', 1, c.due, least(c.due + interval '2 hours', c.start_ts), null
          from cand c
         where c.due <= now() and now() < least(c.due + interval '2 hours', c.start_ts)
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;

    -- (f) ANTES DO HORÁRIO: início − 60/90/120 min (ou na criação, se depois); vale até o início
    if b.before_enabled then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time,
               greatest(((bk.booking_date + bk.start_time) at time zone b.timezone)
                          - make_interval(mins => b.before_minutes), bk.created_at) as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) as start_ts
          from bookings bk
         where bk.business_id = b.id
           and bk.status = 'confirmed'
           and bk.booking_date between v_today and v_today + 2
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'before', c.booking_date, c.start_time, 1, 0,
               'queued', 2, c.due, c.start_ts, null
          from cand c
         where c.due <= now() and now() < c.start_ts
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;

    -- (g) VÉSPERA: 08:00 do dia anterior (ou na criação, se depois); vale até 2 h antes
    if b.eve_enabled then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time,
               greatest(((bk.booking_date - 1) + time '08:00') at time zone b.timezone, bk.created_at) as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) - interval '2 hours' as exp
          from bookings bk
         where bk.business_id = b.id
           and bk.status = 'confirmed'
           and bk.reminder_sent_at is null
           and bk.booking_date between v_today and v_today + 2
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'eve', c.booking_date, c.start_time, 1, 0,
               'queued', 3, c.due, c.exp, null
          from cand c
         where c.due <= now() and now() < c.exp
           -- o caminho antigo pode já ter criado a tentativa 1 (status sending/sent/failed)
           and not exists (select 1 from whatsapp_reminder_sends o
                            where o.booking_id = c.id and o.kind = 'eve'
                              and o.booking_date = c.booking_date and o.start_time = c.start_time)
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;

    -- (h) ANIVERSÁRIO: horário sorteado entre 08:00 e 19:00 de hoje; vale até 20:00;
    -- 1 por cliente por ano
    if b.birthday_enabled then
      with cand as (
        select c.id,
               time '08:00' + make_interval(secs => floor(random() * 11 * 3600)::int) as at_time
          from customers c
         where c.business_id = b.id
           and c.birth_date is not null
           and whatsapp_is_birthday(c.birth_date, v_today)
           and not c.no_auto_reminders
           and c.phone ~ '^\d{10,11}$'
           and not exists (select 1 from whatsapp_reminder_sends o
                            where o.customer_id = c.id and o.kind = 'birthday'
                              and extract(year from o.booking_date) = extract(year from v_today))
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, customer_id, kind, booking_date, start_time, attempt, variant,
           status, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'birthday', v_today, c.at_time, 1, 0,
               'queued', 4, (v_today + c.at_time) at time zone b.timezone,
               (v_today + time '20:00') at time zone b.timezone, null
          from cand c
         where now() < (v_today + time '20:00') at time zone b.timezone
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from x;
      v_queued := v_queued + v_n;
    end if;
  end loop;

  return json_build_object('enfileiradas', v_queued, 'expiradas', v_exp, 'descartadas', v_skip);
end;
$$;


-- =====================================================================
-- PARTE 5 — Próxima mensagem do espaço (sem gravar)
-- Mesmas travas do caminho antigo: liberação, conectado no claim, plano
-- pago, automático ligado, janela 08:00–20:00 e ritmo do número.
-- =====================================================================
create or replace function next_auto_message(p_business uuid)
returns table (send_id uuid)
language plpgsql stable security definer set search_path = public
as $$
declare
  b     businesses;
  st    whatsapp_settings;
  inst  whatsapp_instances;
  v_now timestamp;
begin
  select * into b from businesses where id = p_business;
  if not found then return; end if;
  select * into st from whatsapp_settings where business_id = b.id;
  if not found or not st.auto_enabled then return; end if;
  select * into inst from whatsapp_instances where business_id = b.id;
  if not found or not inst.genix_enabled then return; end if;
  if access_tier(b.id) <> 'completo' then return; end if;

  v_now := now() at time zone b.timezone;
  if v_now::time < time '08:00' or v_now::time >= time '20:00' then return; end if;
  if not whatsapp_number_ready(b.id) then return; end if;

  return query
  select s.id
    from whatsapp_reminder_sends s
   where s.business_id = b.id
     and s.status = 'queued'
     and s.due_at <= now()
     and s.expires_at > now()
   order by s.priority, s.due_at, s.created_at
   limit 1;
end;
$$;

create or replace function whatsapp_tick_candidates_v2()
returns table (business_id uuid, status text, status_checked_at timestamptz, has_due boolean)
language sql stable security definer set search_path = public
as $$
  select i.business_id, i.status, i.status_checked_at,
         exists (select 1 from next_auto_message(i.business_id))
    from whatsapp_instances i
   where i.genix_enabled
     and whatsapp_has_credentials(i);
$$;


-- =====================================================================
-- PARTE 6 — Reserva (código novo)
-- Reconfere a linha na hora: agendamento confirmado no mesmo dia/hora,
-- opt-out, número válido e a regra das 6 h. O que não vale mais vira
-- 'skipped' e a próxima da fila é tentada (até 5 por chamada).
-- Rodízio A → B → C só na véspera.
-- =====================================================================
create or replace function claim_auto_message(p_business uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  inst     whatsapp_instances;
  b        businesses;
  st       whatsapp_settings;
  s        whatsapp_reminder_sends;
  bk       bookings;
  c        customers;
  v_id     uuid;
  v_reason text;
  v_phone  text;
  v_tpl    text;
  v_var    smallint;
  i        int;
begin
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  select * into inst from whatsapp_instances
   where business_id = p_business and genix_enabled and status = 'connected';
  if not found then return null; end if;
  if inst.phone_number is not null
     and not pg_try_advisory_xact_lock(hashtext('whatsapp_number:' || inst.phone_number)) then
    return null;
  end if;

  select * into b  from businesses where id = p_business;
  select * into st from whatsapp_settings where business_id = p_business for update;

  for i in 1..5 loop
    select n.send_id into v_id from next_auto_message(p_business) n;
    if v_id is null then return null; end if;

    select * into s from whatsapp_reminder_sends where id = v_id and status = 'queued' for update skip locked;
    if not found then return null; end if;

    v_reason := null;
    if s.kind = 'birthday' then
      select * into c from customers where id = s.customer_id;
      if not found or c.no_auto_reminders then v_reason := 'OPT_OUT';
      elsif c.phone !~ '^\d{10,11}$' then v_reason := 'NUMERO_INVALIDO';
      elsif not st.birthday_enabled then v_reason := 'DESLIGADO';
      end if;
      v_phone := c.phone;
    else
      select * into bk from bookings where id = s.booking_id;
      if not found or bk.status = 'cancelled' then v_reason := 'CANCELADO';
      elsif bk.booking_date <> s.booking_date or bk.start_time <> s.start_time then v_reason := 'REMARCADO';
      elsif bk.status <> 'confirmed' then v_reason := 'NAO_CONFIRMADO';
      elsif s.kind = 'eve' and bk.reminder_sent_at is not null then v_reason := 'JA_LEMBRADO';
      elsif (s.kind = 'confirmation' and not st.confirm_enabled)
         or (s.kind = 'before' and not st.before_enabled)
         or (s.kind = 'eve' and not st.eve_enabled) then v_reason := 'DESLIGADO';
      elsif exists (select 1 from customers cc where cc.id = bk.customer_id and cc.no_auto_reminders) then v_reason := 'OPT_OUT';
      elsif normalize_phone(bk.customer_phone) !~ '^\d{10,11}$' then v_reason := 'NUMERO_INVALIDO';
      elsif exists (select 1 from whatsapp_reminder_sends o
                     where o.booking_id = s.booking_id and o.kind <> s.kind
                       and o.booking_date = s.booking_date and o.start_time = s.start_time
                       and o.status = 'sent' and o.sent_at > now() - interval '6 hours') then v_reason := 'DISPENSADA';
      end if;
      v_phone := normalize_phone(bk.customer_phone);
    end if;

    if v_reason is not null then
      update whatsapp_reminder_sends set status = 'skipped', reason = v_reason, finished_at = now() where id = s.id;
      continue;
    end if;

    v_var := case when s.kind = 'eve' then st.next_variant else 0 end;
    update whatsapp_reminder_sends
       set status = 'sending', claimed_at = now(), variant = v_var
     where id = s.id;
    if s.kind = 'eve' then
      update whatsapp_settings set next_variant = (next_variant + 1) % 3 where business_id = p_business;
    end if;

    v_tpl := case s.kind
               when 'confirmation' then st.template_confirm
               when 'before'       then st.template_before
               when 'birthday'     then st.template_birthday
               else case v_var when 0 then st.template_a when 1 then st.template_b else st.template_c end
             end;

    -- aniversário não tem agendamento (bk pode ter sobrado de uma volta anterior do laço)
    if s.kind = 'birthday' then
      return json_build_object(
        'send_id', s.id, 'kind', s.kind, 'attempt', s.attempt, 'variant', v_var, 'template', v_tpl,
        'phone', v_phone, 'customer_name', c.name,
        'service_name', null, 'professional_name', null, 'booking_date', null, 'start_time', null,
        'business_name', b.name
      );
    end if;
    return json_build_object(
      'send_id',           s.id,
      'kind',              s.kind,
      'attempt',           s.attempt,
      'variant',           v_var,
      'template',          v_tpl,
      'phone',             v_phone,
      'customer_name',     bk.customer_name,
      'service_name',      bk.service_name,
      'professional_name', bk.professional_name,
      'booking_date',      bk.booking_date,
      'start_time',        to_char(bk.start_time, 'HH24:MI'),
      'business_name',     b.name
    );
  end loop;
  return null;
end;
$$;


-- =====================================================================
-- PARTE 7 — Resultado (mesma assinatura e mesmo ritmo da 35)
-- Véspera: igual a hoje (reminder_sent_at + evento 'reminder').
-- Confirmação e antes do horário: evento 'whatsapp_auto' no agendamento.
-- DESCONECTADO: linha da fila volta para 'queued'; linha do caminho antigo
-- (sem due_at) é apagada, como antes.
-- =====================================================================
create or replace function finish_auto_reminder(
  p_send uuid, p_ok boolean, p_reason text default null, p_retryable boolean default false, p_message_id text default null
)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  s       whatsapp_reminder_sends;
  v_phone text;
  v_next  timestamptz;
begin
  select * into s from whatsapp_reminder_sends where id = p_send for update;
  if not found or s.status <> 'sending' then return 'IGNORADO'; end if;

  if not p_ok and p_reason = 'DESCONECTADO' then
    if s.due_at is null then
      delete from whatsapp_reminder_sends where id = s.id;
    else
      update whatsapp_reminder_sends set status = 'queued', claimed_at = null where id = s.id;
    end if;
    return 'DESCONECTADO';
  end if;

  -- ENVIADO ou FALHOU: sorteia o próximo horário livre do número (35)
  v_next := now() + make_interval(mins => 7 + floor(random() * 7)::int,
                                  secs => floor(random() * 60)::int);
  select i.phone_number into v_phone from whatsapp_instances i where i.business_id = s.business_id;
  update whatsapp_instances
     set next_send_at = v_next
   where business_id = s.business_id
      or (v_phone is not null and phone_number = v_phone);

  if not p_ok then
    update whatsapp_reminder_sends
       set status = 'failed', reason = left(coalesce(p_reason, 'ERRO'), 200),
           retryable = coalesce(p_retryable, false) and s.attempt = 1, finished_at = now()
     where id = s.id;
    return 'FALHOU';
  end if;

  update whatsapp_reminder_sends
     set status = 'sent', sent_at = now(), finished_at = now(), provider_message_id = left(p_message_id, 200)
   where id = s.id;

  if s.kind = 'eve' then
    perform set_config('genix.actor_role', 'automatico', true);
    update bookings
       set reminder_sent_at = now()
     where id = s.booking_id and status = 'confirmed'
       and booking_date = s.booking_date and start_time = s.start_time
       and reminder_sent_at is null;
    if not found then
      update whatsapp_reminder_sends set reason = 'AGENDAMENTO_MUDOU' where id = s.id;
    end if;
    perform set_config('genix.actor_role', '', true);
  elsif s.booking_id is not null then
    if not exists (select 1 from bookings bk
                    where bk.id = s.booking_id and bk.status = 'confirmed'
                      and bk.booking_date = s.booking_date and bk.start_time = s.start_time) then
      update whatsapp_reminder_sends set reason = 'AGENDAMENTO_MUDOU' where id = s.id;
    end if;
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (s.booking_id, s.business_id, 'whatsapp_auto', null, 'automatico', jsonb_build_object('kind', s.kind));
  end if;

  return 'ENVIADO';
end;
$$;

-- Reserva presa: conta pelo claimed_at (a linha da fila é criada antes)
create or replace function expire_stale_auto_reminders()
returns int
language sql volatile security definer set search_path = public
as $$
  with x as (
    update whatsapp_reminder_sends
       set status = 'failed', reason = 'INTERROMPIDO', retryable = false, finished_at = now()
     where status = 'sending' and coalesce(claimed_at, created_at) < now() - interval '15 minutes'
    returning 1
  )
  select count(*)::int from x;
$$;


-- =====================================================================
-- PARTE 8 — Caminho antigo convivendo com a fila (WHATSAPP_QUEUE_V2=0)
-- next_auto_reminder: mesmo corpo da 35, mas só olha linhas 'eve' já
-- reservadas (sending/sent/failed), conta o ritmo por claimed_at e
-- respeita eve_enabled. claim_auto_reminder: mesmo corpo da 34, mas
-- aproveita a linha 'eve' que estiver na fila (queued/skipped) em vez de
-- bater no índice único.
-- =====================================================================
create or replace function next_auto_reminder(p_business uuid)
returns table (booking_id uuid, attempt smallint)
language plpgsql stable security definer set search_path = public
as $$
declare
  b     businesses;
  st    whatsapp_settings;
  inst  whatsapp_instances;
  v_now timestamp;
  v_today date;
begin
  select * into b from businesses where id = p_business;
  if not found then return; end if;
  select * into st from whatsapp_settings where business_id = b.id;
  if not found or not st.auto_enabled or not st.eve_enabled then return; end if;
  select * into inst from whatsapp_instances where business_id = b.id;
  if not found or not inst.genix_enabled then return; end if;
  if access_tier(b.id) <> 'completo' then return; end if;

  v_now   := now() at time zone b.timezone;
  v_today := v_now::date;
  if v_now::time < time '08:00' or v_now::time >= time '20:00' then return; end if;

  if not whatsapp_number_ready(b.id) then return; end if;

  return query
  select bk.id, (case when a.n = 0 then 1 else 2 end)::smallint
    from bookings bk
    left join customers c on c.id = bk.customer_id
    cross join lateral (
      select count(*) as n,
             coalesce(bool_or(s.status in ('sending', 'sent')), false) as blocked,
             coalesce(bool_or(s.status = 'failed' and s.retryable
                              and s.created_at <= now() - interval '30 minutes'), false) as can_retry
        from whatsapp_reminder_sends s
       where s.booking_id = bk.id and s.kind = 'eve'
         and s.booking_date = bk.booking_date and s.start_time = bk.start_time
         and s.status in ('sending', 'sent', 'failed')
    ) a
   where bk.business_id = b.id
     and bk.status = 'confirmed'
     and bk.reminder_sent_at is null
     and not coalesce(c.no_auto_reminders, false)
     and normalize_phone(bk.customer_phone) ~ '^\d{10,11}$'
     and ( bk.booking_date = v_today + 1
           or (bk.booking_date = v_today and bk.booking_date + bk.start_time >= v_now + interval '2 hours') )
     and ( a.n = 0 or (a.n = 1 and not a.blocked and a.can_retry) )
   order by bk.booking_date, bk.start_time
   limit 1;
end;
$$;

create or replace function claim_auto_reminder(p_business uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_booking uuid;
  v_attempt smallint;
  bk        bookings;
  b         businesses;
  st        whatsapp_settings;
  inst      whatsapp_instances;
  v_id      uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  select * into inst from whatsapp_instances
   where business_id = p_business and genix_enabled and status = 'connected';
  if not found then return null; end if;

  if inst.phone_number is not null
     and not pg_try_advisory_xact_lock(hashtext('whatsapp_number:' || inst.phone_number)) then
    return null;
  end if;

  select n.booking_id, n.attempt into v_booking, v_attempt from next_auto_reminder(p_business) n;
  if v_booking is null then return null; end if;

  select * into bk from bookings where id = v_booking;
  select * into b  from businesses where id = p_business;
  select * into st from whatsapp_settings where business_id = p_business for update;

  -- linha 'eve' deixada pela fila nova (queued/skipped): vira a reserva
  update whatsapp_reminder_sends
     set status = 'sending', claimed_at = now(), variant = st.next_variant, reason = null, finished_at = null
   where booking_id = bk.id and kind = 'eve'
     and booking_date = bk.booking_date and start_time = bk.start_time
     and attempt = v_attempt and status in ('queued', 'skipped')
  returning id into v_id;

  if v_id is null then
    begin
      insert into whatsapp_reminder_sends (business_id, booking_id, booking_date, start_time, attempt, variant)
      values (p_business, bk.id, bk.booking_date, bk.start_time, v_attempt, st.next_variant)
      returning id into v_id;
    exception when unique_violation then
      return null;
    end;
  end if;

  update whatsapp_settings set next_variant = (next_variant + 1) % 3 where business_id = p_business;

  return json_build_object(
    'send_id',           v_id,
    'booking_id',        bk.id,
    'attempt',           v_attempt,
    'variant',           st.next_variant,
    'template',          case st.next_variant when 0 then st.template_a when 1 then st.template_b else st.template_c end,
    'phone',             normalize_phone(bk.customer_phone),
    'customer_name',     bk.customer_name,
    'service_name',      bk.service_name,
    'professional_name', bk.professional_name,
    'booking_date',      bk.booking_date,
    'start_time',        to_char(bk.start_time, 'HH24:MI'),
    'business_name',     b.name
  );
end;
$$;


-- =====================================================================
-- PARTE 9 — Painel do dono
-- whatsapp_panel_status: mesmo corpo da 34 + preferências por tipo.
-- save_whatsapp_messages: liga/desliga por tipo, minutos e textos.
--   Campos (todos obrigatórios): eve_enabled, confirm_enabled,
--   before_enabled, before_minutes (60|90|120), birthday_enabled,
--   template_confirm, template_before, template_birthday ('' = padrão).
--   confirm_since = now() quando a confirmação é ligada.
--   Erros: SEM_PERMISSAO | DADOS_INVALIDOS
-- =====================================================================
create or replace function whatsapp_panel_status(p_business uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  i  whatsapp_instances;
  st whatsapp_settings;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  select * into i  from whatsapp_instances where business_id = p_business;
  select * into st from whatsapp_settings  where business_id = p_business;
  return json_build_object(
    'genix_enabled',     coalesce(i.genix_enabled, false) and coalesce(whatsapp_has_credentials(i), false),
    'released',          coalesce(i.genix_enabled, false),
    'provider',          i.provider,
    'has_instance',      coalesce(whatsapp_has_credentials(i), false),
    'phone_number',      i.phone_number,
    'status',            coalesce(i.status, 'unknown'),
    'status_checked_at', i.status_checked_at,
    'auto_enabled',      coalesce(st.auto_enabled, false),
    'risk_accepted_at',  st.risk_accepted_at,
    'template_a',        st.template_a,
    'template_b',        st.template_b,
    'template_c',        st.template_c,
    'eve_enabled',       coalesce(st.eve_enabled, true),
    'confirm_enabled',   coalesce(st.confirm_enabled, false),
    'before_enabled',    coalesce(st.before_enabled, false),
    'before_minutes',    coalesce(st.before_minutes, 120),
    'birthday_enabled',  coalesce(st.birthday_enabled, false),
    'template_confirm',  st.template_confirm,
    'template_before',   st.template_before,
    'template_birthday', st.template_birthday
  );
end;
$$;

create or replace function save_whatsapp_messages(p_business uuid, p jsonb)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_eve      boolean := (p->>'eve_enabled')::boolean;
  v_confirm  boolean := (p->>'confirm_enabled')::boolean;
  v_before   boolean := (p->>'before_enabled')::boolean;
  v_minutes  smallint := (p->>'before_minutes')::smallint;
  v_birthday boolean := (p->>'birthday_enabled')::boolean;
  v_tc text := nullif(trim(coalesce(p->>'template_confirm', '')), '');
  v_tb text := nullif(trim(coalesce(p->>'template_before', '')), '');
  v_tn text := nullif(trim(coalesce(p->>'template_birthday', '')), '');
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if v_eve is null or v_confirm is null or v_before is null or v_birthday is null
     or v_minutes is null or v_minutes not in (60, 90, 120)
     or char_length(coalesce(v_tc, '')) > 1000 or char_length(coalesce(v_tb, '')) > 1000
     or char_length(coalesce(v_tn, '')) > 1000 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  insert into whatsapp_settings (business_id, eve_enabled, confirm_enabled, confirm_since, before_enabled,
                                 before_minutes, birthday_enabled, template_confirm, template_before, template_birthday)
  values (p_business, v_eve, v_confirm, case when v_confirm then now() end, v_before,
          v_minutes, v_birthday, v_tc, v_tb, v_tn)
  on conflict (business_id) do update set
    eve_enabled       = v_eve,
    confirm_enabled   = v_confirm,
    confirm_since     = case when v_confirm and not whatsapp_settings.confirm_enabled then now()
                             else whatsapp_settings.confirm_since end,
    before_enabled    = v_before,
    before_minutes    = v_minutes,
    birthday_enabled  = v_birthday,
    template_confirm  = v_tc,
    template_before   = v_tb,
    template_birthday = v_tn;
end;
$$;


-- =====================================================================
-- PARTE 10 — Números dos últimos 7 dias, por tipo
-- {"confirmation": {"sent", "failed", "expired", "skipped", "queued"}, ...}
-- expired = EXPIRADA (não saiu por limite/validade); skipped = outros
-- descartes (cancelado, remarcado, dispensada...); queued = na fila agora.
-- =====================================================================
create or replace function whatsapp_stats_7d(p_business uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(k.kind, jsonb_build_object(
           'sent',    coalesce(x.sent, 0),
           'failed',  coalesce(x.failed, 0),
           'expired', coalesce(x.expired, 0),
           'skipped', coalesce(x.skipped, 0),
           'queued',  coalesce(x.queued, 0))), '{}'::jsonb)
    from (values ('confirmation'), ('before'), ('eve'), ('birthday')) k(kind)
    left join lateral (
      select count(*) filter (where s.status = 'sent')                               as sent,
             count(*) filter (where s.status = 'failed')                             as failed,
             count(*) filter (where s.status = 'skipped' and s.reason = 'EXPIRADA')  as expired,
             count(*) filter (where s.status = 'skipped' and s.reason <> 'EXPIRADA') as skipped,
             count(*) filter (where s.status = 'queued')                             as queued
        from whatsapp_reminder_sends s
       where s.business_id = p_business and s.kind = k.kind
         and (s.status = 'queued' or coalesce(s.finished_at, s.sent_at, s.created_at) > now() - interval '7 days')
    ) x on true;
$$;

create or replace function whatsapp_auto_stats(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  return whatsapp_stats_7d(p_business);
end;
$$;


-- =====================================================================
-- PARTE 11 — Visão da Genix (/genix): ganha stats_7d (por tipo)
-- O tipo de retorno muda, então a função é recriada (corpo da 35).
-- O código atual ignora a coluna a mais.
-- =====================================================================
drop function if exists genix_whatsapp_overview();
create function genix_whatsapp_overview()
returns table (
  business_id uuid, name text, slug text, tier text,
  has_credentials boolean, instance_hint text, genix_enabled boolean,
  status text, status_checked_at timestamptz, auto_enabled boolean,
  sent_7d bigint, failed_7d bigint, last_reason text,
  provider text, instance_name text, phone_number text,
  next_send_at timestamptz, stats_7d jsonb
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select b.id, b.name, b.slug::text, access_tier(b.id),
         coalesce(whatsapp_has_credentials(i), false),
         case when i.instance_id is null then null else right(i.instance_id, 4) end,
         coalesce(i.genix_enabled, false),
         coalesce(i.status, 'unknown'),
         i.status_checked_at,
         coalesce(st.auto_enabled, false),
         (select count(*) from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'sent' and s.created_at > now() - interval '7 days'),
         (select count(*) from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'failed' and s.created_at > now() - interval '7 days'),
         (select s.reason from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'failed' order by s.created_at desc limit 1),
         i.provider,
         i.instance_name,
         i.phone_number,
         (select max(i2.next_send_at) from whatsapp_instances i2
           where i2.business_id = b.id
              or (i.phone_number is not null and i2.phone_number = i.phone_number)),
         case when i.business_id is null then null else whatsapp_stats_7d(b.id) end
    from businesses b
    left join whatsapp_instances i on i.business_id = b.id
    left join whatsapp_settings st on st.business_id = b.id
   where not coalesce(b.is_demo, false)
   order by (i.business_id is null), b.name;
end;
$$;


-- =====================================================================
-- PARTE 12 — Permissões
-- Relógio (service_role): refresh, candidates_v2, next/claim_auto_message.
-- Painel (authenticated): save_whatsapp_messages, whatsapp_auto_stats,
-- genix_whatsapp_overview. Apoio interno sem execução pública.
-- (create or replace mantém as permissões das funções que já existiam)
-- =====================================================================
revoke all on function whatsapp_window_start(timestamptz, text)  from public, anon, authenticated;
revoke all on function whatsapp_is_birthday(date, date)          from public, anon, authenticated;
revoke all on function whatsapp_number_ready(uuid)               from public, anon, authenticated;
revoke all on function whatsapp_stats_7d(uuid)                   from public, anon, authenticated;
revoke all on function whatsapp_queue_refresh()                  from public, anon, authenticated;
revoke all on function whatsapp_tick_candidates_v2()             from public, anon, authenticated;
revoke all on function next_auto_message(uuid)                   from public, anon, authenticated;
revoke all on function claim_auto_message(uuid)                  from public, anon, authenticated;
revoke all on function save_whatsapp_messages(uuid, jsonb)       from public, anon;
revoke all on function whatsapp_auto_stats(uuid)                 from public, anon;
revoke all on function genix_whatsapp_overview()                 from public, anon;

grant execute on function whatsapp_queue_refresh()               to service_role;
grant execute on function whatsapp_tick_candidates_v2()          to service_role;
grant execute on function next_auto_message(uuid)                to service_role;
grant execute on function claim_auto_message(uuid)               to service_role;
grant execute on function save_whatsapp_messages(uuid, jsonb)    to authenticated;
grant execute on function whatsapp_auto_stats(uuid)              to authenticated;
grant execute on function genix_whatsapp_overview()              to authenticated;

commit;


-- =====================================================================
-- CONFERÊNCIA
-- =====================================================================
-- 1) histórico preservado: todas as linhas antigas viraram 'eve' com claimed_at
select kind, status, count(*), count(claimed_at) as com_claimed_at
  from whatsapp_reminder_sends group by 1, 2 order by 1, 2;

-- 2) colunas novas das preferências (8 linhas)
select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'whatsapp_settings'
   and column_name in ('eve_enabled', 'confirm_enabled', 'confirm_since', 'before_enabled', 'before_minutes',
                       'birthday_enabled', 'template_confirm', 'template_before', 'template_birthday')
 order by 1;

-- 3) índices: os 2 únicos novos existem e o antigo saiu
select indexname from pg_indexes
 where tablename = 'whatsapp_reminder_sends' order by 1;

-- 4) permissões: funções do relógio só com service_role (e postgres)
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_name in ('whatsapp_queue_refresh', 'whatsapp_tick_candidates_v2', 'next_auto_message',
                        'claim_auto_message', 'save_whatsapp_messages', 'whatsapp_auto_stats',
                        'genix_whatsapp_overview', 'finish_auto_reminder', 'claim_auto_reminder')
 order by routine_name, grantee;

-- 5) aniversário: 29/02 em 2027 (não bissexto) conta em 28/02 → true, true, false
select whatsapp_is_birthday(date '2000-02-29', date '2027-02-28'),
       whatsapp_is_birthday(date '1990-11-11', date '2026-11-11'),
       whatsapp_is_birthday(date '2000-02-29', date '2028-02-28');

-- 6) IDEMPOTÊNCIA + TEMPO do refresh com o volume real (NÃO grava nada):
--    rode este bloco inteiro; a 2ª chamada deve devolver enfileiradas = 0.
-- begin;
--   explain (analyze, buffers) select whatsapp_queue_refresh();
--   select whatsapp_queue_refresh();
--   select kind, status, reason, count(*) from whatsapp_reminder_sends
--    where status in ('queued', 'skipped') group by 1, 2, 3 order by 1, 2, 3;
-- rollback;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- (a) Na Vercel: WHATSAPP_QUEUE_V2=0 (ou apagar) + redeploy. Com isso o
--     relógio volta ao caminho antigo, que funciona com esta migration.
--     Normalmente basta isso. Só siga abaixo para tirar a 42 do banco,
--     DEPOIS de voltar o código para a versão anterior a este PR (deploy).
--
-- (b) Conferir o que vai sair (linhas da fila e de tipos novos):
-- select kind, status, reason, count(*) from whatsapp_reminder_sends
--  where status in ('queued', 'skipped') or kind <> 'eve'
--  group by 1, 2, 3 order by 1, 2, 3;
--
-- (c) Apagar essas linhas (as 'eve' enviadas/falhas continuam no histórico):
-- begin;
-- delete from whatsapp_reminder_sends where status in ('queued', 'skipped') or kind <> 'eve';
-- delete from booking_events where action in ('whatsapp_auto', 'whatsapp_auto_expired');
-- commit;
--
-- (d) Checks e índice antigos de volta:
-- begin;
-- alter table whatsapp_reminder_sends drop constraint if exists whatsapp_reminder_sends_status_check;
-- alter table whatsapp_reminder_sends add constraint whatsapp_reminder_sends_status_check
--   check (status in ('sending', 'sent', 'failed'));
-- alter table whatsapp_reminder_sends drop constraint if exists whatsapp_reminder_sends_target_check;
-- alter table whatsapp_reminder_sends drop constraint if exists whatsapp_reminder_sends_kind_check;
-- alter table whatsapp_reminder_sends alter column booking_id set not null;
-- drop index if exists uq_whatsapp_send_booking;
-- drop index if exists uq_whatsapp_send_birthday;
-- drop index if exists idx_whatsapp_send_queue;
-- drop index if exists idx_whatsapp_send_claimed;
-- create unique index if not exists uq_whatsapp_reminder_attempt
--   on whatsapp_reminder_sends (booking_id, booking_date, start_time, attempt);
-- drop policy if exists "ve envios automaticos" on whatsapp_reminder_sends;
-- create policy "ve envios automaticos" on whatsapp_reminder_sends
--   for select to authenticated
--   using (exists (select 1 from bookings b where b.id = booking_id
--     and (sees_whole_agenda(b.business_id) or can_manage_booking(b.business_id, b.professional_id))));
-- commit;
--
-- (e) Funções de volta (cole e rode, nesta ordem):
--   • de 35_whatsapp_intervalo_variavel.sql: PARTE 2 (finish_auto_reminder),
--     PARTE 3 (next_auto_reminder) e PARTE 4 (genix_whatsapp_overview, drop +
--     create) + as 2 linhas dela na PARTE 5;
--   • de 34_whatsapp_terceiro_texto.sql: PARTE 3 (claim_auto_reminder) e
--     PARTE 4 (whatsapp_panel_status);
--   • de 23_whatsapp_automatico.sql: o bloco expire_stale_auto_reminders.
--
-- (f) Funções e colunas novas:
-- begin;
-- drop function if exists whatsapp_queue_refresh();
-- drop function if exists whatsapp_tick_candidates_v2();
-- drop function if exists claim_auto_message(uuid);
-- drop function if exists next_auto_message(uuid);
-- drop function if exists save_whatsapp_messages(uuid, jsonb);
-- drop function if exists whatsapp_auto_stats(uuid);
-- drop function if exists whatsapp_stats_7d(uuid);
-- drop function if exists whatsapp_number_ready(uuid);
-- drop function if exists whatsapp_is_birthday(date, date);
-- drop function if exists whatsapp_window_start(timestamptz, text);
-- alter table whatsapp_reminder_sends drop column if exists kind, drop column if exists customer_id,
--   drop column if exists due_at, drop column if exists expires_at, drop column if exists priority,
--   drop column if exists claimed_at;
-- alter table whatsapp_settings drop constraint if exists whatsapp_settings_before_minutes_check,
--   drop constraint if exists whatsapp_settings_new_templates_check;
-- alter table whatsapp_settings drop column if exists eve_enabled, drop column if exists confirm_enabled,
--   drop column if exists confirm_since, drop column if exists before_enabled,
--   drop column if exists before_minutes, drop column if exists birthday_enabled,
--   drop column if exists template_confirm, drop column if exists template_before,
--   drop column if exists template_birthday;
-- commit;
-- =====================================================================
