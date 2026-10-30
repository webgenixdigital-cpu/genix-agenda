-- =====================================================================
-- GENIX AGENDA — Confirmação automática dos agendamentos online
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta).
-- Reversão comentada no final (restaura as funções da 22 e da 23).
--
-- Modos por espaço (só agendamento ONLINE; manual, recorrência e
-- remarcação não mudam):
--   todos       → entra 'confirmed' (motivo 'todos')
--   recorrentes → 'confirmed' se o cliente já tem atendimento 'completed'
--                 neste espaço (motivo 'cliente_recorrente'); senão 'pending'
--   manual      → sempre 'pending' (como antes)
-- Contas existentes ficam em 'manual'; contas novas nascem em 'recorrentes'.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Modo do espaço
-- A coluna nasce com padrão 'manual' (preenche as contas existentes) e o
-- padrão muda para 'recorrentes' logo depois (vale para as contas novas,
-- sem alterar create_business_for_user).
-- online_confirm_reviewed_at: dono já escolheu o modo ou dispensou o aviso.
-- =====================================================================
alter table businesses add column if not exists online_confirm_mode text not null default 'manual';
alter table businesses drop constraint if exists online_confirm_mode_valid;
alter table businesses add constraint online_confirm_mode_valid
  check (online_confirm_mode in ('todos', 'recorrentes', 'manual'));
alter table businesses alter column online_confirm_mode set default 'recorrentes';

alter table businesses add column if not exists online_confirm_reviewed_at timestamptz;


-- =====================================================================
-- PARTE 2 — Motivo da confirmação automática no agendamento
-- Só a vitrine (create_public_booking, sem usuário logado) grava.
-- =====================================================================
alter table bookings add column if not exists auto_confirm_reason text;
alter table bookings drop constraint if exists auto_confirm_reason_valid;
alter table bookings add constraint auto_confirm_reason_valid
  check (auto_confirm_reason is null or auto_confirm_reason in ('todos', 'cliente_recorrente'));

create or replace function guard_auto_confirm_reason()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null
     and ((tg_op = 'INSERT' and new.auto_confirm_reason is not null)
          or (tg_op = 'UPDATE' and new.auto_confirm_reason is distinct from old.auto_confirm_reason)) then
    raise exception 'SEM_PERMISSAO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_auto_confirm_reason on bookings;
create trigger trg_guard_auto_confirm_reason
before insert or update of auto_confirm_reason on bookings
for each row execute function guard_auto_confirm_reason();

-- Início: "confirmados automaticamente nas últimas 24 h"
create index if not exists idx_bookings_auto_confirm_created
  on bookings (business_id, created_at) where auto_confirm_reason is not null;


-- =====================================================================
-- PARTE 3 — create_public_booking
-- Corpo IDÊNTICO ao da 22_protecao_vitrine + a regra do status
-- (marcada com "25_confirmacao_automatica") e 'status' no retorno.
-- Erros: ESTABELECIMENTO_NAO_ENCONTRADO | SERVICO_INVALIDO | DADOS_INVALIDOS
--        LIMITE_ESPACO | LIMITE_DIARIO | HORARIO_INDISPONIVEL
-- =====================================================================
create or replace function create_public_booking(
  p_slug            text,
  p_service_id      uuid,
  p_date            date,
  p_time            text,          -- 'HH:MM'
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_notes  text default null,
  p_professional_id uuid default null
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  b          businesses;
  s          services;
  p          professionals;
  ids        uuid[];
  v_phone    text;
  v_name     text;
  v_start    time;
  v_end      time;
  v_id       uuid;
  v_count    int;
  v_status   booking_status := 'pending';
  v_reason   text;
  v_customer uuid;
begin
  select * into b from businesses where slug = p_slug and is_published;
  if not found then raise exception 'ESTABELECIMENTO_NAO_ENCONTRADO'; end if;

  select * into s from services
   where id = p_service_id and business_id = b.id and active and bookable_online;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;

  v_name  := trim(coalesce(p_customer_name, ''));
  v_phone := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  if char_length(v_name) not between 2 and 80
     or char_length(v_phone) not between 10 and 11
     or char_length(coalesce(p_customer_notes, '')) > 500 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  -- limites por telefone (proteção contra robôs) — 22_protecao_vitrine
  -- trava por telefone: dois envios simultâneos não furam o limite
  perform pg_advisory_xact_lock(hashtext('public_booking:' || v_phone));

  select count(*) into v_count from bookings
   where business_id = b.id and customer_phone = v_phone
     and source = 'online' and status in ('pending', 'confirmed')
     and booking_date >= (now() at time zone b.timezone)::date;
  if v_count >= 3 then raise exception 'LIMITE_ESPACO'; end if;

  -- na plataforma toda, contando cancelados
  select count(*) into v_count from bookings
   where customer_phone = v_phone and source = 'online'
     and created_at >= now() - interval '24 hours';
  if v_count >= 5 then raise exception 'LIMITE_DIARIO'; end if;

  -- o horário ainda está livre? (mesma regra da vitrine)
  select g.professional_ids into ids
    from get_available_slots(p_slug, p_service_id, p_date, p_professional_id) g
   where g.slot_time = p_time;
  if ids is null then raise exception 'HORARIO_INDISPONIVEL'; end if;

  select * into p from professionals where id = ids[1];   -- "qualquer" = primeiro livre

  v_start := p_time::time;
  v_end   := v_start + make_interval(mins => s.duration_min);

  -- confirmação automática — 25_confirmacao_automatica
  -- recorrente: cliente do espaço (índice único business_id + phone) com
  -- pelo menos 1 atendimento concluído (índice idx_bookings_customer)
  if b.online_confirm_mode = 'todos' then
    v_status := 'confirmed';
    v_reason := 'todos';
  elsif b.online_confirm_mode = 'recorrentes' then
    select c.id into v_customer from customers c
     where c.business_id = b.id and c.phone = normalize_phone(v_phone);
    if v_customer is not null
       and exists (select 1 from bookings x where x.customer_id = v_customer and x.status = 'completed') then
      v_status := 'confirmed';
      v_reason := 'cliente_recorrente';
    end if;
  end if;

  begin
    insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
      professional_name, customer_name, customer_phone, customer_notes,
      booking_date, start_time, end_time, status, source, auto_confirm_reason)
    values (b.id, s.id, p.id, s.name, s.price, s.duration_min,
      p.name, v_name, v_phone, nullif(trim(p_customer_notes), ''),
      p_date, v_start, v_end, v_status, 'online', v_reason)
    returning id into v_id;
  exception when exclusion_violation then
    -- outra pessoa pegou o horário no mesmo instante
    raise exception 'HORARIO_INDISPONIVEL';
  end;

  return json_build_object(
    'id',                v_id,
    'business_name',     b.name,
    'business_whatsapp', b.whatsapp,
    'service_name',      s.name,
    'price',             s.price,
    'duration_min',      s.duration_min,
    'professional_name', p.name,
    'date',              p_date,
    'start_time',        to_char(v_start, 'HH24:MI'),
    'end_time',          to_char(v_end, 'HH24:MI'),
    'customer_name',     v_name,
    'status',            v_status
  );
end;
$$;

-- Permissões: só o servidor (iguais à 22)
revoke execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) to service_role;


-- =====================================================================
-- PARTE 4 — Histórico: confirmação automática aparece "pelo sistema"
-- Mesmo corpo da 23_whatsapp_automatico + no INSERT, quando já nasce
-- confirmado com motivo, um evento 'confirmed' com ator 'sistema'.
-- O evento 'created' continua com o ator de sempre ('online').
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
    -- 25_confirmacao_automatica
    if new.status = 'confirmed' and new.auto_confirm_reason is not null then
      insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
      values (new.id, new.business_id, 'confirmed', null, 'sistema',
              jsonb_build_object('reason', new.auto_confirm_reason));
    end if;
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

revoke all on function guard_auto_confirm_reason() from public, anon, authenticated;


-- =====================================================================
-- PARTE 5 — Conferência
-- 1) create_public_booking: só postgres/service_role
-- 2) espaços por modo: os existentes devem estar todos em 'manual'
-- 3) padrão da coluna: 'recorrentes'
-- =====================================================================
select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_name = 'create_public_booking';

select online_confirm_mode, count(*) from businesses group by 1;

select column_default from information_schema.columns
 where table_name = 'businesses' and column_name = 'online_confirm_mode';


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- 1) Restaure create_public_booking: cole e rode a PARTE 2 de
--    22_protecao_vitrine.sql (create or replace ... ) e, em seguida, as
--    permissões da PARTE 3 da 22:
--    revoke execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) from public, anon, authenticated;
--    grant execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) to service_role;
-- 2) Restaure log_booking_event: cole e rode a PARTE 5 de
--    23_whatsapp_automatico.sql (create or replace ... ).
-- 3) Depois:
-- drop index    if exists idx_bookings_auto_confirm_created;
-- drop trigger  if exists trg_guard_auto_confirm_reason on bookings;
-- drop function if exists guard_auto_confirm_reason();
-- alter table bookings   drop constraint if exists auto_confirm_reason_valid;
-- alter table bookings   drop column if exists auto_confirm_reason;
-- alter table businesses drop column if exists online_confirm_reviewed_at;
-- alter table businesses drop constraint if exists online_confirm_mode_valid;
-- alter table businesses drop column if exists online_confirm_mode;
-- =====================================================================
