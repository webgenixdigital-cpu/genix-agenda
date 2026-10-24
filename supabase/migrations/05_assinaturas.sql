-- =====================================================================
-- GENIX AGENDA — FASE 1: PLANOS, ASSINATURAS, TESTE GRÁTIS E CADASTRO
-- ATENÇÃO: rode a PARTE 1 SOZINHA primeiro. Depois rode da PARTE 2 ao fim.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Novo papel "viewer" (somente leitura) — RODE SOZINHA
-- =====================================================================
alter type member_role add value if not exists 'viewer';


-- =====================================================================
-- PARTE 2 — Planos e assinaturas
-- =====================================================================
create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');

create table plans (
  id                       text primary key,               -- 'mensal' | 'anual'
  name                     text not null,
  billing_cycle            text not null check (billing_cycle in ('MONTHLY', 'YEARLY')),
  base_price               numeric(10,2) not null,
  included_professionals   smallint not null default 3,
  extra_professional_price numeric(10,2) not null,
  active                   boolean not null default true
);

insert into plans (id, name, billing_cycle, base_price, included_professionals, extra_professional_price) values
  ('mensal', 'Mensal', 'MONTHLY',  98.70, 3,  35.00),
  ('anual',  'Anual',  'YEARLY',  987.00, 3, 350.00);

create table subscriptions (
  business_id            uuid primary key references businesses(id) on delete cascade,
  plan_id                text references plans(id),          -- null durante o teste
  status                 subscription_status not null default 'trialing',
  trial_ends_at          timestamptz not null default (now() + interval '15 days'),
  current_period_end     timestamptz,
  extra_professionals    smallint not null default 0,
  amount                 numeric(10,2),
  asaas_customer_id      text,
  asaas_subscription_id  text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_subscriptions_updated before update on subscriptions
  for each row execute function set_updated_at();

alter table plans enable row level security;
alter table subscriptions enable row level security;

create policy "todos leem planos" on plans for select using (active);
create policy "membro ve assinatura" on subscriptions
  for select to authenticated using (is_business_member(business_id));
-- sem políticas de escrita: só funções do servidor e o webhook alteram assinaturas


-- =====================================================================
-- PARTE 3 — Campos de cadastro e onboarding no estabelecimento
-- =====================================================================
alter table businesses
  add column if not exists owner_name           text,
  add column if not exists terms_accepted_at    timestamptz,
  add column if not exists onboarding           jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_dismissed boolean not null default false,
  add column if not exists is_demo              boolean not null default false;


-- =====================================================================
-- PARTE 4 — Funções de acesso
-- =====================================================================

-- 4.1 Pode editar? (dono ou equipe; "viewer" nunca)
create or replace function is_business_editor(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from business_members
    where business_id = bid and user_id = auth.uid() and role in ('owner', 'staff')
  );
$$;

-- 4.2 Assinatura em dia? (teste válido ou pago; sem assinatura = conta interna)
create or replace function business_is_active(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select case
              when s.status = 'active' then true
              when s.status = 'trialing' and s.trial_ends_at > now() then true
              when s.status = 'past_due' and coalesce(s.current_period_end, now()) > now() - interval '5 days' then true
              else false
            end
       from subscriptions s where s.business_id = bid),
    true
  );
$$;

-- 4.3 Regra única de escrita no painel
create or replace function can_edit_business(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_business_editor(bid) and business_is_active(bid);
$$;


-- =====================================================================
-- PARTE 5 — Regras de segurança: leitura para membros, escrita só com
-- can_edit_business (bloqueia demo e conta com teste vencido)
-- =====================================================================

-- 5.1 Tabelas com business_id: troca "gerencia tudo" por leitura + escrita
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('business_hours',  'membro gerencia horarios'),
      ('services',        'membro gerencia servicos'),
      ('professionals',   'membro gerencia profissionais'),
      ('bookings',        'membro gerencia agendamentos'),
      ('schedule_blocks', 'membro gerencia bloqueios'),
      ('cash_entries',    'membro gerencia caixa')
    ) as v(tbl, old_policy)
  loop
    execute format('drop policy if exists %I on %I', t.old_policy, t.tbl);
    execute format('create policy "membro le" on %I for select to authenticated using (is_business_member(business_id))', t.tbl);
    execute format('create policy "editor insere" on %I for insert to authenticated with check (can_edit_business(business_id))', t.tbl);
    execute format('create policy "editor altera" on %I for update to authenticated using (can_edit_business(business_id)) with check (can_edit_business(business_id))', t.tbl);
    execute format('create policy "editor exclui" on %I for delete to authenticated using (can_edit_business(business_id))', t.tbl);
  end loop;
end $$;

-- 5.2 professional_services (sem business_id direto)
drop policy if exists "membro gerencia vinculos" on professional_services;
create policy "editor gerencia vinculos" on professional_services
  for all to authenticated
  using (exists (select 1 from professionals p where p.id = professional_id and can_edit_business(p.business_id)))
  with check (exists (select 1 from professionals p where p.id = professional_id and can_edit_business(p.business_id)));

-- 5.3 Avaliações: moderação só por quem pode editar
drop policy if exists "membro modera avaliacoes" on reviews;
drop policy if exists "membro exclui avaliacoes" on reviews;
create policy "editor modera avaliacoes" on reviews
  for update to authenticated using (can_edit_business(business_id)) with check (can_edit_business(business_id));
create policy "editor exclui avaliacoes" on reviews
  for delete to authenticated using (can_edit_business(business_id));

-- 5.4 Estabelecimento: só o dono, com assinatura em dia
drop policy if exists "dono edita" on businesses;
create policy "dono edita" on businesses
  for update to authenticated
  using (is_business_owner(id) and business_is_active(id))
  with check (is_business_owner(id) and business_is_active(id));

drop policy if exists "dono exclui" on businesses;
create policy "dono exclui" on businesses
  for delete to authenticated using (is_business_owner(id) and not is_demo);

-- criação de estabelecimento agora só pela função de cadastro (Parte 7)
drop policy if exists "usuario cria o proprio negocio" on businesses;


-- =====================================================================
-- PARTE 6 — Vitrine: sem agendamento online quando o teste venceu
-- (mesma função da Etapa 3, com a verificação de assinatura no início)
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
  b       businesses;
  s       services;
  h       business_hours;
  v_now   timestamp;
  v_today date;
  t       time;
  v_end   time;
  ids     uuid[];
begin
  select * into b from businesses where slug = p_slug and is_published;
  if not found then return; end if;
  if not business_is_active(b.id) then return; end if;   -- NOVO

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

-- A vitrine consulta se o agendamento online está liberado
create or replace function public_booking_enabled(p_slug text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select business_is_active(id) from businesses where slug = p_slug and is_published), false);
$$;
grant execute on function public_booking_enabled(text) to anon, authenticated;


-- =====================================================================
-- PARTE 7 — Cadastro: cria espaço + assinatura em teste (15 dias)
-- Erros: NAO_AUTENTICADO | JA_POSSUI_ESPACO | DADOS_INVALIDOS
-- =====================================================================
create or replace function create_business_for_user(
  p_owner_name    text,
  p_business_name text,
  p_segment       business_segment,
  p_whatsapp      text,          -- só dígitos com DDD, sem 55
  p_slug_base     text           -- já normalizado no navegador
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_wa    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_base  text := left(regexp_replace(lower(coalesce(p_slug_base, '')), '[^a-z0-9-]', '', 'g'), 34);
  v_slug  text;
  v_n     int := 1;
  v_biz   uuid;
begin
  if v_uid is null then raise exception 'NAO_AUTENTICADO'; end if;
  if exists (select 1 from business_members where user_id = v_uid) then
    raise exception 'JA_POSSUI_ESPACO';
  end if;
  if char_length(trim(coalesce(p_owner_name, ''))) < 2
     or char_length(trim(coalesce(p_business_name, ''))) < 2
     or char_length(v_wa) not between 10 and 11 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  -- slug único: "studio-ana", "studio-ana-2", ...
  v_base := trim(both '-' from v_base);
  if char_length(v_base) < 3 or v_base in ('admin','api','v','login','auth','static','assets','public','docs',
                                           'app','painel','segmento','genix','www','suporte') then
    v_base := 'espaco-' || substr(replace(v_uid::text, '-', ''), 1, 6);
  end if;
  v_slug := v_base;
  while exists (select 1 from businesses where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  insert into businesses (owner_id, owner_name, slug, name, segment, phone, whatsapp,
                          whatsapp_message, terms_accepted_at, hero_image)
  values (v_uid, trim(p_owner_name), v_slug, trim(p_business_name), p_segment,
          '(' || left(v_wa, 2) || ') ' || substr(v_wa, 3, char_length(v_wa) - 6) || '-' || right(v_wa, 4),
          '55' || v_wa,
          'Olá! Vim pela sua vitrine e gostaria de agendar um horário.',
          now(), null)
  returning id into v_biz;
  -- o gatilho on_business_created já criou: dono, horários padrão e 1 profissional

  -- o profissional inicial leva o nome da pessoa, não do espaço
  update professionals set name = trim(p_owner_name)
   where business_id = v_biz and user_id = v_uid;

  insert into subscriptions (business_id, status, trial_ends_at)
  values (v_biz, 'trialing', now() + interval '15 days');

  return json_build_object('business_id', v_biz, 'slug', v_slug);
end;
$$;

revoke all on function create_business_for_user(text, text, business_segment, text, text) from public, anon;
grant execute on function create_business_for_user(text, text, business_segment, text, text) to authenticated;


-- =====================================================================
-- PARTE 8 — Valor da assinatura (usado na tela de planos e no Asaas)
-- =====================================================================
create or replace function subscription_quote(bid uuid, p_plan text)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'plan',               p.id,
    'base_price',         p.base_price,
    'professionals',      c.n,
    'extra_professionals', greatest(c.n - p.included_professionals, 0),
    'extra_price',        p.extra_professional_price,
    'total',              p.base_price + greatest(c.n - p.included_professionals, 0) * p.extra_professional_price
  )
  from plans p,
       (select count(*)::int as n from professionals where business_id = bid and active) c
  where p.id = p_plan and is_business_member(bid);
$$;
grant execute on function subscription_quote(uuid, text) to authenticated;


-- =====================================================================
-- PARTE 9 — CONFERÊNCIA
-- =====================================================================
select id, name, base_price, included_professionals, extra_professional_price from plans order by base_price;
