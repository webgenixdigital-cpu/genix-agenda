-- =====================================================================
-- GENIX AGENDA — 67: encaixe, bloqueios e recorrência saem do Básico
-- ⚠️ Rodar DEPOIS do deploy do código novo: ela TIRA acesso do Básico
-- (o código antigo ainda mostra esses recursos liberados no Básico).
-- Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que muda (plan_allows(..., 'basico') → plan_allows(..., 'profissional')):
--   • encaixe no agendamento manual (gatilho guard_manual_booking_plan:
--     no Grátis e no Básico, só os horários da lista de manual_booking_slots);
--   • encaixe sobreposto: create_overlay_booking e reschedule_overlay;
--   • Remarcar com encaixe: reschedule_booking(p_fit = true);
--   • recorrência: check_series_input (usada por preview_booking_series e
--     create_booking_series); antes era access_tier = 'completo';
--   • bloqueios: políticas de criar/alterar/excluir em schedule_blocks
--     (antes access_tier = 'completo'). A leitura não muda.
-- Erros novos: PLANO_PROFISSIONAL_ENCAIXE e PLANO_PROFISSIONAL_RECORRENCIA
-- (o código também entende PLANO_PROFISSIONAL, PLANO_BASICO e PLANO_GRATIS).
--
-- O que NÃO muda (transição):
--   • bloqueios que já existem continuam valendo: get_available_slots,
--     manual_booking_slots e slot_conflicts_block não olham o plano;
--   • agendamentos já criados por encaixe, encaixe sobreposto ou série não
--     mudam; remarcar comum e cancel_series_future continuam liberados;
--   • fila manual de véspera (guard_reminder_plan, save_manual_reminder_texts)
--     continua a partir do Básico;
--   • papéis (matriz, recepção, profissional) continuam como estavam: só o
--     plano mínimo muda.
-- Corpos copiados da versão mais recente: 52b (gatilho, sobreposto,
-- remarcar), 45 (check_series_input) e 10 (políticas). Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Encaixe no agendamento manual (corpo da 52b)
-- =====================================================================
create or replace function guard_manual_booking_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.source in ('manual', 'whatsapp')
     and not coalesce(new.overlay, false)
     and auth.uid() is not null
     and not plan_allows(new.business_id, 'profissional')   -- 67
     and not exists (
       select 1 from manual_booking_slots(new.business_id, new.service_id, new.booking_date) m
        where m.slot_time = to_char(new.start_time, 'HH24:MI')
          and new.professional_id = any(m.professional_ids)
     ) then
    raise exception 'PLANO_PROFISSIONAL_ENCAIXE';   -- 67
  end if;
  return new;
end;
$$;


-- =====================================================================
-- PARTE 2 — Encaixe sobreposto (corpos da 52b)
-- =====================================================================
--     mora em overlay_slot_issue (51) e não muda aqui.
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
  if not plan_allows(p_business, 'profissional') then raise exception 'PLANO_PROFISSIONAL_ENCAIXE'; end if;   -- 67
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
  if not plan_allows(bk.business_id, 'profissional') then raise exception 'PLANO_PROFISSIONAL_ENCAIXE'; end if;   -- 67

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


-- =====================================================================
-- PARTE 3 — Remarcar com encaixe (corpo da 52b; remarcar comum continua livre)
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
  if p_fit and not plan_allows(bk.business_id, 'profissional') then raise exception 'PLANO_PROFISSIONAL_ENCAIXE'; end if;   -- 67

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


-- =====================================================================
-- PARTE 4 — Recorrência (corpo da 45). cancel_series_future não muda.
-- =====================================================================
create or replace function check_series_input(
  p_business uuid, p_professional uuid, p_service uuid, p_frequency text, p_count int, p_package uuid, p_phone text,
  p_country text default '55'   -- 45
)
returns void
language plpgsql stable security definer set search_path = public
as $$
declare
  cp customer_packages;
begin
  if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then raise exception 'FREQUENCIA_INVALIDA'; end if;
  if p_count is null or p_count < 1 or p_count > 52 then raise exception 'QUANTIDADE_INVALIDA'; end if;
  if not plan_allows(p_business, 'profissional') then raise exception 'PLANO_PROFISSIONAL_RECORRENCIA'; end if;   -- 67
  if not exists (select 1 from professionals where id = p_professional and business_id = p_business)
     or not exists (select 1 from services where id = p_service and business_id = p_business) then
    raise exception 'DADOS_INVALIDOS';
  end if;
  if not can_manage_booking(p_business, p_professional) then raise exception 'SEM_PERMISSAO'; end if;

  if p_package is not null then
    select * into cp from customer_packages where id = p_package;
    if not found or cp.business_id <> p_business or cp.status <> 'active'
       or not exists (select 1 from customer_package_items pi where pi.customer_package_id = cp.id and pi.service_id = p_service)
       or not exists (select 1 from customers c where c.id = cp.customer_id and c.phone_country = coalesce(p_country, '55')
                                                  and c.phone = normalize_phone(p_phone, coalesce(p_country, '55'))) then
      raise exception 'PACOTE_INVALIDO';
    end if;
  end if;
end;
$$;


-- =====================================================================
-- PARTE 5 — Bloqueios: criar, alterar e excluir a partir do Profissional
-- (corpo da 10). "ve bloqueios" (leitura) não muda.
-- =====================================================================
drop policy if exists "cria bloqueios" on schedule_blocks;
drop policy if exists "altera bloqueios" on schedule_blocks;
drop policy if exists "exclui bloqueios" on schedule_blocks;

create policy "cria bloqueios" on schedule_blocks
  for insert to authenticated
  with check (
    plan_allows(business_id, 'profissional')   -- 67
    and (member_role_of(business_id) in ('owner', 'reception')
         or (member_role_of(business_id) = 'staff' and professional_id = my_professional_id(business_id)))
  );

create policy "altera bloqueios" on schedule_blocks
  for update to authenticated
  using (
    plan_allows(business_id, 'profissional')   -- 67
    and (member_role_of(business_id) in ('owner', 'reception')
         or (member_role_of(business_id) = 'staff' and professional_id = my_professional_id(business_id)))
  );

create policy "exclui bloqueios" on schedule_blocks
  for delete to authenticated
  using (
    plan_allows(business_id, 'profissional')   -- 67
    and (member_role_of(business_id) in ('owner', 'reception')
         or (member_role_of(business_id) = 'staff' and professional_id = my_professional_id(business_id)))
  );

commit;


-- =====================================================================
-- CONFERÊNCIA (só leitura)
-- =====================================================================
-- select b.name, plan_kind(b.id) plano,
--        plan_allows(b.id, 'profissional') encaixe_bloqueios_recorrencia,
--        (select count(*) from schedule_blocks k where k.business_id = b.id and k.date_end >= current_date) bloqueios_ativos
--   from businesses b order by 2, 1;
-- select polname, pg_get_expr(polqual, polrelid) usando, pg_get_expr(polwithcheck, polrelid) conferindo
--   from pg_policy where polrelid = 'schedule_blocks'::regclass;


-- =====================================================================
-- REVERSÃO (volta ao Básico): rodar de novo os trechos correspondentes da
-- 52b (PARTE 3.1, 3.2 e 3.3), da 45 (check_series_input) e da 10 (PARTE 5),
-- ou trocar aqui 'profissional' por 'basico' nas PARTES 1–3 e 5 e, na
-- PARTE 4, a linha do plano por:
--   if access_tier(p_business) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
-- =====================================================================
