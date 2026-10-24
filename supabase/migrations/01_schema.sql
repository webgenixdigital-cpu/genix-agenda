-- =====================================================================
-- GENIX AGENDA — ETAPA 1: SCHEMA (Supabase / PostgreSQL)
-- Cole no SQL Editor do Supabase e rode PARTE por PARTE, em ordem.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — EXTENSÕES E TIPOS
-- =====================================================================
create extension if not exists btree_gist;   -- impede agendamentos sobrepostos
create extension if not exists citext;       -- slug/e-mail sem diferenciar maiúsculas

create type business_segment as enum ('beleza', 'estetica', 'psicologia_terapias', 'outros');
create type member_role      as enum ('owner', 'staff');
create type booking_status   as enum ('pending', 'confirmed', 'completed', 'cancelled');
create type booking_source   as enum ('online', 'whatsapp', 'manual');
create type cash_kind        as enum ('income', 'expense');
create type cash_category    as enum ('atendimento', 'comissao', 'produtos', 'aluguel', 'outros');
create type payment_method   as enum ('pix', 'dinheiro', 'credito', 'debito');


-- =====================================================================
-- PARTE 2 — TABELAS
-- =====================================================================

-- 2.1 Estabelecimentos (tenants)
create table businesses (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete restrict,
  slug             citext not null unique,
  name             text not null,
  segment          business_segment not null default 'beleza',
  subcategory      text,                       -- salao, barbearia, lash, terapeuta...
  tagline          text,
  description      text,
  phone            text,
  whatsapp         text,                       -- somente dígitos: 55 + DDD + número
  whatsapp_message text default 'Olá! Gostaria de agendar um horário.',
  address          text,
  city             text,
  state            text,
  instagram        text,
  logo_url         text,
  hero_image       text,
  custom_domain    citext unique,
  timezone         text not null default 'America/Sao_Paulo',
  slot_step_min    smallint not null default 30 check (slot_step_min in (10, 15, 20, 30, 60)),
  booking_notice_min integer not null default 60,   -- antecedência mínima para agendar online
  is_published     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint slug_format check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(slug) between 3 and 40
    and slug not in ('admin','api','v','login','auth','static','assets','public','docs',
                     'app','painel','segmento','genix','www','suporte')
  ),
  constraint whatsapp_digits check (whatsapp is null or whatsapp ~ '^55[0-9]{10,11}$')
);

-- 2.2 Membros (dono e equipe com acesso ao painel)
create table business_members (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- 2.3 Horário de funcionamento (0 = domingo ... 6 = sábado)
create table business_hours (
  business_id uuid not null references businesses(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  open_time   time,
  close_time  time,
  closed      boolean not null default false,
  primary key (business_id, weekday),
  constraint hours_valid check (closed or (open_time is not null and close_time > open_time))
);

-- 2.4 Serviços (fonte única: também alimenta o Genix Catalog)
create table services (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  name            text not null,
  description     text,
  category        text,
  price           numeric(10,2) not null default 0 check (price >= 0),
  duration_min    smallint not null check (duration_min between 5 and 600),
  image_url       text,
  active          boolean not null default true,
  bookable_online boolean not null default true,
  show_in_catalog boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2.5 Profissionais
create table professionals (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,  -- se tiver login
  name           text not null,
  role           text,
  bio            text,
  photo_url      text,
  specialties    text[] not null default '{}',
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 2.6 Quais serviços cada profissional atende (vazio = atende todos)
create table professional_services (
  professional_id uuid not null references professionals(id) on delete cascade,
  service_id      uuid not null references services(id) on delete cascade,
  primary key (professional_id, service_id)
);

-- 2.7 Agendamentos
create table bookings (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  service_id        uuid references services(id) on delete set null,
  professional_id   uuid not null references professionals(id) on delete restrict,
  -- snapshot (preserva histórico se o serviço/profissional mudar)
  service_name      text not null,
  price             numeric(10,2) not null default 0,
  duration_min      smallint not null,
  professional_name text not null,
  -- cliente
  customer_name     text not null,
  customer_phone    text not null,
  customer_notes    text,
  -- horário
  booking_date      date not null,
  start_time        time not null,
  end_time          time not null,
  period            tsrange generated always as
                    (tsrange(booking_date + start_time, booking_date + end_time, '[)')) stored,
  status            booking_status not null default 'pending',
  source            booking_source not null default 'online',
  reminder_sent_at  timestamptz,
  cancelled_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint time_valid check (end_time > start_time),
  -- trava no banco: o mesmo profissional nunca tem 2 horários ativos sobrepostos
  constraint no_overlap exclude using gist (
    professional_id with =,
    period with &&
  ) where (status in ('pending', 'confirmed'))
);

-- 2.8 Bloqueios de agenda (férias, folgas, treinamentos)
create table schedule_blocks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  professional_id uuid references professionals(id) on delete cascade,  -- null = equipe toda
  date_start      date not null,
  date_end        date not null,
  time_start      time,          -- null = dia inteiro
  time_end        time,
  reason          text,
  recurring       boolean not null default false,
  weekdays        smallint[] not null default '{}',   -- usado quando recurring = true
  created_at      timestamptz not null default now(),
  constraint block_dates check (date_end >= date_start),
  constraint block_times check (
    (time_start is null and time_end is null) or (time_end > time_start)
  ),
  constraint block_weekdays check (
    (not recurring) or (cardinality(weekdays) > 0 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
  )
);

-- 2.9 Caixa operacional
create table cash_entries (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  booking_id  uuid references bookings(id) on delete set null,
  kind        cash_kind not null,
  category    cash_category not null default 'atendimento',
  method      payment_method not null default 'pix',
  description text,
  amount      numeric(10,2) not null check (amount > 0),
  entry_date  date not null default current_date,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 2.10 Avaliações públicas
create table reviews (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 60),
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 600),
  visible     boolean not null default true,
  created_at  timestamptz not null default now()
);


-- =====================================================================
-- PARTE 3 — FUNÇÕES AUXILIARES E TRIGGERS
-- =====================================================================

-- 3.1 O usuário logado é membro deste estabelecimento?
create or replace function is_business_member(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from business_members
    where business_id = bid and user_id = auth.uid()
  );
$$;

-- 3.2 O usuário logado é DONO deste estabelecimento?
create or replace function is_business_owner(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from business_members
    where business_id = bid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- 3.3 O estabelecimento está publicado (vitrine visível)?
create or replace function is_business_published(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_published from businesses where id = bid), false);
$$;

-- 3.4 updated_at automático
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_businesses_updated    before update on businesses    for each row execute function set_updated_at();
create trigger trg_services_updated      before update on services      for each row execute function set_updated_at();
create trigger trg_professionals_updated before update on professionals for each row execute function set_updated_at();
create trigger trg_bookings_updated      before update on bookings      for each row execute function set_updated_at();

-- 3.5 Ao criar um estabelecimento: vira dono + horários padrão + profissional padrão
create or replace function on_business_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into business_members (business_id, user_id, role)
  values (new.id, new.owner_id, 'owner');

  -- Seg–Sex 09:00–18:00 | Sáb 09:00–13:00 | Dom fechado
  insert into business_hours (business_id, weekday, open_time, close_time, closed) values
    (new.id, 0, null,    null,    true),
    (new.id, 1, '09:00', '18:00', false),
    (new.id, 2, '09:00', '18:00', false),
    (new.id, 3, '09:00', '18:00', false),
    (new.id, 4, '09:00', '18:00', false),
    (new.id, 5, '09:00', '18:00', false),
    (new.id, 6, '09:00', '13:00', false);

  -- Profissional autônomo começa com 1 profissional (ele mesmo)
  insert into professionals (business_id, user_id, name, role)
  values (new.id, new.owner_id, new.name, 'Responsável');

  return new;
end;
$$;

create trigger trg_business_created
after insert on businesses
for each row execute function on_business_created();


-- =====================================================================
-- PARTE 4 — SEGURANÇA (RLS)
-- Público: lê só vitrines publicadas. Agendamento online e consulta de
-- horários livres serão feitos via funções RPC na Etapa 3 (o público
-- nunca lê a tabela bookings diretamente = privacidade dos clientes).
-- =====================================================================

alter table businesses            enable row level security;
alter table business_members      enable row level security;
alter table business_hours        enable row level security;
alter table services              enable row level security;
alter table professionals         enable row level security;
alter table professional_services enable row level security;
alter table bookings              enable row level security;
alter table schedule_blocks       enable row level security;
alter table cash_entries          enable row level security;
alter table reviews               enable row level security;

-- 4.1 businesses
create policy "public le vitrines publicadas" on businesses
  for select using (is_published or is_business_member(id));
create policy "usuario cria o proprio negocio" on businesses
  for insert to authenticated with check (owner_id = auth.uid());
create policy "dono edita" on businesses
  for update to authenticated using (is_business_owner(id)) with check (is_business_owner(id));
create policy "dono exclui" on businesses
  for delete to authenticated using (is_business_owner(id));

-- 4.2 business_members
create policy "membro ve a equipe" on business_members
  for select to authenticated using (is_business_member(business_id));
create policy "dono gerencia equipe" on business_members
  for all to authenticated using (is_business_owner(business_id)) with check (is_business_owner(business_id));

-- 4.3 business_hours
create policy "public le horarios" on business_hours
  for select using (is_business_published(business_id) or is_business_member(business_id));
create policy "membro gerencia horarios" on business_hours
  for all to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));

-- 4.4 services
create policy "public le servicos ativos" on services
  for select using ((active and is_business_published(business_id)) or is_business_member(business_id));
create policy "membro gerencia servicos" on services
  for all to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));

-- 4.5 professionals
create policy "public le profissionais ativos" on professionals
  for select using ((active and is_business_published(business_id)) or is_business_member(business_id));
create policy "membro gerencia profissionais" on professionals
  for all to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));

-- 4.6 professional_services
create policy "public le vinculos" on professional_services
  for select using (
    exists (select 1 from professionals p
            where p.id = professional_id
              and (is_business_published(p.business_id) or is_business_member(p.business_id)))
  );
create policy "membro gerencia vinculos" on professional_services
  for all to authenticated using (
    exists (select 1 from professionals p where p.id = professional_id and is_business_member(p.business_id))
  ) with check (
    exists (select 1 from professionals p where p.id = professional_id and is_business_member(p.business_id))
  );

-- 4.7 bookings (somente equipe)
create policy "membro gerencia agendamentos" on bookings
  for all to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));

-- 4.8 schedule_blocks (somente equipe)
create policy "membro gerencia bloqueios" on schedule_blocks
  for all to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));

-- 4.9 cash_entries (somente equipe)
create policy "membro gerencia caixa" on cash_entries
  for all to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));

-- 4.10 reviews
create policy "public le avaliacoes visiveis" on reviews
  for select using ((visible and is_business_published(business_id)) or is_business_member(business_id));
create policy "public envia avaliacao" on reviews
  for insert with check (is_business_published(business_id) and visible = true);
create policy "membro modera avaliacoes" on reviews
  for update to authenticated using (is_business_member(business_id)) with check (is_business_member(business_id));
create policy "membro exclui avaliacoes" on reviews
  for delete to authenticated using (is_business_member(business_id));


-- =====================================================================
-- PARTE 5 — ÍNDICES E VIEW PÚBLICA
-- =====================================================================
create index idx_businesses_segment     on businesses (segment, subcategory) where is_published;
create index idx_businesses_city        on businesses (city) where is_published;
create index idx_services_business      on services (business_id, sort_order) where active;
create index idx_professionals_business on professionals (business_id) where active;
create index idx_bookings_agenda        on bookings (business_id, booking_date, start_time);
create index idx_bookings_status        on bookings (business_id, status, booking_date);
create index idx_bookings_reminder      on bookings (business_id, booking_date) where reminder_sent_at is null;
create index idx_blocks_business        on schedule_blocks (business_id, date_start, date_end);
create index idx_cash_business_date     on cash_entries (business_id, entry_date);
create index idx_reviews_business       on reviews (business_id, created_at desc) where visible;

-- Diretório público com nota média (home e páginas de segmento)
create or replace view public_directory
with (security_invoker = true) as
select
  b.id, b.slug, b.name, b.segment, b.subcategory, b.tagline,
  b.city, b.state, b.logo_url, b.hero_image, b.whatsapp, b.whatsapp_message,
  coalesce(round(avg(r.rating)::numeric, 1), 0) as rating_avg,
  count(r.id)                                    as rating_count,
  (select min(s.price) from services s where s.business_id = b.id and s.active) as min_price,
  (select count(*)     from services s where s.business_id = b.id and s.active) as service_count
from businesses b
left join reviews r on r.business_id = b.id and r.visible
where b.is_published
group by b.id;

-- =====================================================================
-- FIM DA ETAPA 1
-- =====================================================================
