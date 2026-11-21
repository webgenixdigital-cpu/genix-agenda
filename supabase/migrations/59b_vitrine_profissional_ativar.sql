-- =====================================================================
-- GENIX AGENDA — 59: Vitrine só a partir do Profissional (PARTE B)
-- ⚠️ Rodar DEPOIS do deploy do código novo (e depois da 59a).
-- ⚠️ ANTES desta parte: rode a conferência supabase/manual/59a_pilotos_vitrine.sql
--    e decida cortesia (plan_grants) ou aviso para quem está em teste/Grátis/Básico
--    com agendamentos online futuros. Os agendamentos já marcados continuam valendo.
-- Ela TIRA acesso. Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   1. vitrine (get_available_slots) só devolve horários com vitrine_online_allowed;
--      o corpo antigo vira get_available_slots_52 (sem acesso público);
--   2. public_plan_info ganha 'card_only' (vitrine vira cartão de visita) e
--      'online_closed' passa a ser "não recebe agendamento online";
--   3. defesa no banco: pedido online de quem não tem a vitrine não entra;
--   4. diretório (/espacos, /explorar) só com espaços que têm a vitrine;
--   5. submit_review (pedido de avaliação) só a partir do Profissional;
--   6. Grátis vencido = painel SÓ CONSULTA: agendamentos e clientes não são
--      criados nem editados (erro PLANO_CONSULTA); CANCELAR continua liberado;
--   7. salão-parceiro só no Equipe (registro na conclusão e relatório).
-- Reversão comentada no final.
-- =====================================================================

begin;

-- =====================================================================
-- PARTE 1 — Horários da vitrine
-- O corpo da 52 continua igual, com outro nome; quem chama de fora
-- (vitrine e create_public_booking) passa pelo portão da 59.
-- =====================================================================
do $$
begin
  if to_regprocedure('get_available_slots_52(text, uuid, date, uuid)') is null then
    alter function get_available_slots(text, uuid, date, uuid) rename to get_available_slots_52;
  end if;
end $$;
revoke all on function get_available_slots_52(text, uuid, date, uuid) from public, anon, authenticated;

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
  v_id uuid;
begin
  select id into v_id from businesses where slug = p_slug and is_published;
  if v_id is null or not vitrine_online_allowed(v_id) then return; end if;   -- 59: cartão de visita
  return query
    select g.slot_time, g.professional_ids
      from get_available_slots_52(p_slug, p_service_id, p_date, p_professional_id) g;
end;
$$;
grant execute on function get_available_slots(text, uuid, date, uuid) to anon, authenticated;


-- =====================================================================
-- PARTE 2 — Informações públicas (corpo da 52) + 'card_only'
-- O limite de 6 por dia do Grátis deixa de existir (o Grátis não tem
-- vitrine online); 'day_full' fica sempre false para o código antigo.
-- =====================================================================
create or replace function public_plan_info(p_slug text, p_date date default null)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_tier   text;
  v_only   uuid;
  v_kind   text;
  v_online boolean;
begin
  select id into v_id from businesses where slug = p_slug and is_published;
  if v_id is null then return null; end if;

  v_tier   := access_tier(v_id);
  v_kind   := plan_kind(v_id);
  v_online := vitrine_online_allowed(v_id);

  if plan_max_professionals(v_id) = 1 then
    select id into v_only from professionals
     where business_id = v_id and active order by sort_order, name limit 1;
  end if;

  return json_build_object(
    'tier',                     v_tier,
    'show_badge',               v_tier = 'gratis',
    'only_professional_id',     v_only,
    'day_full',                 false,
    'blocked_professional_ids', billing_blocked_professionals(v_id),
    'kind',                     v_kind,
    'online_closed',            not v_online,             -- 59: sem agendamento online
    'card_only',                not v_online              -- 59: vitrine = cartão de visita
  );
end;
$$;
grant execute on function public_plan_info(text, date) to anon, authenticated;


-- =====================================================================
-- PARTE 3 — Defesa no banco: pedido online sem vitrine não entra
-- (create_public_booking já recusa pelo horário; isto cobre o resto)
-- =====================================================================
create or replace function guard_online_booking_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.source = 'online' and not vitrine_online_allowed(new.business_id) then
    raise exception 'AGENDA_INDISPONIVEL';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_online_booking_plan on bookings;
create trigger trg_guard_online_booking_plan
before insert on bookings
for each row execute function guard_online_booking_plan();


-- =====================================================================
-- PARTE 4 — Diretório: só espaços com a vitrine (corpo da 17 + filtro)
-- O cartão de visita continua no sitemap (buscadores), fora do diretório.
-- =====================================================================
create or replace view public_directory
with (security_invoker = true) as
select
  b.id, b.slug, b.name, b.segment, b.subcategory, b.tagline,
  b.city, b.state, b.logo_url, b.hero_image, b.whatsapp, b.whatsapp_message,
  coalesce(round(avg(r.rating)::numeric, 1), 0) as rating_avg,
  count(r.id)                                    as rating_count,
  (select min(s.price) from services s where s.business_id = b.id and s.active) as min_price,
  (select count(*)     from services s where s.business_id = b.id and s.active) as service_count,
  n.name as niche_name,
  n.icon as niche_icon,
  b.address
from businesses b
left join reviews r on r.business_id = b.id and r.visible
left join niches n on n.id = b.subcategory
where b.is_published
  and vitrine_online_allowed(b.id)          -- 59
group by b.id, n.name, n.icon;


-- =====================================================================
-- PARTE 5 — Pedido de avaliação só a partir do Profissional
-- (corpo da 04; as avaliações já feitas continuam visíveis)
-- =====================================================================
create or replace function submit_review(p_booking uuid, p_rating int, p_comment text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk      bookings;
  v_parts text[];
  v_name  text;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'AVALIACAO_INVALIDA'; end if;
  if not plan_allows(bk.business_id, 'profissional') then raise exception 'AVALIACAO_INVALIDA'; end if;   -- 59
  if bk.status <> 'completed' then raise exception 'ATENDIMENTO_NAO_CONCLUIDO'; end if;
  if p_rating is null or p_rating not between 1 and 5
     or char_length(coalesce(p_comment, '')) > 600 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  -- "Mariana Ribeiro Souza" → "Mariana S."
  v_parts := regexp_split_to_array(trim(bk.customer_name), '\s+');
  v_name  := v_parts[1];
  if array_length(v_parts, 1) > 1 then
    v_name := v_name || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;
  if char_length(v_name) < 2 then v_name := 'Cliente'; end if;

  begin
    insert into reviews (business_id, booking_id, author_name, rating, comment)
    values (bk.business_id, bk.id, left(v_name, 60), p_rating, nullif(trim(p_comment), ''));
  exception when unique_violation then
    raise exception 'JA_AVALIADO';
  end;

  return json_build_object('ok', true);
end;
$$;
grant execute on function submit_review(uuid, int, text) to anon, authenticated;


-- =====================================================================
-- PARTE 6 — Grátis vencido: painel SÓ CONSULTA
-- Vale para quem está logado (auth.uid() presente). Service role, cron
-- e SQL Editor (sem usuário) passam. Pedido online sem usuário já é
-- barrado na PARTE 3.
--   bookings:  criar, editar, remarcar, confirmar e concluir → PLANO_CONSULTA;
--              CANCELAR (pending/confirmed → cancelled) continua liberado.
--   customers: criar e editar → PLANO_CONSULTA.
-- Nada é apagado.
-- =====================================================================
create or replace function guard_free_read_only()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not free_period_over(new.business_id) then
    return new;
  end if;
  -- (ifs separados: customers não tem a coluna status)
  if tg_table_name = 'bookings' and tg_op = 'UPDATE' then
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      return new;   -- cancelar continua liberado
    end if;
  end if;
  raise exception 'PLANO_CONSULTA';
end;
$$;
revoke all on function guard_free_read_only() from public, anon, authenticated;

drop trigger if exists trg_guard_free_read_only on bookings;
create trigger trg_guard_free_read_only
before insert or update on bookings
for each row execute function guard_free_read_only();

drop trigger if exists trg_guard_free_read_only on customers;
create trigger trg_guard_free_read_only
before insert or update on customers
for each row execute function guard_free_read_only();


-- =====================================================================
-- PARTE 7 — Salão-parceiro só no Equipe
-- 7.1 registro na conclusão (corpo da 24): fora do Equipe, partner_pct = 0
-- =====================================================================
create or replace function snapshot_partner_pct()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select case when p.is_partner and coalesce(f.partner_salon, false)
                     and plan_allows(new.business_id, 'equipe')      -- 59
                then p.commission_pct else 0 end
      into new.partner_pct
      from professionals p
      left join business_fiscal f on f.business_id = new.business_id
     where p.id = new.professional_id;
    new.partner_pct := coalesce(new.partner_pct, 0);
  elsif new.status <> 'completed' then
    new.partner_pct := null;
  end if;
  return new;
end;
$$;

-- 7.2 relatório (corpo da 37): o que já foi registrado na conclusão vale;
--     para atendimentos sem registro (antes da 24), o parceiro só conta no Equipe
create or replace function billing_monthly(p_business uuid, p_from date, p_to date)
returns table (month text, kind text, category text, method text, amount numeric, partner_amount numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_partner boolean;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  select coalesce(f.partner_salon, false) into v_partner from business_fiscal f where f.business_id = p_business;
  v_partner := coalesce(v_partner, false) and plan_allows(p_business, 'equipe');   -- 59

  return query
  select to_char(c.entry_date, 'YYYY-MM'), c.kind::text, c.category::text, c.method::text,
         sum(c.amount)::numeric,
         sum(case
               when c.kind = 'income' and bk.id is not null then
                 round(c.amount * coalesce(bk.partner_pct,
                                           case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2)
               else 0
             end)::numeric
    from cash_entries c
    left join bookings bk on bk.id = c.booking_id
    left join professionals p on p.id = bk.professional_id
   where c.business_id = p_business
     and c.entry_date between p_from and p_to
   group by 1, 2, 3, 4

  union all

  -- 37_plano_fechado: uma linha por serviço do pacote usado na visita
  select to_char(bk.booking_date, 'YYYY-MM'), 'repasse_pacote', 'pacote', null::text,
         0::numeric,
         sum(round(pi.value_total / pi.sessions_total
                   * coalesce(bk.partner_pct,
                              case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2))::numeric
    from bookings bk
    join booking_items i on i.booking_id = bk.id
    join customer_package_items pi on pi.id = i.customer_package_item_id
    left join professionals p on p.id = bk.professional_id
   where bk.business_id = p_business
     and bk.status = 'completed'
     and bk.booking_date between p_from and p_to
   group by 1
  having sum(round(pi.value_total / pi.sessions_total
                   * coalesce(bk.partner_pct,
                              case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2)) > 0;
end;
$$;

commit;

-- =====================================================================
-- CONFERÊNCIA (rodar depois; só leitura)
-- =====================================================================
-- 1) espaços publicados por situação da vitrine
--   select vitrine_online_allowed(b.id) as vitrine, plan_kind(b.id) as plano, count(*)
--     from businesses b where b.is_published and not b.is_demo group by 1, 2 order by 1, 2;
-- 2) o corpo antigo não está aberto ao público (deve voltar false, false)
--   select has_function_privilege('anon', 'get_available_slots_52(text, uuid, date, uuid)', 'execute'),
--          has_function_privilege('authenticated', 'get_available_slots_52(text, uuid, date, uuid)', 'execute');
-- 3) gatilhos do "só consulta" (deve voltar 2 linhas)
--   select tgrelid::regclass, tgname from pg_trigger where tgname = 'trg_guard_free_read_only';

-- =====================================================================
-- REVERSÃO (rodar inteira se precisar desfazer; volta ao comportamento da 52)
-- =====================================================================
-- begin;
-- drop trigger if exists trg_guard_free_read_only on bookings;
-- drop trigger if exists trg_guard_free_read_only on customers;
-- drop function if exists guard_free_read_only();
-- drop function if exists get_available_slots(text, uuid, date, uuid);
-- alter function get_available_slots_52(text, uuid, date, uuid) rename to get_available_slots;
-- grant execute on function get_available_slots(text, uuid, date, uuid) to anon, authenticated;
-- create or replace function guard_online_booking_plan() returns trigger
--   language plpgsql security definer set search_path = public as $f$
-- begin
--   if new.source = 'online' and free_period_over(new.business_id) then raise exception 'AGENDA_INDISPONIVEL'; end if;
--   return new;
-- end; $f$;
-- -- public_plan_info: rodar de novo o bloco "5.2" da 52a_planos_basico.sql
-- -- public_directory: rodar de novo a view da 17_diretorio_endereco.sql
-- -- submit_review: rodar de novo a PARTE 3 da 04_avaliacoes.sql
-- -- snapshot_partner_pct: rodar de novo a função da 24_faturamento.sql
-- -- billing_monthly: rodar de novo a função da 37_plano_fechado.sql
-- commit;
