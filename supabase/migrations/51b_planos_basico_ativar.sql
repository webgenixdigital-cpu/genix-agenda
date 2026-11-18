-- =====================================================================
-- GENIX AGENDA — 51: Plano Básico + Grátis de 6 meses (PARTE B)
-- ⚠️ Rodar DEPOIS do deploy do código novo (e depois da 51a).
-- Ela tira do Grátis recursos que o código antigo ainda oferece
-- (encaixe, encaixe sobreposto, fila manual de véspera): por isso vem
-- depois do deploy. Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   • ativa o Básico na tela de preços;
--   • preços novos: Profissional 62,70/627,00; Equipe 121,70/1.217,00;
--     extra do Equipe 18,70/mês e 187,00/ano (estamos sem assinantes
--     reais: o preço muda no próprio plano);
--   • contas que já existem: Grátis vale 6 meses a partir de agora
--     (só quem ainda não tem data; contas novas já nascem com a data);
--   • travas novas a partir do Básico: encaixe (horário fora da lista),
--     encaixe sobreposto (no novo agendamento e no remarcar) e fila manual
--     de véspera.
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Planos e preços
-- =====================================================================
update plans set active = true where id in ('basico_mensal', 'basico_anual');

update plans set base_price =   62.70 where id = 'profissional_mensal';
update plans set base_price =  627.00 where id = 'profissional_anual';
update plans set base_price =  121.70, extra_professional_price =  18.70 where id = 'equipe_mensal';
update plans set base_price = 1217.00, extra_professional_price = 187.00 where id = 'equipe_anual';


-- =====================================================================
-- PARTE 2 — Grátis de 6 meses para as contas que já existem
-- =====================================================================
update subscriptions set free_ends_at = now() + interval '6 months' where free_ends_at is null;


-- =====================================================================
-- PARTE 3 — A partir do Básico
-- 3.1 Encaixe: no Grátis, agendamento manual só nos horários da lista
--     (manual_booking_slots da 47: expediente, passo, bloqueios,
--     ocupados, "faz o serviço"). Relógio/service role (sem usuário)
--     não passam por aqui. O encaixe sobreposto tem trava própria (3.2).
-- =====================================================================
create or replace function guard_manual_booking_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.source in ('manual', 'whatsapp')
     and not coalesce(new.overlay, false)
     and auth.uid() is not null
     and not plan_allows(new.business_id, 'basico')
     and not exists (
       select 1 from manual_booking_slots(new.business_id, new.service_id, new.booking_date) m
        where m.slot_time = to_char(new.start_time, 'HH24:MI')
          and new.professional_id = any(m.professional_ids)
     ) then
    raise exception 'PLANO_BASICO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_manual_booking_plan on bookings;
create trigger trg_guard_manual_booking_plan
before insert on bookings
for each row execute function guard_manual_booking_plan();

-- 3.2 Encaixe sobreposto (corpos da 50 + checagem do plano)
create or replace function create_overlay_booking(
  p_business uuid, p_service uuid, p_professional uuid, p_date date, p_time text,
  p_customer_name text, p_customer_phone text, p_customer_country text default '55',
  p_notes text default null, p_package uuid default null
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  s       services;
  p       professionals;
  v_start time;
  v_endm  int;
  v_name  text := btrim(coalesce(p_customer_name, ''));
  v_ctry  text := coalesce(nullif(regexp_replace(coalesce(p_customer_country, ''), '\D', '', 'g'), ''), '55');
  v_issue text;
  v_id    uuid;
begin
  if member_role_of(p_business) is null then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(p_business, 'basico') then raise exception 'PLANO_BASICO'; end if;   -- 51
  if p_date is null or p_time is null or p_time !~ '^\d{2}:\d{2}$'
     or char_length(v_name) < 2 or not phone_is_valid(v_ctry, p_customer_phone) then
    raise exception 'DADOS_INVALIDOS';
  end if;
  v_start := p_time::time;

  select * into s from services where id = p_service and business_id = p_business;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  select * into p from professionals where id = p_professional and business_id = p_business;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;

  -- mesma trava do gatilho (profissional + data): conferir e gravar sem corrida
  perform pg_advisory_xact_lock(hashtextextended('genix.agenda:' || p.id || ':' || p_date, 0));

  v_issue := overlay_slot_issue(p_business, s.id, p.id, p_date, v_start, s.duration_min, null);
  if v_issue is not null then raise exception '%', v_issue; end if;

  v_endm := extract(hour from v_start)::int * 60 + extract(minute from v_start)::int + s.duration_min;

  perform set_config('genix.overlay_edit', '1', true);
  insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
                        professional_name, customer_name, customer_phone, customer_phone_country,
                        customer_notes, booking_date, start_time, end_time, status, source,
                        customer_package_id, overlay)
  values (p_business, s.id, p.id, s.name, s.price, s.duration_min,
          p.name, v_name, p_customer_phone, v_ctry,
          nullif(btrim(coalesce(p_notes, '')), ''), p_date, v_start,
          make_time(v_endm / 60 % 24, v_endm % 60, 0), 'confirmed', 'manual',
          p_package, true)
  returning id into v_id;
  perform set_config('genix.overlay_edit', '', true);

  -- histórico: marca o "criado" como encaixe sobreposto
  update booking_events set details = coalesce(details, '{}'::jsonb) || '{"overlay": true}'::jsonb
   where booking_id = v_id and action = 'created';

  return v_id;
end;
$$;
create or replace function reschedule_overlay(
  p_booking uuid, p_professional uuid, p_date date, p_time text
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  p       professionals;
  v_start time;
  v_endm  int;
  v_issue text;
  v_tz    text;
begin
  if p_date is null or p_time is null or p_time !~ '^\d{2}:\d{2}$' then raise exception 'DADOS_INVALIDOS'; end if;
  v_start := p_time::time;

  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;
  if not plan_allows(bk.business_id, 'basico') then raise exception 'PLANO_BASICO'; end if;   -- 51

  -- o agendamento atual: matriz, ou o profissional dono dele
  if overlay_slot_issue(bk.business_id, null, bk.professional_id, bk.booking_date, bk.start_time, 1, bk.id)
     = 'SEM_PERMISSAO' then
    raise exception 'SEM_PERMISSAO';
  end if;

  select * into p from professionals where id = p_professional and business_id = bk.business_id;
  if not found then raise exception 'PROFISSIONAL_INDISPONIVEL'; end if;

  -- outro profissional precisa fazer também os serviços adicionais (como no reschedule_booking)
  if p.id <> bk.professional_id and exists (
    select 1 from booking_items i
     where i.booking_id = bk.id and i.position > 0 and i.service_id is not null
       and not professional_does_service(p.id, i.service_id)
  ) then
    raise exception 'PROFISSIONAL_NAO_FAZ';
  end if;

  select coalesce(timezone, 'America/Sao_Paulo') into v_tz from businesses where id = bk.business_id;
  if (p_date + v_start) <= (now() at time zone v_tz) then raise exception 'PASSADO'; end if;

  perform pg_advisory_xact_lock(hashtextextended('genix.agenda:' || p.id || ':' || p_date, 0));

  v_issue := overlay_slot_issue(bk.business_id, bk.service_id, p.id, p_date, v_start, bk.duration_min, bk.id);
  if v_issue is not null then raise exception '%', v_issue; end if;

  v_endm := extract(hour from v_start)::int * 60 + extract(minute from v_start)::int + bk.duration_min;

  perform set_config('genix.overlay_edit', '1', true);
  update bookings
     set booking_date      = p_date,
         start_time        = v_start,
         end_time          = make_time(v_endm / 60 % 24, v_endm % 60, 0),
         professional_id   = p.id,
         professional_name = p.name,
         overlay           = true,
         reminder_sent_at  = case when p_date is distinct from bk.booking_date or v_start is distinct from bk.start_time
                                  then null else reminder_sent_at end
   where id = bk.id;
  perform set_config('genix.overlay_edit', '', true);

  update booking_events set details = coalesce(details, '{}'::jsonb) || '{"overlay": true}'::jsonb
   where id = (select id from booking_events
                where booking_id = bk.id and action = 'rescheduled'
                order by created_at desc limit 1);

  return json_build_object('ok', true, 'date', p_date, 'time', to_char(v_start, 'HH24:MI'), 'professional', p.name);
end;
$$;

-- 3.3 Remarcar com encaixe (corpo da 31 + checagem do plano; remarcar comum continua livre)
create or replace function reschedule_booking(
  p_booking uuid, p_professional uuid, p_date date, p_time text, p_fit boolean default false
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk     bookings;
  p      professionals;
  v_time time;
  v_endm int;
  v_end  time;
  v_issue text;
begin
  if p_time is null or p_time !~ '^\d{2}:\d{2}$' or p_date is null then raise exception 'DADOS_INVALIDOS'; end if;
  v_time := p_time::time;

  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;

  -- precisa poder mexer no agendamento atual E na agenda de destino
  -- (profissional: só dentro da própria agenda)
  if not can_manage_booking(bk.business_id, bk.professional_id)
     or not can_manage_booking(bk.business_id, p_professional) then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_fit and coalesce(member_role_of(bk.business_id) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_fit and not plan_allows(bk.business_id, 'basico') then raise exception 'PLANO_BASICO'; end if;   -- 51

  select * into p from professionals where id = p_professional and business_id = bk.business_id;
  if not found then raise exception 'PROFISSIONAL_INDISPONIVEL'; end if;

  -- 31_editar_agendamento: o novo profissional faz também os adicionais
  if p.id <> bk.professional_id and exists (
    select 1 from booking_items i
     where i.booking_id = bk.id and i.position > 0 and i.service_id is not null
       and not professional_does_service(p.id, i.service_id)
  ) then
    raise exception 'PROFISSIONAL_INDISPONIVEL';
  end if;

  v_issue := booking_slot_issue_except(bk.business_id, p_professional, bk.service_id, p_date, v_time,
                                       bk.id, bk.duration_min, p_fit);
  if v_issue is not null then raise exception '%', v_issue; end if;

  v_endm := extract(hour from v_time)::int * 60 + extract(minute from v_time)::int + bk.duration_min;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  begin
    update bookings
       set booking_date      = p_date,
           start_time        = v_time,
           end_time          = v_end,
           professional_id   = p.id,
           professional_name = p.name,
           -- data/hora mudou: o lembrete volta para a fila
           reminder_sent_at  = case when p_date is distinct from bk.booking_date or v_time is distinct from bk.start_time
                                    then null else reminder_sent_at end
     where id = bk.id;
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  return json_build_object('ok', true, 'date', p_date, 'time', to_char(v_time, 'HH24:MI'), 'professional', p.name);
end;
$$;

-- 3.4 Fila manual de véspera: marcar "lembrado" e salvar os textos.
--     Desmarcar (voltar a null) continua livre: remarcar e reabrir limpam.
create or replace function guard_reminder_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.reminder_sent_at is not null and old.reminder_sent_at is null
     and auth.uid() is not null
     and not plan_allows(new.business_id, 'basico') then
    raise exception 'PLANO_BASICO';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_reminder_plan on bookings;
create trigger trg_guard_reminder_plan
before update of reminder_sent_at on bookings
for each row execute function guard_reminder_plan();

create or replace function save_manual_reminder_texts(p_business uuid, p_tomorrow text, p_today text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_tomorrow text := nullif(trim(coalesce(p_tomorrow, '')), '');
  v_today    text := nullif(trim(coalesce(p_today, '')), '');
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if not plan_allows(p_business, 'basico') then raise exception 'PLANO_BASICO'; end if;   -- 51
  if char_length(coalesce(v_tomorrow, '')) > 1000 or char_length(coalesce(v_today, '')) > 1000 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  insert into manual_reminder_texts (business_id, text_tomorrow, text_today, updated_by)
  values (p_business, v_tomorrow, v_today, auth.uid())
  on conflict (business_id) do update
    set text_tomorrow = v_tomorrow, text_today = v_today, updated_by = auth.uid();
end;
$$;

commit;


-- =====================================================================
-- CONFERÊNCIA
-- =====================================================================
-- select id, kind, active, base_price, extra_professional_price from plans order by active desc, kind, billing_cycle;
-- select count(*) filter (where free_ends_at is null) sem_data, min(free_ends_at), max(free_ends_at) from subscriptions;


-- =====================================================================
-- REVERSÃO DA PARTE B (rodar inteira; antes, volte o código se for o caso)
-- =====================================================================
-- begin;
-- drop trigger  if exists trg_guard_reminder_plan on bookings;
-- drop function if exists guard_reminder_plan();
-- drop trigger  if exists trg_guard_manual_booking_plan on bookings;
-- drop function if exists guard_manual_booking_plan();
-- -- cole e rode: create_overlay_booking e reschedule_overlay da 50; reschedule_booking da 31; save_manual_reminder_texts da 41
-- update subscriptions set free_ends_at = null;   -- volta a "sem fim" (inclui as contas novas)
-- update plans set base_price =  48.70 where id = 'profissional_mensal';
-- update plans set base_price = 487.00 where id = 'profissional_anual';
-- update plans set base_price =  98.70, extra_professional_price =  19.90 where id = 'equipe_mensal';
-- update plans set base_price = 987.00, extra_professional_price = 199.00 where id = 'equipe_anual';
-- update plans set active = false where id in ('basico_mensal', 'basico_anual');
-- commit;
-- =====================================================================
