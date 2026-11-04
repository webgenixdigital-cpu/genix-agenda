-- =====================================================================
-- GENIX AGENDA — WhatsApp automático com a Evolution API (self-hosted)
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta; as
-- funções redefinidas continuam aceitando o código atual).
-- Reversão comentada no final.
--
-- O que muda:
--   • whatsapp_instances aceita provider 'evolution' (1 instância por
--     espaço, criada pelo próprio dono pelo QR Code). O token da
--     instância fica na coluna token (sem grant para authenticated).
--   • Ritmo (>= 10 min e no máx. 6/hora) passa a valer POR NÚMERO:
--     espaços com o mesmo número conectado dividem o mesmo limite.
--   • Envio que falha por "desconectado" desfaz a reserva: o agendamento
--     continua na fila e sai quando o número reconectar.
--   • Painel do dono e /genix recebem provider, instância e número
--     (nunca o token).
-- Regras que NÃO mudam: só 'confirmed', janela 08:00–20:00 no fuso do
-- espaço (businesses.timezone), liberação da Genix (genix_enabled),
-- plano pago, opt-out do cliente.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Colunas novas
-- phone_number: número conectado no formato do normalize_phone (sem 55)
-- =====================================================================
alter table whatsapp_instances drop constraint if exists whatsapp_instances_provider_check;
alter table whatsapp_instances add constraint whatsapp_instances_provider_check
  check (provider in ('zapi', 'evolution'));

alter table whatsapp_instances add column if not exists instance_name text;
alter table whatsapp_instances add column if not exists phone_number text;

alter table whatsapp_instances drop constraint if exists whatsapp_instances_instance_name_check;
alter table whatsapp_instances add constraint whatsapp_instances_instance_name_check
  check (instance_name is null or instance_name ~ '^[a-z0-9_]{6,64}$');
alter table whatsapp_instances drop constraint if exists whatsapp_instances_phone_number_check;
alter table whatsapp_instances add constraint whatsapp_instances_phone_number_check
  check (phone_number is null or phone_number ~ '^\d{8,15}$');

create unique index if not exists uq_whatsapp_instance_name
  on whatsapp_instances (instance_name) where instance_name is not null;
create index if not exists idx_whatsapp_instances_phone
  on whatsapp_instances (phone_number) where phone_number is not null;


-- =====================================================================
-- PARTE 2 — A instância tem o que precisa para enviar?
-- Z-API: instance id + token + client-token. Evolution: nome + token.
-- =====================================================================
create or replace function whatsapp_has_credentials(i whatsapp_instances)
returns boolean
language sql immutable
as $$
  select case i.provider
           when 'evolution' then i.instance_name is not null and i.token is not null
           else i.instance_id is not null and i.token is not null and i.client_token is not null
         end;
$$;


-- =====================================================================
-- PARTE 3 — Próximo lembrete (mesmo corpo da 23, ritmo por número)
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
  if not found or not st.auto_enabled then return; end if;
  select * into inst from whatsapp_instances where business_id = b.id;
  if not found or not inst.genix_enabled then return; end if;
  if access_tier(b.id) <> 'completo' then return; end if;

  -- janela 08:00–20:00 no fuso do espaço
  v_now   := now() at time zone b.timezone;
  v_today := v_now::date;
  if v_now::time < time '08:00' or v_now::time >= time '20:00' then return; end if;

  -- ritmo POR NÚMERO: >= 10 min entre tentativas e no máx. 6 por hora (falhas contam).
  -- Conta os envios deste espaço e de qualquer outro com o mesmo número conectado.
  if exists (select 1 from whatsapp_reminder_sends s
              where s.created_at > now() - interval '10 minutes'
                and (s.business_id = b.id
                     or (inst.phone_number is not null and s.business_id in
                           (select i2.business_id from whatsapp_instances i2 where i2.phone_number = inst.phone_number)))) then
    return;
  end if;
  if (select count(*) from whatsapp_reminder_sends s
       where s.created_at > now() - interval '1 hour'
         and (s.business_id = b.id
              or (inst.phone_number is not null and s.business_id in
                    (select i2.business_id from whatsapp_instances i2 where i2.phone_number = inst.phone_number)))) >= 6 then
    return;
  end if;

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
       where s.booking_id = bk.id and s.booking_date = bk.booking_date and s.start_time = bk.start_time
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


-- =====================================================================
-- PARTE 4 — Espaços para o relógio (usa whatsapp_has_credentials)
-- =====================================================================
create or replace function whatsapp_tick_candidates()
returns table (business_id uuid, status text, status_checked_at timestamptz, has_due boolean)
language sql stable security definer set search_path = public
as $$
  select i.business_id, i.status, i.status_checked_at,
         exists (select 1 from next_auto_reminder(i.business_id))
    from whatsapp_instances i
   where i.genix_enabled
     and whatsapp_has_credentials(i);
$$;


-- =====================================================================
-- PARTE 5 — Reserva (mesmo corpo da 23 + trava por número)
-- =====================================================================
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
  -- dois relógios ao mesmo tempo não reservam juntos
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  select * into inst from whatsapp_instances
   where business_id = p_business and genix_enabled and status = 'connected';
  if not found then return null; end if;

  -- dois espaços com o mesmo número também não reservam juntos (ritmo por número)
  if inst.phone_number is not null
     and not pg_try_advisory_xact_lock(hashtext('whatsapp_number:' || inst.phone_number)) then
    return null;
  end if;

  select n.booking_id, n.attempt into v_booking, v_attempt from next_auto_reminder(p_business) n;
  if v_booking is null then return null; end if;

  select * into bk from bookings where id = v_booking;
  select * into b  from businesses where id = p_business;
  select * into st from whatsapp_settings where business_id = p_business for update;

  begin
    insert into whatsapp_reminder_sends (business_id, booking_id, booking_date, start_time, attempt, variant)
    values (p_business, bk.id, bk.booking_date, bk.start_time, v_attempt, st.next_variant)
    returning id into v_id;
  exception when unique_violation then
    return null;
  end;

  update whatsapp_settings set next_variant = 1 - next_variant where business_id = p_business;

  return json_build_object(
    'send_id',           v_id,
    'booking_id',        bk.id,
    'attempt',           v_attempt,
    'variant',           st.next_variant,
    'template',          case when st.next_variant = 0 then st.template_a else st.template_b end,
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
-- PARTE 6 — Resultado do envio (mesmo corpo da 23 + DESCONECTADO)
-- DESCONECTADO: a mensagem não saiu. A reserva é desfeita para o
-- agendamento continuar na fila (não gasta tentativa nem conta no ritmo).
-- =====================================================================
create or replace function finish_auto_reminder(
  p_send uuid, p_ok boolean, p_reason text default null, p_retryable boolean default false, p_message_id text default null
)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  s whatsapp_reminder_sends;
begin
  select * into s from whatsapp_reminder_sends where id = p_send for update;
  if not found or s.status <> 'sending' then return 'IGNORADO'; end if;

  if not p_ok and p_reason = 'DESCONECTADO' then
    delete from whatsapp_reminder_sends where id = s.id;
    return 'DESCONECTADO';
  end if;

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

  return 'ENVIADO';
end;
$$;


-- =====================================================================
-- PARTE 7 — Painel do dono (sem token)
-- genix_enabled mantém o sentido antigo (liberado E com credenciais),
-- usado pelo aviso de desconexão no layout. released = só a liberação.
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
    'template_b',        st.template_b
  );
end;
$$;


-- =====================================================================
-- PARTE 8 — Visão da Genix (/genix): ganha provider, instância e número
-- O tipo de retorno muda, então a função é recriada.
-- =====================================================================
drop function if exists genix_whatsapp_overview();
create function genix_whatsapp_overview()
returns table (
  business_id uuid, name text, slug text, tier text,
  has_credentials boolean, instance_hint text, genix_enabled boolean,
  status text, status_checked_at timestamptz, auto_enabled boolean,
  sent_7d bigint, failed_7d bigint, last_reason text,
  provider text, instance_name text, phone_number text
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
         i.phone_number
    from businesses b
    left join whatsapp_instances i on i.business_id = b.id
    left join whatsapp_settings st on st.business_id = b.id
   where not coalesce(b.is_demo, false)
   order by (i.business_id is null), b.name;
end;
$$;


-- =====================================================================
-- PARTE 9 — Permissões
-- =====================================================================
revoke all on function whatsapp_has_credentials(whatsapp_instances) from public, anon, authenticated;
grant execute on function whatsapp_has_credentials(whatsapp_instances) to service_role;

revoke all on function genix_whatsapp_overview() from public, anon;
grant execute on function genix_whatsapp_overview() to authenticated;

-- (create or replace mantém as permissões das funções da 23)


-- =====================================================================
-- PARTE 10 — Conferência
-- 1) provider aceita 'evolution'; 2) colunas novas; 3) funções do relógio
--    continuam só com postgres/service_role.
-- =====================================================================
select pg_get_constraintdef(oid) from pg_constraint where conname = 'whatsapp_instances_provider_check';
select column_name from information_schema.columns
 where table_name = 'whatsapp_instances' and column_name in ('instance_name', 'phone_number');
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_name in ('claim_auto_reminder', 'finish_auto_reminder', 'next_auto_reminder',
                        'whatsapp_tick_candidates', 'whatsapp_has_credentials')
 order by routine_name, grantee;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; ANTES, volte o código para a
-- versão sem a Evolution e faça o deploy)
-- 1) Cole e rode, de 23_whatsapp_automatico.sql, os blocos
--    create or replace das PARTES 6, 7, 8, 9 e 10
--    (next_auto_reminder, whatsapp_tick_candidates, claim_auto_reminder,
--    finish_auto_reminder, whatsapp_panel_status).
-- 2) Depois:
-- drop function if exists genix_whatsapp_overview();
--    → cole e rode a PARTE 11 de 23_whatsapp_automatico.sql e as linhas de
--      genix_whatsapp_overview da PARTE 12 (revoke/grant).
-- 3) Por fim:
-- drop function if exists whatsapp_has_credentials(whatsapp_instances);
-- drop index if exists idx_whatsapp_instances_phone;
-- drop index if exists uq_whatsapp_instance_name;
-- alter table whatsapp_instances drop constraint if exists whatsapp_instances_phone_number_check;
-- alter table whatsapp_instances drop constraint if exists whatsapp_instances_instance_name_check;
-- alter table whatsapp_instances drop column if exists phone_number;
-- alter table whatsapp_instances drop column if exists instance_name;
-- -- só se existirem linhas da Evolution (apaga essas instâncias; confira antes):
-- -- delete from whatsapp_instances where provider = 'evolution';
-- alter table whatsapp_instances drop constraint if exists whatsapp_instances_provider_check;
-- alter table whatsapp_instances add constraint whatsapp_instances_provider_check check (provider in ('zapi'));
-- =====================================================================
