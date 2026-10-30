-- =====================================================================
-- GENIX AGENDA — Lembretes automáticos no WhatsApp (Z-API, beta, Completo)
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta).
-- O relógio (pg_cron) fica em supabase/manual/whatsapp-cron.sql e roda
-- DEPOIS do deploy e das variáveis na Vercel.
-- Reversão comentada no final.
--
-- Regras (decididas pelo produto):
--   • só agendamentos 'confirmed'; 1 lembrete por agendamento + data/hora
--   • a partir das 08:00 da véspera; se não couber até 20:00, no próprio dia
--     a partir das 08:00, só se o atendimento for >= 2 h depois do envio
--   • ritmo por espaço: >= 10 min entre tentativas e no máx. 6 por hora
--   • 1 nova tentativa (>= 30 min depois) só para falha passageira
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Instância do WhatsApp de cada espaço (credenciais da Genix)
-- Ninguém do espaço lê esta tabela: só o servidor (service_role).
-- =====================================================================
create table if not exists whatsapp_instances (
  business_id       uuid primary key references businesses(id) on delete cascade,
  provider          text not null default 'zapi' check (provider in ('zapi')),
  instance_id       text,
  token             text,
  client_token      text,
  genix_enabled     boolean not null default false,
  status            text not null default 'unknown' check (status in ('unknown', 'connected', 'disconnected')),
  status_checked_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_whatsapp_instances_updated on whatsapp_instances;
create trigger trg_whatsapp_instances_updated before update on whatsapp_instances
  for each row execute function set_updated_at();

alter table whatsapp_instances enable row level security;   -- sem policies: membros não leem nada
revoke all on whatsapp_instances from public, anon, authenticated;
grant all on whatsapp_instances to service_role;


-- =====================================================================
-- PARTE 2 — Preferências do espaço (a matriz lê; escreve só pelas funções)
-- next_variant: 0 = texto A, 1 = texto B (alterna a cada envio)
-- =====================================================================
create table if not exists whatsapp_settings (
  business_id      uuid primary key references businesses(id) on delete cascade,
  auto_enabled     boolean not null default false,
  template_a       text check (template_a is null or char_length(template_a) <= 1000),
  template_b       text check (template_b is null or char_length(template_b) <= 1000),
  risk_accepted_by uuid references auth.users(id) on delete set null,
  risk_accepted_at timestamptz,
  next_variant     smallint not null default 0 check (next_variant in (0, 1)),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_whatsapp_settings_updated on whatsapp_settings;
create trigger trg_whatsapp_settings_updated before update on whatsapp_settings
  for each row execute function set_updated_at();

alter table whatsapp_settings enable row level security;
revoke all on whatsapp_settings from public, anon, authenticated;
grant select on whatsapp_settings to authenticated;
grant all on whatsapp_settings to service_role;

drop policy if exists "matriz ve whatsapp" on whatsapp_settings;
create policy "matriz ve whatsapp" on whatsapp_settings
  for select to authenticated using (coalesce(member_role_of(business_id) in ('owner', 'viewer'), false));


-- =====================================================================
-- PARTE 3 — Registro de cada tentativa (idempotência)
-- attempt 1 e 2 no máximo por agendamento + data/hora
-- =====================================================================
create table if not exists whatsapp_reminder_sends (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  booking_id          uuid not null references bookings(id) on delete cascade,
  booking_date        date not null,
  start_time          time not null,
  attempt             smallint not null default 1 check (attempt in (1, 2)),
  variant             smallint not null check (variant in (0, 1)),
  status              text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  reason              text,
  retryable           boolean not null default false,
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  finished_at         timestamptz
);

create unique index if not exists uq_whatsapp_reminder_attempt
  on whatsapp_reminder_sends (booking_id, booking_date, start_time, attempt);
create index if not exists idx_whatsapp_reminder_business
  on whatsapp_reminder_sends (business_id, created_at desc);

alter table whatsapp_reminder_sends enable row level security;
revoke all on whatsapp_reminder_sends from public, anon, authenticated;
grant select on whatsapp_reminder_sends to authenticated;
grant all on whatsapp_reminder_sends to service_role;

drop policy if exists "ve envios automaticos" on whatsapp_reminder_sends;
create policy "ve envios automaticos" on whatsapp_reminder_sends
  for select to authenticated
  using (exists (
    select 1 from bookings b
    where b.id = booking_id
      and (sees_whole_agenda(b.business_id) or can_manage_booking(b.business_id, b.professional_id))
  ));


-- =====================================================================
-- PARTE 4 — Cliente que não quer lembrete automático
-- Só matriz e recepção mudam este campo (o profissional edita clientes,
-- mas não esta opção).
-- =====================================================================
alter table customers add column if not exists no_auto_reminders boolean not null default false;

create or replace function guard_customer_auto_reminders()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.no_auto_reminders is distinct from old.no_auto_reminders
     and auth.uid() is not null
     and coalesce(member_role_of(new.business_id) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_customer_auto_reminders on customers;
create trigger trg_guard_customer_auto_reminders
before update of no_auto_reminders on customers
for each row execute function guard_customer_auto_reminders();


-- =====================================================================
-- PARTE 5 — Histórico: envio automático aparece como "automatico"
-- Mesmo corpo da 14_clientes (nenhuma migration posterior a redefiniu);
-- só o v_role passa a respeitar genix.actor_role.
-- =====================================================================
create or replace function log_booking_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text := coalesce(
                    nullif(current_setting('genix.actor_role', true), ''),
                    case when auth.uid() is null then 'online' else coalesce(member_role_of(new.business_id), 'sistema') end);
begin
  if tg_op = 'INSERT' then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, 'created', v_actor, v_role,
            jsonb_build_object('source', new.source, 'status', new.status,
                               'date', new.booking_date, 'time', to_char(new.start_time, 'HH24:MI'),
                               'professional', new.professional_name));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, new.status::text, v_actor, v_role, jsonb_build_object('from', old.status));
  end if;

  if new.booking_date is distinct from old.booking_date
     or new.start_time is distinct from old.start_time
     or new.professional_id is distinct from old.professional_id then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, 'rescheduled', v_actor, v_role,
            jsonb_build_object(
              'from', jsonb_build_object('date', old.booking_date, 'time', to_char(old.start_time, 'HH24:MI'), 'professional', old.professional_name),
              'to',   jsonb_build_object('date', new.booking_date, 'time', to_char(new.start_time, 'HH24:MI'), 'professional', new.professional_name)));
  end if;

  if new.reminder_sent_at is not null and old.reminder_sent_at is null then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role)
    values (new.id, new.business_id, 'reminder', v_actor, v_role);
  end if;

  return new;
end;
$$;


-- =====================================================================
-- PARTE 6 — Próximo lembrete do espaço (regras de janela, ritmo e fila)
-- Não olha a conexão da instância (quem chama decide).
-- Devolve 0 ou 1 linha.
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

  -- ritmo: >= 10 min entre tentativas e no máx. 6 por hora (falhas contam)
  if exists (select 1 from whatsapp_reminder_sends s
              where s.business_id = b.id and s.created_at > now() - interval '10 minutes') then
    return;
  end if;
  if (select count(*) from whatsapp_reminder_sends s
       where s.business_id = b.id and s.created_at > now() - interval '1 hour') >= 6 then
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
-- PARTE 7 — Espaços para o relógio olhar (cada 5 min)
-- has_due: existe lembrete pronto para sair agora (exceto conexão)
-- =====================================================================
create or replace function whatsapp_tick_candidates()
returns table (business_id uuid, status text, status_checked_at timestamptz, has_due boolean)
language sql stable security definer set search_path = public
as $$
  select i.business_id, i.status, i.status_checked_at,
         exists (select 1 from next_auto_reminder(i.business_id))
    from whatsapp_instances i
   where i.genix_enabled
     and i.instance_id is not null and i.token is not null and i.client_token is not null;
$$;


-- =====================================================================
-- PARTE 8 — Reservar o envio (reconfere tudo no mesmo instante)
-- Devolve null (nada a enviar) ou os dados da mensagem.
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
  v_id      uuid;
begin
  -- dois relógios ao mesmo tempo não reservam juntos
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  if not exists (select 1 from whatsapp_instances
                  where business_id = p_business and genix_enabled and status = 'connected') then
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
-- PARTE 9 — Resultado do envio
-- Sucesso: preenche reminder_sent_at (sai da fila manual) só se o
-- agendamento ainda for o mesmo. Falha: registra o motivo.
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

-- Reserva que ficou presa (processo caiu no meio): vira falha definitiva.
-- Não tenta de novo porque não dá para saber se a mensagem saiu.
create or replace function expire_stale_auto_reminders()
returns int
language sql volatile security definer set search_path = public
as $$
  with x as (
    update whatsapp_reminder_sends
       set status = 'failed', reason = 'INTERROMPIDO', retryable = false, finished_at = now()
     where status = 'sending' and created_at < now() - interval '15 minutes'
    returning 1
  )
  select count(*)::int from x;
$$;


-- =====================================================================
-- PARTE 10 — Painel do espaço (sem credenciais)
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
    'genix_enabled',     coalesce(i.genix_enabled, false)
                         and i.instance_id is not null and i.token is not null and i.client_token is not null,
    'status',            coalesce(i.status, 'unknown'),
    'status_checked_at', i.status_checked_at,
    'auto_enabled',      coalesce(st.auto_enabled, false),
    'risk_accepted_at',  st.risk_accepted_at,
    'template_a',        st.template_a,
    'template_b',        st.template_b
  );
end;
$$;

-- Liga/desliga (só a matriz, plano Completo, liberado pela Genix)
-- Erros: SEM_PERMISSAO | PLANO_GRATIS | NAO_HABILITADO | ACEITE_OBRIGATORIO
create or replace function set_whatsapp_auto(p_business uuid, p_enabled boolean, p_accept_risk boolean default false)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;

  if p_enabled then
    if access_tier(p_business) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
    if not exists (select 1 from whatsapp_instances where business_id = p_business and genix_enabled) then
      raise exception 'NAO_HABILITADO';
    end if;
    if not coalesce(p_accept_risk, false) then raise exception 'ACEITE_OBRIGATORIO'; end if;

    insert into whatsapp_settings (business_id, auto_enabled, risk_accepted_by, risk_accepted_at)
    values (p_business, true, auth.uid(), now())
    on conflict (business_id) do update
      set auto_enabled = true, risk_accepted_by = auth.uid(), risk_accepted_at = now();
  else
    insert into whatsapp_settings (business_id, auto_enabled) values (p_business, false)
    on conflict (business_id) do update set auto_enabled = false;
  end if;
end;
$$;

-- Textos A/B (vazio = texto padrão). Erros: SEM_PERMISSAO | DADOS_INVALIDOS
create or replace function save_whatsapp_templates(p_business uuid, p_a text, p_b text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_a text := nullif(trim(coalesce(p_a, '')), '');
  v_b text := nullif(trim(coalesce(p_b, '')), '');
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if char_length(coalesce(v_a, '')) > 1000 or char_length(coalesce(v_b, '')) > 1000 then raise exception 'DADOS_INVALIDOS'; end if;

  insert into whatsapp_settings (business_id, template_a, template_b) values (p_business, v_a, v_b)
  on conflict (business_id) do update set template_a = v_a, template_b = v_b;
end;
$$;


-- =====================================================================
-- PARTE 11 — Visão da Genix (/genix): sem credenciais, só se há cadastro
-- =====================================================================
create or replace function genix_whatsapp_overview()
returns table (
  business_id uuid, name text, slug text, tier text,
  has_credentials boolean, instance_hint text, genix_enabled boolean,
  status text, status_checked_at timestamptz, auto_enabled boolean,
  sent_7d bigint, failed_7d bigint, last_reason text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select b.id, b.name, b.slug::text, access_tier(b.id),
         (i.instance_id is not null and i.token is not null and i.client_token is not null),
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
           where s.business_id = b.id and s.status = 'failed' order by s.created_at desc limit 1)
    from businesses b
    left join whatsapp_instances i on i.business_id = b.id
    left join whatsapp_settings st on st.business_id = b.id
   where not coalesce(b.is_demo, false)
   order by (i.business_id is null), b.name;
end;
$$;


-- =====================================================================
-- PARTE 12 — Permissões das funções
-- =====================================================================
revoke all on function next_auto_reminder(uuid)                                  from public, anon, authenticated;
revoke all on function whatsapp_tick_candidates()                                from public, anon, authenticated;
revoke all on function claim_auto_reminder(uuid)                                 from public, anon, authenticated;
revoke all on function finish_auto_reminder(uuid, boolean, text, boolean, text)  from public, anon, authenticated;
revoke all on function expire_stale_auto_reminders()                             from public, anon, authenticated;
grant execute on function next_auto_reminder(uuid)                                 to service_role;
grant execute on function whatsapp_tick_candidates()                               to service_role;
grant execute on function claim_auto_reminder(uuid)                                to service_role;
grant execute on function finish_auto_reminder(uuid, boolean, text, boolean, text) to service_role;
grant execute on function expire_stale_auto_reminders()                            to service_role;

revoke all on function whatsapp_panel_status(uuid)                  from public, anon;
revoke all on function set_whatsapp_auto(uuid, boolean, boolean)    from public, anon;
revoke all on function save_whatsapp_templates(uuid, text, text)    from public, anon;
revoke all on function genix_whatsapp_overview()                    from public, anon;
revoke all on function guard_customer_auto_reminders()              from public, anon, authenticated;
grant execute on function whatsapp_panel_status(uuid)               to authenticated;
grant execute on function set_whatsapp_auto(uuid, boolean, boolean) to authenticated;
grant execute on function save_whatsapp_templates(uuid, text, text) to authenticated;
grant execute on function genix_whatsapp_overview()                 to authenticated;


-- =====================================================================
-- PARTE 13 — Conferência
-- Deve listar só postgres/service_role para as funções do relógio.
-- =====================================================================
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_name in ('claim_auto_reminder', 'finish_auto_reminder', 'next_auto_reminder',
                        'whatsapp_tick_candidates', 'expire_stale_auto_reminders')
 order by routine_name, grantee;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- 0) Se o relógio já foi criado: select cron.unschedule('whatsapp-tick');
-- 1) Restaure log_booking_event com o texto da PARTE 5 de 14_clientes.sql
--    (cole e rode aquele bloco create or replace ... ).
-- 2) Depois:
-- drop function if exists genix_whatsapp_overview();
-- drop function if exists save_whatsapp_templates(uuid, text, text);
-- drop function if exists set_whatsapp_auto(uuid, boolean, boolean);
-- drop function if exists whatsapp_panel_status(uuid);
-- drop function if exists expire_stale_auto_reminders();
-- drop function if exists finish_auto_reminder(uuid, boolean, text, boolean, text);
-- drop function if exists claim_auto_reminder(uuid);
-- drop function if exists whatsapp_tick_candidates();
-- drop function if exists next_auto_reminder(uuid);
-- drop trigger  if exists trg_guard_customer_auto_reminders on customers;
-- drop function if exists guard_customer_auto_reminders();
-- alter table customers drop column if exists no_auto_reminders;
-- drop table if exists whatsapp_reminder_sends;
-- drop table if exists whatsapp_settings;
-- drop table if exists whatsapp_instances;
-- =====================================================================
