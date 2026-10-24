-- =====================================================================
-- GENIX AGENDA — Agenda 2.0 / 2.1 Remarcar
-- Move um agendamento (mesmo id) para outra data, hora e/ou profissional.
-- Pode rodar inteira de uma vez. Reversão comentada no final.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Regra de conflito com "ignorar este agendamento"
-- Mesma regra da booking_slot_issue (20), com três opções a mais:
--   p_ignore     → não conta este agendamento como ocupado (o que está sendo movido)
--   p_duration   → duração do próprio agendamento (snapshot), em vez da do serviço
--   p_skip_hours → encaixe: não exige estar dentro do expediente
-- Devolve null (livre) ou o motivo:
--   PASSADO | FECHADO | FORA_EXPEDIENTE | PROFISSIONAL_INDISPONIVEL | BLOQUEIO | OCUPADO
-- =====================================================================
create or replace function booking_slot_issue_except(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_start time,
  p_ignore uuid default null, p_duration int default null, p_skip_hours boolean default false
)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  b       businesses;
  s       services;
  h       business_hours;
  v_dur   int;
  v_endm  int;
  v_end   time;
begin
  select * into b from businesses where id = p_business;
  if p_service is not null then
    select * into s from services where id = p_service and business_id = p_business;
    if not found then return 'PROFISSIONAL_INDISPONIVEL'; end if;
  end if;
  v_dur := coalesce(p_duration, s.duration_min);
  if v_dur is null then return 'PROFISSIONAL_INDISPONIVEL'; end if;

  if (p_date + p_start) <= (now() at time zone b.timezone) then return 'PASSADO'; end if;

  v_endm := extract(hour from p_start)::int * 60 + extract(minute from p_start)::int + v_dur;
  if v_endm >= 24 * 60 then return 'FORA_EXPEDIENTE'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);

  if not p_skip_hours then
    select * into h from business_hours where business_id = p_business and weekday = extract(dow from p_date)::int;
    if not found or h.closed then return 'FECHADO'; end if;
    if p_start < h.open_time or v_endm > extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int then
      return 'FORA_EXPEDIENTE';
    end if;
  end if;

  -- profissional ativo e que faz o serviço (sem vínculos = faz todos)
  if not exists (
    select 1 from professionals p
    where p.id = p_professional and p.business_id = p_business and p.active
      and ( p_service is null
            or not exists (select 1 from professional_services ps where ps.professional_id = p.id)
            or exists (select 1 from professional_services ps where ps.professional_id = p.id and ps.service_id = p_service) )
  ) then
    return 'PROFISSIONAL_INDISPONIVEL';
  end if;

  if slot_conflicts_block(p_business, p_professional, p_date, p_start, v_end) then return 'BLOQUEIO'; end if;

  if exists (
    select 1 from bookings bk
    where bk.professional_id = p_professional
      and bk.status in ('pending', 'confirmed')
      and bk.id is distinct from p_ignore
      and bk.period && tsrange(p_date + p_start, p_date + p_start + make_interval(mins => v_dur), '[)')
  ) then
    return 'OCUPADO';
  end if;

  return null;
end;
$$;

revoke all on function booking_slot_issue_except(uuid, uuid, uuid, date, time, uuid, int, boolean) from public, anon, authenticated;

-- A recorrência (20) continua chamando a mesma assinatura, com o mesmo resultado.
create or replace function booking_slot_issue(
  p_business uuid, p_professional uuid, p_service uuid, p_date date, p_start time
)
returns text
language sql stable security definer set search_path = public
as $$
  select booking_slot_issue_except(p_business, p_professional, p_service, p_date, p_start, null, null, false);
$$;

revoke all on function booking_slot_issue(uuid, uuid, uuid, date, time) from public, anon, authenticated;


-- =====================================================================
-- PARTE 2 — Horários livres para remarcar (ignora o próprio agendamento)
-- =====================================================================
create or replace function reschedule_slots(p_booking uuid, p_professional uuid, p_date date)
returns table (slot_time text)
language plpgsql stable security definer set search_path = public
as $$
declare
  bk  bookings;
  b   businesses;
  h   business_hours;
  t   time;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id)
     or not can_manage_booking(bk.business_id, p_professional) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select * into b from businesses where id = bk.business_id;
  select * into h from business_hours where business_id = b.id and weekday = extract(dow from p_date)::int;
  if not found or h.closed then return; end if;

  t := h.open_time;
  loop
    exit when t >= h.close_time;
    if booking_slot_issue_except(b.id, p_professional, bk.service_id, p_date, t, bk.id, bk.duration_min, false) is null then
      slot_time := to_char(t, 'HH24:MI');
      return next;
    end if;
    exit when t + make_interval(mins => b.slot_step_min) <= t;   -- passou da meia-noite
    t := t + make_interval(mins => b.slot_step_min);
  end loop;
end;
$$;

revoke all on function reschedule_slots(uuid, uuid, date) from public, anon;
grant execute on function reschedule_slots(uuid, uuid, date) to authenticated;


-- =====================================================================
-- PARTE 3 — Remarcar (mesmo agendamento)
-- p_fit = encaixe (só matriz e recepção): dispensa o expediente, mantém
-- passado, meia-noite, profissional que faz o serviço, bloqueio e ocupado.
-- O histórico "rescheduled" é gravado pelo trigger log_booking_event;
-- pacote vencido/cancelado é barrado pelo trg_validate_package.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | STATUS_INVALIDO | DADOS_INVALIDOS
--        | <motivo da booking_slot_issue_except> | PACOTE_*
-- =====================================================================
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

  select * into p from professionals where id = p_professional and business_id = bk.business_id;
  if not found then raise exception 'PROFISSIONAL_INDISPONIVEL'; end if;

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

revoke all on function reschedule_booking(uuid, uuid, date, text, boolean) from public, anon;
grant execute on function reschedule_booking(uuid, uuid, date, text, boolean) to authenticated;


-- =====================================================================
-- PARTE 4 — Conferência: a regra da recorrência continua respondendo
-- =====================================================================
select proname from pg_proc
where proname in ('booking_slot_issue', 'booking_slot_issue_except', 'reschedule_slots', 'reschedule_booking');


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- 1) Restaure booking_slot_issue com o texto da PARTE 3 de 20_recorrencia.sql
--    (cole e rode aquele bloco create or replace ... e o revoke logo abaixo dele).
-- 2) Depois:
-- drop function if exists reschedule_booking(uuid, uuid, date, text, boolean);
-- drop function if exists reschedule_slots(uuid, uuid, date);
-- drop function if exists booking_slot_issue_except(uuid, uuid, uuid, date, time, uuid, int, boolean);
-- =====================================================================
