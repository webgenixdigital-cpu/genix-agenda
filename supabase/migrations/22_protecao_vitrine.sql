-- =====================================================================
-- 22 — Proteção da vitrine contra robôs (Agenda 2.0 — etapa 2.3)
--
-- ATENÇÃO À ORDEM: rodar DEPOIS do deploy do código novo (server action
-- com Turnstile). Este script remove a permissão que a vitrine antiga usa.
--
-- 1) create_public_booking ganha limites por telefone:
--      LIMITE_ESPACO — 3 agendamentos online futuros ativos no mesmo espaço
--      LIMITE_DIARIO — 5 agendamentos online criados em 24 h na plataforma
--    O restante da função é idêntico à 03 (as regras do Grátis e de
--    antecedência continuam em get_available_slots, que não muda).
-- 2) Só o servidor (service_role) pode executá-la.
-- Reversão no fim do arquivo.
-- =====================================================================

-- PARTE 1 — Índice para contar por telefone
create index if not exists idx_bookings_online_phone_created
  on bookings (customer_phone, created_at) where source = 'online';

-- PARTE 2 — Função com os limites
-- Erros: ESTABELECIMENTO_NAO_ENCONTRADO | SERVICO_INVALIDO | DADOS_INVALIDOS
--        LIMITE_ESPACO | LIMITE_DIARIO | HORARIO_INDISPONIVEL
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
  v_count int;
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

-- PARTE 3 — Permissões: só o servidor
revoke execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) to service_role;

-- PARTE 4 — Conferência (deve listar só service_role/postgres)
select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_name = 'create_public_booking';


-- =====================================================================
-- REVERSÃO (rodar só se precisar voltar atrás):
--
-- grant execute on function create_public_booking(text, uuid, date, text, text, text, text, uuid) to anon, authenticated;
-- drop index if exists idx_bookings_online_phone_created;
-- e recriar a função com o corpo original abaixo:
--
-- create or replace function create_public_booking(
--   p_slug            text,
--   p_service_id      uuid,
--   p_date            date,
--   p_time            text,          -- 'HH:MM'
--   p_customer_name   text,
--   p_customer_phone  text,
--   p_customer_notes  text default null,
--   p_professional_id uuid default null
-- )
-- returns json
-- language plpgsql volatile security definer set search_path = public
-- as $$
-- declare
--   b       businesses;
--   s       services;
--   p       professionals;
--   ids     uuid[];
--   v_phone text;
--   v_name  text;
--   v_start time;
--   v_end   time;
--   v_id    uuid;
-- begin
--   select * into b from businesses where slug = p_slug and is_published;
--   if not found then raise exception 'ESTABELECIMENTO_NAO_ENCONTRADO'; end if;
--
--   select * into s from services
--    where id = p_service_id and business_id = b.id and active and bookable_online;
--   if not found then raise exception 'SERVICO_INVALIDO'; end if;
--
--   v_name  := trim(coalesce(p_customer_name, ''));
--   v_phone := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
--   if char_length(v_name) not between 2 and 80
--      or char_length(v_phone) not between 10 and 11
--      or char_length(coalesce(p_customer_notes, '')) > 500 then
--     raise exception 'DADOS_INVALIDOS';
--   end if;
--
--   -- o horário ainda está livre? (mesma regra da vitrine)
--   select g.professional_ids into ids
--     from get_available_slots(p_slug, p_service_id, p_date, p_professional_id) g
--    where g.slot_time = p_time;
--   if ids is null then raise exception 'HORARIO_INDISPONIVEL'; end if;
--
--   select * into p from professionals where id = ids[1];   -- "qualquer" = primeiro livre
--
--   v_start := p_time::time;
--   v_end   := v_start + make_interval(mins => s.duration_min);
--
--   begin
--     insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
--       professional_name, customer_name, customer_phone, customer_notes,
--       booking_date, start_time, end_time, status, source)
--     values (b.id, s.id, p.id, s.name, s.price, s.duration_min,
--       p.name, v_name, v_phone, nullif(trim(p_customer_notes), ''),
--       p_date, v_start, v_end, 'pending', 'online')
--     returning id into v_id;
--   exception when exclusion_violation then
--     -- outra pessoa pegou o horário no mesmo instante
--     raise exception 'HORARIO_INDISPONIVEL';
--   end;
--
--   return json_build_object(
--     'id',                v_id,
--     'business_name',     b.name,
--     'business_whatsapp', b.whatsapp,
--     'service_name',      s.name,
--     'price',             s.price,
--     'duration_min',      s.duration_min,
--     'professional_name', p.name,
--     'date',              p_date,
--     'start_time',        to_char(v_start, 'HH24:MI'),
--     'end_time',          to_char(v_end, 'HH24:MI'),
--     'customer_name',     v_name
--   );
-- end;
-- $$;
-- =====================================================================
