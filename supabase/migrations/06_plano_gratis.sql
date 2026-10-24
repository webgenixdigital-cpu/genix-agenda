-- =====================================================================
-- GENIX AGENDA — FASE 1B: PLANO GRÁTIS (freemium)
-- Rode o arquivo inteiro no SQL Editor (depois do 05-assinaturas).
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Nível de acesso: 'completo' ou 'gratis'
-- Completo: assinatura paga, teste de 15 dias válido, atraso de até 5 dias,
--           ou conta interna sem assinatura (contas do seed).
-- Grátis:   todo o resto (teste vencido sem pagamento, cancelado etc.).
-- =====================================================================
create or replace function access_tier(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select case
              when s.status = 'active' then 'completo'
              when s.status = 'trialing' and s.trial_ends_at > now() then 'completo'
              when s.status = 'past_due' and coalesce(s.current_period_end, now()) > now() - interval '5 days' then 'completo'
              else 'gratis'
            end
       from subscriptions s where s.business_id = bid),
    'completo'
  );
$$;

-- mantém o nome antigo funcionando (agora significa "tem acesso completo")
create or replace function business_is_active(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select access_tier(bid) = 'completo';
$$;

-- Editar o básico: dono/equipe, em qualquer plano
create or replace function can_edit_business(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_business_editor(bid);
$$;

-- Recursos exclusivos do Completo
create or replace function can_use_full_features(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_business_editor(bid) and access_tier(bid) = 'completo';
$$;

grant execute on function access_tier(uuid) to authenticated;


-- =====================================================================
-- PARTE 2 — Recursos exclusivos do Completo (trava no banco)
-- =====================================================================

-- 2.1 Bloqueios de agenda e caixa
do $$
declare
  t text;
begin
  foreach t in array array['schedule_blocks', 'cash_entries'] loop
    execute format('drop policy if exists "editor insere" on %I', t);
    execute format('drop policy if exists "editor altera" on %I', t);
    execute format('drop policy if exists "editor exclui" on %I', t);
    execute format('create policy "completo insere" on %I for insert to authenticated with check (can_use_full_features(business_id))', t);
    execute format('create policy "completo altera" on %I for update to authenticated using (can_use_full_features(business_id)) with check (can_use_full_features(business_id))', t);
    execute format('create policy "completo exclui" on %I for delete to authenticated using (can_use_full_features(business_id))', t);
  end loop;
end $$;

-- 2.2 Moderação de avaliações
drop policy if exists "editor modera avaliacoes" on reviews;
drop policy if exists "editor exclui avaliacoes" on reviews;
create policy "completo modera avaliacoes" on reviews
  for update to authenticated using (can_use_full_features(business_id)) with check (can_use_full_features(business_id));
create policy "completo exclui avaliacoes" on reviews
  for delete to authenticated using (can_use_full_features(business_id));

-- 2.3 Dono edita o perfil em qualquer plano (demo continua bloqueada: viewer não é dono)
drop policy if exists "dono edita" on businesses;
create policy "dono edita" on businesses
  for update to authenticated using (is_business_owner(id)) with check (is_business_owner(id));

-- 2.4 Grátis: no máximo 1 profissional ativo
create or replace function enforce_free_professional_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.active and access_tier(new.business_id) = 'gratis' and exists (
    select 1 from professionals
     where business_id = new.business_id and active and id <> new.id
  ) then
    raise exception 'LIMITE_PLANO_GRATIS';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_free_professional_limit on professionals;
create trigger trg_free_professional_limit
before insert or update of active on professionals
for each row execute function enforce_free_professional_limit();


-- =====================================================================
-- PARTE 3 — Horários da vitrine com as regras do Grátis
-- (10 agendamentos online por dia e só o 1º profissional da equipe)
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
  b        businesses;
  s        services;
  h        business_hours;
  v_now    timestamp;
  v_today  date;
  t        time;
  v_end    time;
  ids      uuid[];
  v_only   uuid;          -- no Grátis: único profissional que recebe agendamentos
  v_count  int;
begin
  select * into b from businesses where slug = p_slug and is_published;
  if not found then return; end if;

  if access_tier(b.id) = 'gratis' then
    select count(*) into v_count from bookings
     where business_id = b.id and booking_date = p_date
       and source = 'online' and status <> 'cancelled';
    if v_count >= 10 then return; end if;

    select id into v_only from professionals
     where business_id = b.id and active order by sort_order, name limit 1;
  end if;

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

    if (p_date + t) >= v_now + make_interval(mins => b.booking_notice_min) then
      select array_agg(p.id order by p.sort_order, p.name) into ids
        from professionals p
       where p.business_id = b.id
         and p.active
         and (v_only is null or p.id = v_only)
         and (p_professional_id is null or p.id = p_professional_id)
         and ( not exists (select 1 from professional_services ps where ps.professional_id = p.id)
               or exists (select 1 from professional_services ps
                           where ps.professional_id = p.id and ps.service_id = s.id) )
         and not slot_conflicts_block(b.id, p.id, p_date, t, v_end)
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
-- PARTE 4 — Informações públicas do plano para a vitrine
-- (selo "Feito com Genix Agenda" e aviso de agenda cheia)
-- =====================================================================
drop function if exists public_booking_enabled(text);

create or replace function public_plan_info(p_slug text, p_date date default null)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_tier  text;
  v_only  uuid;
  v_full  boolean := false;
begin
  select id into v_id from businesses where slug = p_slug and is_published;
  if v_id is null then return null; end if;

  v_tier := access_tier(v_id);

  if v_tier = 'gratis' then
    select id into v_only from professionals
     where business_id = v_id and active order by sort_order, name limit 1;
    if p_date is not null then
      select count(*) >= 10 into v_full from bookings
       where business_id = v_id and booking_date = p_date
         and source = 'online' and status <> 'cancelled';
    end if;
  end if;

  return json_build_object(
    'tier',                 v_tier,
    'show_badge',           v_tier = 'gratis',
    'only_professional_id', v_only,
    'day_full',             v_full
  );
end;
$$;

grant execute on function public_plan_info(text, date) to anon, authenticated;


-- =====================================================================
-- PARTE 5 — CONFERÊNCIA (contas do seed = sem assinatura = completo)
-- =====================================================================
select b.name, access_tier(b.id) as nivel
from businesses b
where b.slug in ('luminabelle', 'barbearia-imperial', 'clinica-harmonize')
order by b.name;
