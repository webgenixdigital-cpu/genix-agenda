-- =====================================================================
-- GENIX AGENDA — ETAPA 3: HORÁRIOS LIVRES E AGENDAMENTO ONLINE (RPC)
-- Rode PARTE por PARTE no SQL Editor (ou o arquivo inteiro).
-- =====================================================================


-- =====================================================================
-- PARTE 1 — O horário bate com algum bloqueio?
-- =====================================================================
create or replace function slot_conflicts_block(
  p_business uuid, p_professional uuid, p_date date, p_start time, p_end time
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from schedule_blocks k
     where k.business_id = p_business
       and (k.professional_id is null or k.professional_id = p_professional)
       and p_date between k.date_start and k.date_end
       and (not k.recurring or extract(dow from p_date)::int = any(k.weekdays))
       and (k.time_start is null or (p_start < k.time_end and p_end > k.time_start))
  );
$$;


-- =====================================================================
-- PARTE 2 — Horários livres (usado pela vitrine pública)
-- Retorna cada horário disponível + os profissionais livres nele.
-- p_professional_id = null  →  "qualquer profissional"
-- =====================================================================
create or replace function get_available_slots(
  p_slug            text,
  p_service_id      uuid,
  p_date            date,
  p_professional_id uuid default null
)
returns table (slot_time text, professional_ids uuid[])
language plpgsql stable security definer set search_path = public
as $$
declare
  b      businesses;
  s      services;
  h      business_hours;
  v_now  timestamp;
  v_today date;
  t      time;
  v_end  time;
  ids    uuid[];
begin
  select * into b from businesses where slug = p_slug and is_published;
  if not found then return; end if;

  select * into s from services
   where id = p_service_id and business_id = b.id and active and bookable_online;
  if not found then return; end if;

  v_now   := now() at time zone b.timezone;
  v_today := v_now::date;
  if p_date < v_today or p_date > v_today + 60 then return; end if;

  select * into h from business_hours
   where business_id = b.id and weekday = extract(dow from p_date)::int;
  if not found or h.closed then return; end if;

  t := h.open_time;
  loop
    v_end := t + make_interval(mins => s.duration_min);
    exit when v_end > h.close_time or v_end <= t;

    -- respeita a antecedência mínima
    if (p_date + t) >= v_now + make_interval(mins => b.booking_notice_min) then
      select array_agg(p.id order by p.sort_order, p.name) into ids
        from professionals p
       where p.business_id = b.id
         and p.active
         and (p_professional_id is null or p.id = p_professional_id)
         -- o profissional faz este serviço (sem vínculos = faz todos)
         and ( not exists (select 1 from professional_services ps where ps.professional_id = p.id)
               or exists (select 1 from professional_services ps
                           where ps.professional_id = p.id and ps.service_id = s.id) )
         -- não está bloqueado
         and not slot_conflicts_block(b.id, p.id, p_date, t, v_end)
         -- não tem agendamento ativo no período
         and not exists (
           select 1 from bookings bk
            where bk.professional_id = p.id
              and bk.status in ('pending', 'confirmed')
              and bk.period && tsrange(p_date + t, p_date + v_end, '[)')
         );

      if ids is not null then
        slot_time        := to_char(t, 'HH24:MI');
        professional_ids := ids;
        return next;
      end if;
    end if;

    t := t + make_interval(mins => b.slot_step_min);
    exit when t >= h.close_time or t <= h.open_time;
  end loop;
end;
$$;


-- =====================================================================
-- PARTE 3 — Criar agendamento pela vitrine (status = pending)
-- Erros possíveis (o front-end trata pela mensagem):
--   ESTABELECIMENTO_NAO_ENCONTRADO | SERVICO_INVALIDO | DADOS_INVALIDOS
--   HORARIO_INDISPONIVEL
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
  b       businesses;
  s       services;
  p       professionals;
  ids     uuid[];
  v_phone text;
  v_name  text;
  v_start time;
  v_end   time;
  v_id    uuid;
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

  -- o horário ainda está livre? (mesma regra da vitrine)
  select g.professional_ids into ids
    from get_available_slots(p_slug, p_service_id, p_date, p_professional_id) g
   where g.slot_time = p_time;
  if ids is null then raise exception 'HORARIO_INDISPONIVEL'; end if;

  select * into p from professionals where id = ids[1];   -- "qualquer" = primeiro livre

  v_start := p_time::time;
  v_end   := v_start + make_interval(mins => s.duration_min);

  begin
    insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
      professional_name, customer_name, customer_phone, customer_notes,
      booking_date, start_time, end_time, status, source)
    values (b.id, s.id, p.id, s.name, s.price, s.duration_min,
      p.name, v_name, v_phone, nullif(trim(p_customer_notes), ''),
      p_date, v_start, v_end, 'pending', 'online')
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
    'customer_name',     v_name
  );
end;
$$;


-- =====================================================================
-- PARTE 4 — PERMISSÕES (visitante e logado podem chamar as RPCs)
-- =====================================================================
revoke all on function slot_conflicts_block(uuid, uuid, date, time, time) from public, anon;
grant execute on function slot_conflicts_block(uuid, uuid, date, time, time) to authenticated;

grant execute on function get_available_slots(text, uuid, date, uuid) to anon, authenticated;
grant execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) to anon, authenticated;


-- =====================================================================
-- PARTE 5 — TESTE: horários livres de "Corte feminino" no Lumina,
-- no próximo dia em que o salão abre (ter a sáb)
-- =====================================================================
with alvo as (
  select s.id as service_id,
         (select d::date
            from generate_series(current_date + 1, current_date + 7, interval '1 day') d
           where extract(dow from d) between 2 and 6
           order by d limit 1) as dia
    from services s
    join businesses b on b.id = s.business_id
   where b.slug = 'luminabelle' and s.name = 'Corte feminino'
)
select alvo.dia, g.slot_time, array_length(g.professional_ids, 1) as profissionais_livres
  from alvo, get_available_slots('luminabelle', alvo.service_id, alvo.dia) g;
