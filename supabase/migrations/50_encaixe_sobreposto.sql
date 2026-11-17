-- =====================================================================
-- GENIX AGENDA — 50: encaixe sobreposto
-- Marcar, DE PROPÓSITO, um atendimento por cima de outro do mesmo
-- profissional (aproveitar o tempo de produto agindo / espera).
--
--   PARTE 0  cópia de segurança (schema backup, fora da API)
--   PARTE 1  bookings.overlay (false para todos os atendimentos atuais)
--   PARTE 2  trava no_overlap recriada: sobreposto fica fora dela
--   PARTE 3  gatilho guard_booking_overlay
--   PARTE 4  overlay_slot_issue (interna) + overlay_booking_check (prévia)
--   PARTE 5  create_overlay_booking
--   PARTE 6  reschedule_overlay
--   PARTE 7  permissões + conferência
--
-- Regras:
--  - Quem: matriz (owner) em qualquer agenda; profissional (staff) só na
--    própria. Recepção e demonstração: SEM_PERMISSAO. Todos os planos.
--  - No máximo 1 sobreposto por trecho (2 atendimentos ao mesmo tempo).
--  - Precisa haver um atendimento ativo embaixo (senão LIVRE: use o
--    encaixe comum). Continuam valendo bloqueio, meia-noite, profissional
--    que faz o serviço, status (sai da trava ao concluir/cancelar).
--  - O sobreposto conta como OCUPADO para todo o resto: vitrine,
--    horários livres do agendamento manual, remarcar, recorrência e
--    pacote (as funções já contam todo pending/confirmed) e, na gravação,
--    o gatilho da PARTE 3 (mesmo erro da trava: exclusion_violation).
--  - Remarcar comum de um sobreposto: ele vira normal (overlay = false) e
--    a trava volta a valer para ele.
--
-- Nada muda em get_available_slots, manual_booking_slots, reschedule_slots,
-- booking_slot_issue_except, booking_add_item, create_public_booking.
--
-- Rode inteira de uma vez, ANTES do merge (o código atual não usa a
-- coluna nem as funções). Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 0 — Cópia de segurança (fora do schema public: não aparece na API)
-- =====================================================================
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table if not exists backup.bookings_50 as
  select id, professional_id, booking_date, start_time, end_time, status
    from public.bookings;
alter table backup.bookings_50 enable row level security;


-- =====================================================================
-- PARTE 1 — Coluna
-- =====================================================================
alter table bookings add column if not exists overlay boolean not null default false;


-- =====================================================================
-- PARTE 2 — Trava recriada
-- Mesma regra de antes (professional_id =, period &&, pending/confirmed)
-- com "and not overlay". A condição nova pega MENOS linhas que a antiga,
-- então os dados atuais (todos overlay = false) não podem violar.
-- =====================================================================
alter table bookings drop constraint if exists no_overlap;
alter table bookings add constraint no_overlap exclude using gist (
  professional_id with =,
  period with &&
) where (status in ('pending', 'confirmed') and not overlay);


-- =====================================================================
-- PARTE 3 — Gatilho de guarda
-- 1) overlay = true (inserir ou false → true) só pelas funções desta
--    migration (sinal genix.overlay_edit = '1', vale na transação).
--    Sem usuário (SQL Editor/service role): livre, como na 49.
-- 2) Sobreposto movido (profissional, data ou início) sem o sinal vira
--    normal: o Remarcar comum nunca deixa um sobreposto escondido.
-- 3) Atendimento NORMAL ativo não pode ganhar sobreposição NOVA com um
--    sobreposto ativo (inserir, mover, aumentar o fim). Sobreposição que já
--    existia no período anterior é tolerada: o atendimento de baixo
--    continua podendo ser concluído, reaberto, editado.
--    Erro com o MESMO código da trava (23P01 exclusion_violation): todos os
--    tratadores atuais já entendem como "horário ocupado".
-- =====================================================================
create or replace function guard_booking_overlay()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_sig   boolean := coalesce(current_setting('genix.overlay_edit', true), '') = '1';
  v_moved boolean := tg_op = 'INSERT'
                     or new.professional_id is distinct from old.professional_id
                     or new.booking_date    is distinct from old.booking_date
                     or new.start_time      is distinct from old.start_time;
begin
  -- 1)
  if new.overlay and (tg_op = 'INSERT' or not old.overlay)
     and not v_sig and auth.uid() is not null then
    raise exception 'SEM_PERMISSAO';
  end if;

  -- 2)
  if tg_op = 'UPDATE' and old.overlay and new.overlay and v_moved and not v_sig then
    new.overlay := false;
  end if;

  -- 3)
  if not new.overlay and new.status in ('pending', 'confirmed')
     and (v_moved or new.end_time is distinct from old.end_time or old.overlay) then
    perform pg_advisory_xact_lock(hashtextextended('genix.agenda:' || new.professional_id || ':' || new.booking_date, 0));
    if exists (
      select 1 from bookings o
       where o.professional_id = new.professional_id
         and o.overlay
         and o.status in ('pending', 'confirmed')
         and o.id <> new.id
         and o.period && tsrange(new.booking_date + new.start_time, new.booking_date + new.end_time, '[)')
         and not (tg_op = 'UPDATE' and not old.overlay
                  and o.professional_id = old.professional_id
                  and o.period && tsrange(old.booking_date + old.start_time, old.booking_date + old.end_time, '[)'))
    ) then
      raise exception 'OCUPADO' using errcode = 'exclusion_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_booking_overlay on bookings;
create trigger trg_guard_booking_overlay
before insert or update on bookings
for each row execute function guard_booking_overlay();


-- =====================================================================
-- PARTE 4 — Conferência do horário (usada pela prévia, criar e remarcar)
-- Devolve null (pode) ou o motivo:
--   SEM_PERMISSAO | PROFISSIONAL_INDISPONIVEL | PROFISSIONAL_NAO_FAZ
--   MEIA_NOITE | BLOQUEIO | JA_TEM_ENCAIXE | LIVRE
-- p_ignore: o próprio agendamento (remarcar).
-- =====================================================================
create or replace function overlay_slot_issue(
  p_business uuid, p_service uuid, p_professional uuid, p_date date, p_start time,
  p_duration int, p_ignore uuid default null
)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text := member_role_of(p_business);
  v_endm int;
  v_end  time;
  v_rng  tsrange;
begin
  if v_role = 'owner' then
    null;
  elsif v_role = 'staff' and p_professional = my_professional_id(p_business) then
    null;
  else
    return 'SEM_PERMISSAO';
  end if;

  if not exists (select 1 from professionals where id = p_professional and business_id = p_business and active) then
    return 'PROFISSIONAL_INDISPONIVEL';
  end if;
  if p_service is not null and not professional_does_service(p_professional, p_service) then
    return 'PROFISSIONAL_NAO_FAZ';
  end if;

  v_endm := extract(hour from p_start)::int * 60 + extract(minute from p_start)::int + p_duration;
  if p_duration is null or p_duration <= 0 or v_endm > 24 * 60 then return 'MEIA_NOITE'; end if;
  v_end := make_time(v_endm / 60 % 24, v_endm % 60, 0);
  v_rng := tsrange(p_date + p_start, p_date + p_start + make_interval(mins => p_duration), '[)');

  if slot_conflicts_block(p_business, p_professional, p_date, p_start, v_end) then return 'BLOQUEIO'; end if;

  if exists (
    select 1 from bookings o
     where o.professional_id = p_professional and o.overlay
       and o.status in ('pending', 'confirmed')
       and o.id is distinct from p_ignore
       and o.period && v_rng
  ) then
    return 'JA_TEM_ENCAIXE';
  end if;

  if not exists (
    select 1 from bookings o
     where o.professional_id = p_professional and not o.overlay
       and o.status in ('pending', 'confirmed')
       and o.id is distinct from p_ignore
       and o.period && v_rng
  ) then
    return 'LIVRE';
  end if;

  return null;
end;
$$;

-- Prévia para a tela: motivo + atendimentos que ficam embaixo.
-- p_booking (remarcar): duração e serviço vêm do agendamento; p_service é ignorado.
create or replace function overlay_booking_check(
  p_business uuid, p_service uuid, p_professional uuid, p_date date, p_time text,
  p_booking uuid default null
)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_start time;
  v_dur   int;
  v_svc   uuid := p_service;
  v_issue text;
  v_list  json;
  bk      bookings;
begin
  if member_role_of(p_business) is null then raise exception 'SEM_PERMISSAO'; end if;
  if p_date is null or p_time is null or p_time !~ '^\d{2}:\d{2}$' then raise exception 'DADOS_INVALIDOS'; end if;
  v_start := p_time::time;

  if p_booking is not null then
    select * into bk from bookings where id = p_booking and business_id = p_business;
    if not found then raise exception 'NAO_ENCONTRADO'; end if;
    v_dur := bk.duration_min;
    v_svc := bk.service_id;
  else
    select duration_min into v_dur from services where id = p_service and business_id = p_business;
    if not found then raise exception 'DADOS_INVALIDOS'; end if;
  end if;

  v_issue := overlay_slot_issue(p_business, v_svc, p_professional, p_date, v_start, v_dur, p_booking);

  -- quem fica embaixo (só para quem pode marcar nessa agenda)
  if v_issue is distinct from 'SEM_PERMISSAO' then
    select coalesce(json_agg(json_build_object(
             'id', o.id,
             'start', to_char(o.start_time, 'HH24:MI'),
             'end', to_char(o.end_time, 'HH24:MI'),
             'customer', o.customer_name,
             'service', o.service_name,
             'overlay', o.overlay) order by o.start_time), '[]'::json)
      into v_list
      from bookings o
     where o.professional_id = p_professional and o.business_id = p_business
       and o.status in ('pending', 'confirmed')
       and o.id is distinct from p_booking
       and o.period && tsrange(p_date + v_start, p_date + v_start + make_interval(mins => greatest(coalesce(v_dur, 0), 1)), '[)');
  end if;

  return json_build_object(
    'issue', v_issue,
    'end', case when v_dur is null then null
                else to_char(v_start + make_interval(mins => v_dur), 'HH24:MI') end,
    'overlaps', coalesce(v_list, '[]'::json));
end;
$$;


-- =====================================================================
-- PARTE 5 — Criar encaixe sobreposto (balcão/telefone)
-- Telefone já normalizado pela action (parseCustomerPhone); aqui só confere.
-- Os gatilhos de sempre continuam: item 0/combo, pacote, cliente, histórico.
-- Erros: os da PARTE 4 + DADOS_INVALIDOS | NAO_ENCONTRADO | PACOTE_* ...
-- =====================================================================
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


-- =====================================================================
-- PARTE 6 — Remarcar como encaixe sobreposto
-- Mesmo agendamento (normal ou sobreposto) para cima de outro atendimento.
-- Precisa poder mexer no atual E no destino (staff: só a própria agenda).
-- Erros: os da PARTE 4 + DADOS_INVALIDOS | NAO_ENCONTRADO | STATUS_INVALIDO | PASSADO
-- =====================================================================
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
-- PARTE 7 — Permissões
-- =====================================================================
revoke all on function guard_booking_overlay()                                          from public, anon, authenticated;
revoke all on function overlay_slot_issue(uuid, uuid, uuid, date, time, int, uuid)        from public, anon, authenticated;
revoke all on function overlay_booking_check(uuid, uuid, uuid, date, text, uuid)          from public, anon;
revoke all on function create_overlay_booking(uuid, uuid, uuid, date, text, text, text, text, text, uuid) from public, anon;
revoke all on function reschedule_overlay(uuid, uuid, date, text)                         from public, anon;
grant execute on function overlay_booking_check(uuid, uuid, uuid, date, text, uuid)       to authenticated;
grant execute on function create_overlay_booking(uuid, uuid, uuid, date, text, text, text, text, text, uuid) to authenticated;
grant execute on function reschedule_overlay(uuid, uuid, date, text)                      to authenticated;

commit;


-- =====================================================================
-- Conferência (depois do commit)
-- 1) cópia = tabela (mesma contagem) e nenhum sobreposto ainda
-- 2) trava nova com "not overlay"
-- 3) funções e gatilho presentes
-- =====================================================================
select (select count(*) from backup.bookings_50) as copia,
       (select count(*) from public.bookings)    as agendamentos,
       (select count(*) from public.bookings where overlay) as sobrepostos;

select pg_get_constraintdef(oid) as no_overlap from pg_constraint where conname = 'no_overlap';

select proname from pg_proc
 where proname in ('guard_booking_overlay', 'overlay_slot_issue', 'overlay_booking_check',
                   'create_overlay_booking', 'reschedule_overlay')
 order by 1;
select tgname from pg_trigger where tgname = 'trg_guard_booking_overlay';


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- A trava antiga NÃO volta enquanto houver sobreposto ativo por cima de
-- outro atendimento. Antes, liste e resolva (remarque ou cancele):
--   select id, professional_name, booking_date, start_time, end_time, customer_name
--     from bookings where overlay and status in ('pending', 'confirmed') order by booking_date, start_time;
-- Depois rode o bloco abaixo (o código anterior não usa a coluna nem as funções;
-- reverta o código ANTES se o PR já estiver no ar).
-- =====================================================================
-- begin;
-- drop trigger if exists trg_guard_booking_overlay on bookings;
-- drop function if exists reschedule_overlay(uuid, uuid, date, text);
-- drop function if exists create_overlay_booking(uuid, uuid, uuid, date, text, text, text, text, text, uuid);
-- drop function if exists overlay_booking_check(uuid, uuid, uuid, date, text, uuid);
-- drop function if exists overlay_slot_issue(uuid, uuid, uuid, date, time, int, uuid);
-- drop function if exists guard_booking_overlay();
-- alter table bookings drop constraint if exists no_overlap;
-- alter table bookings add constraint no_overlap exclude using gist (
--   professional_id with =,
--   period with &&
-- ) where (status in ('pending', 'confirmed'));
-- alter table bookings drop column if exists overlay;
-- commit;
--
-- Conferir contra a cópia (deve voltar 0 linhas para os atendimentos que já existiam):
-- select b.id from backup.bookings_50 c join bookings b on b.id = c.id
--  where (b.professional_id, b.booking_date, b.start_time, b.end_time)
--        is distinct from (c.professional_id, c.booking_date, c.start_time, c.end_time);
-- Só depois de tudo conferido (e quando não precisar mais da cópia):
-- drop table if exists backup.bookings_50;
