-- =====================================================================
-- 44 — Véspera com registro e regra das 6 h que adia
--
-- Aditiva: só "create or replace" de 3 funções da 42 (mesmas assinaturas,
-- os grants da 42 continuam valendo). Nenhuma tabela muda. Rodar ANTES do
-- merge (o código novo do painel manda só os campos alterados, e a versão
-- da 42 de save_whatsapp_messages exige todos).
--
--   1) whatsapp_queue_refresh
--      (b) regra das 6 h: outra mensagem do mesmo agendamento + horário saiu
--          há menos de 6 h → a linha fica na fila com due_at = 6 h depois
--          dela (levado à janela 08–20). DISPENSADA só quando esse horário
--          não cabe mais na validade (expires_at).
--      (g) véspera: due = maior(08:00 da véspera, último "ficou confirmado"
--          (criado confirmado, confirmado ou remarcado) + 5 min). Assim a
--          confirmação (prioridade 1, mesmo horário) sai primeiro e a
--          véspera não sai 1 min depois de criar o agendamento.
--          Nunca some sem registro:
--            - lembrete já marcado na fila manual (reminder_sent_at) →
--              linha 'skipped' JA_LEMBRADO;
--            - confirmado/remarcado tão perto do horário que a véspera não
--              cabe (due >= expira) → linha 'skipped' EXPIRADA + evento
--              whatsapp_auto_expired;
--            - véspera desligada continua SEM linha (decisão de produto).
--      (a0) JA_LEMBRADO volta para a fila se o lembrete manual for
--          desmarcado e a véspera ainda valer.
--   2) claim_auto_message: mesma regra das 6 h na reconferência (adia em
--      vez de descartar).
--   3) save_whatsapp_messages: aceita só os campos alterados; campo ausente
--      mantém o valor gravado (evita que uma tela desatualizada desligue
--      outro tipo, ex.: a véspera).
-- =====================================================================
begin;

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
  v_exp_n  int;
  v_skip_n int;
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

    -- (a0) véspera marcada JA_LEMBRADO cujo lembrete manual foi desmarcado:
    -- volta para a fila enquanto vale
    if b.eve_enabled then
      update whatsapp_reminder_sends s
         set status = 'queued', reason = null, finished_at = null
        from bookings bk
       where s.business_id = b.id
         and s.kind = 'eve' and s.status = 'skipped' and s.reason = 'JA_LEMBRADO'
         and s.expires_at > now()
         and bk.id = s.booking_id and bk.status = 'confirmed' and bk.reminder_sent_at is null
         and bk.booking_date = s.booking_date and bk.start_time = s.start_time;
    end if;

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

    -- (b) regra das 6 h (44): outra mensagem do mesmo agendamento + horário
    -- saiu há menos de 6 h → adia para 6 h depois dela (levado à janela);
    -- DISPENSADA só se esse horário não cabe mais na validade
    with r as (
      select s.id, s.expires_at,
             whatsapp_window_start(max(o.sent_at) + interval '6 hours', b.timezone) as new_due
        from whatsapp_reminder_sends s
        join whatsapp_reminder_sends o
          on o.booking_id = s.booking_id and o.kind <> s.kind
         and o.booking_date = s.booking_date and o.start_time = s.start_time
         and o.status = 'sent' and o.sent_at > now() - interval '6 hours'
       where s.business_id = b.id
         and s.status = 'queued'
         and s.booking_id is not null
       group by s.id, s.expires_at
    ), x as (
      update whatsapp_reminder_sends s
         set status      = case when r.new_due >= r.expires_at then 'skipped'    else s.status      end,
             reason      = case when r.new_due >= r.expires_at then 'DISPENSADA' else s.reason      end,
             finished_at = case when r.new_due >= r.expires_at then now()        else s.finished_at end,
             due_at      = case when r.new_due >= r.expires_at then s.due_at     else r.new_due     end
        from r
       where s.id = r.id
         and (r.new_due >= r.expires_at or s.due_at < r.new_due)
      returning (r.new_due >= r.expires_at) as dropped
    )
    select count(*) filter (where dropped) into v_n from x;
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

    -- (g) VÉSPERA (44): maior(08:00 do dia anterior, último "ficou confirmado"
    -- + 5 min), para a confirmação sair antes; vale até 2 h antes do horário.
    -- Nunca some sem registro: lembrete manual já marcado → JA_LEMBRADO;
    -- confirmado/remarcado perto demais do horário (não cabe) → EXPIRADA.
    if b.eve_enabled then
      with cand as (
        select bk.id, bk.booking_date, bk.start_time, bk.reminder_sent_at,
               coalesce(a.anchor, bk.created_at) as anchor,
               greatest(((bk.booking_date - 1) + time '08:00') at time zone b.timezone,
                        coalesce(a.anchor, bk.created_at) + interval '5 minutes') as due,
               ((bk.booking_date + bk.start_time) at time zone b.timezone) - interval '2 hours' as exp
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
      ), x as (
        insert into whatsapp_reminder_sends
          (business_id, booking_id, kind, booking_date, start_time, attempt, variant,
           status, reason, finished_at, priority, due_at, expires_at, claimed_at)
        select b.id, c.id, 'eve', c.booking_date, c.start_time, 1, 0,
               case when c.reminder_sent_at is not null or c.due >= c.exp then 'skipped' else 'queued' end,
               case when c.reminder_sent_at is not null then 'JA_LEMBRADO'
                    when c.due >= c.exp                 then 'EXPIRADA' end,
               case when c.reminder_sent_at is not null or c.due >= c.exp then now() end,
               3, c.due, c.exp, null
          from cand c
         where ( (c.due <= now() and now() < c.exp)       -- na hora: fila ou JA_LEMBRADO
              or (c.due >= c.exp and c.anchor < c.exp) )   -- não coube: EXPIRADA
           -- o caminho antigo pode já ter criado a tentativa 1 (status sending/sent/failed)
           and not exists (select 1 from whatsapp_reminder_sends o
                            where o.booking_id = c.id and o.kind = 'eve'
                              and o.booking_date = c.booking_date and o.start_time = c.start_time)
        on conflict do nothing
        returning booking_id, status, reason
      ), ev as (
        insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
        select x.booking_id, b.id, 'whatsapp_auto_expired', null, 'automatico', jsonb_build_object('kind', 'eve')
          from x where x.reason = 'EXPIRADA'
        returning 1
      )
      select count(*) filter (where x.status = 'queued'),
             count(*) filter (where x.reason = 'EXPIRADA'),
             count(*) filter (where x.reason = 'JA_LEMBRADO')
        into v_n, v_exp_n, v_skip_n
        from x;
      v_queued := v_queued + v_n;
      v_exp    := v_exp + v_exp_n;
      v_skip   := v_skip + v_skip_n;
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
  v_last   timestamptz;
  v_due    timestamptz;
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
      end if;
      -- regra das 6 h (44): adia para 6 h depois da última mensagem do mesmo
      -- agendamento + horário; DISPENSADA só se não cabe mais na validade
      if v_reason is null then
        select max(o.sent_at) into v_last
          from whatsapp_reminder_sends o
         where o.booking_id = s.booking_id and o.kind <> s.kind
           and o.booking_date = s.booking_date and o.start_time = s.start_time
           and o.status = 'sent' and o.sent_at > now() - interval '6 hours';
        if v_last is not null then
          v_due := whatsapp_window_start(v_last + interval '6 hours', b.timezone);
          if v_due < s.expires_at then
            update whatsapp_reminder_sends set due_at = v_due where id = s.id;
            continue;
          end if;
          v_reason := 'DISPENSADA';
        end if;
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


create or replace function save_whatsapp_messages(p_business uuid, p jsonb)
returns void
language plpgsql volatile security definer set search_path = public
as $$
-- (44) só os campos enviados mudam; campo ausente mantém o valor gravado
-- (ou o padrão da tabela, se o espaço ainda não tem linha). Um campo
-- enviado como null ou com valor inválido → DADOS_INVALIDOS.
declare
  st         whatsapp_settings;
  v_eve      boolean;
  v_confirm  boolean;
  v_before   boolean;
  v_minutes  smallint;
  v_birthday boolean;
  v_tc text;
  v_tb text;
  v_tn text;
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'DADOS_INVALIDOS'; end if;
  if exists (select 1 from jsonb_each(p) e
              where e.key in ('eve_enabled', 'confirm_enabled', 'before_enabled', 'birthday_enabled')
                and jsonb_typeof(e.value) <> 'boolean')
     or (p ? 'before_minutes' and jsonb_typeof(p->'before_minutes') <> 'number')
     or exists (select 1 from jsonb_each(p) e
                 where e.key in ('template_confirm', 'template_before', 'template_birthday')
                   and jsonb_typeof(e.value) <> 'string') then
    raise exception 'DADOS_INVALIDOS';
  end if;

  select * into st from whatsapp_settings where business_id = p_business;

  v_eve      := case when p ? 'eve_enabled'      then (p->>'eve_enabled')::boolean      else coalesce(st.eve_enabled, true)       end;
  v_confirm  := case when p ? 'confirm_enabled'  then (p->>'confirm_enabled')::boolean  else coalesce(st.confirm_enabled, false)  end;
  v_before   := case when p ? 'before_enabled'   then (p->>'before_enabled')::boolean   else coalesce(st.before_enabled, false)   end;
  v_birthday := case when p ? 'birthday_enabled' then (p->>'birthday_enabled')::boolean else coalesce(st.birthday_enabled, false) end;
  v_minutes  := case when p ? 'before_minutes'   then (p->>'before_minutes')::smallint  else coalesce(st.before_minutes, 120)     end;
  v_tc := case when p ? 'template_confirm'  then nullif(trim(p->>'template_confirm'), '')  else st.template_confirm  end;
  v_tb := case when p ? 'template_before'   then nullif(trim(p->>'template_before'), '')   else st.template_before   end;
  v_tn := case when p ? 'template_birthday' then nullif(trim(p->>'template_birthday'), '') else st.template_birthday end;

  if v_minutes not in (60, 90, 120)
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

commit;


-- =====================================================================
-- CONFERÊNCIA (só leitura, depois de rodar)
-- =====================================================================
-- 1) as 3 funções foram trocadas (o corpo novo cita "44")
--   select proname, prosrc like '%(44)%' as nova from pg_proc
--    where proname in ('whatsapp_queue_refresh', 'claim_auto_message', 'save_whatsapp_messages');
--
-- 2) grants iguais aos da 42 (refresh/claim só service_role; save para authenticated)
--   select routine_name, grantee, privilege_type from information_schema.routine_privileges
--    where routine_name in ('whatsapp_queue_refresh', 'claim_auto_message', 'save_whatsapp_messages')
--    order by 1, 2;
--
-- 3) depois de alguns minutos: vésperas adiadas pela regra das 6 h
--   select kind, booking_date, start_time, status, reason, due_at, expires_at
--     from whatsapp_reminder_sends
--    where status = 'queued' and due_at > now()
--    order by due_at;
--
-- 4) registros novos da véspera
--   select reason, count(*) from whatsapp_reminder_sends
--    where kind = 'eve' and status = 'skipped' and created_at > now() - interval '1 day'
--    group by 1;


-- =====================================================================
-- REVERSÃO (comentada)
-- Volta ao comportamento da 42: rodar de novo, no SQL Editor, os blocos
-- "create or replace function" destas 3 funções copiados da
-- 42_whatsapp_tipos_mensagem.sql (PARTE 4 whatsapp_queue_refresh, PARTE 6
-- claim_auto_message, PARTE 9 save_whatsapp_messages). Nenhum dado precisa
-- ser desfeito: linhas JA_LEMBRADO/EXPIRADA criadas pela 44 ficam no
-- histórico; linhas adiadas (queued com due_at no futuro) a 42 trata
-- normalmente (saem no horário ou viram DISPENSADA/EXPIRADA).
-- ATENÇÃO: com a 42 de volta, o painel novo (que manda só os campos
-- alterados) recebe "Não foi possível salvar as mensagens" — reverter o
-- código junto.
-- =====================================================================
