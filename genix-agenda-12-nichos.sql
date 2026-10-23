-- =====================================================================
-- GENIX AGENDA — N1.1: CATÁLOGO DE NICHOS (administrado pela Genix)
-- Rode o arquivo inteiro no SQL Editor.
-- ANTES: troque o e-mail da PARTE 1 pelo e-mail do seu login de administrador.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Administradores da plataforma (equipe Genix)
-- =====================================================================
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
drop policy if exists "admin ve a si mesmo" on platform_admins;
create policy "admin ve a si mesmo" on platform_admins for select to authenticated using (user_id = auth.uid());

create or replace function is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
grant execute on function is_platform_admin() to authenticated;

-- >>> TROQUE PELO SEU E-MAIL DE ADMINISTRADOR <<<
insert into platform_admins (user_id)
select id from auth.users where email = 'webgenixdigital@gmail.com'
on conflict do nothing;


-- =====================================================================
-- PARTE 2 — Tabelas de nichos e serviços sugeridos
-- =====================================================================
create table if not exists niches (
  id          text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- ex.: 'salao', 'clinica-estetica'
  segment     business_segment not null,
  name        text not null,
  description text,
  icon        text not null default 'sparkles',
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists niche_service_templates (
  id           uuid primary key default gen_random_uuid(),
  niche_id     text not null references niches(id) on delete cascade on update cascade,
  name         text not null,
  category     text,
  description  text,
  duration_min smallint not null check (duration_min between 5 and 600),
  price        numeric(10,2) not null default 0 check (price >= 0),
  sort_order   integer not null default 0
);

create index if not exists idx_niche_templates on niche_service_templates (niche_id, sort_order);

drop trigger if exists trg_niches_updated on niches;
create trigger trg_niches_updated before update on niches for each row execute function set_updated_at();

alter table niches enable row level security;
alter table niche_service_templates enable row level security;

drop policy if exists "todos leem nichos ativos" on niches;
drop policy if exists "admin gerencia nichos" on niches;
create policy "todos leem nichos ativos" on niches for select using (active or is_platform_admin());
create policy "admin gerencia nichos" on niches for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());

drop policy if exists "todos leem sugestoes" on niche_service_templates;
drop policy if exists "admin gerencia sugestoes" on niche_service_templates;
create policy "todos leem sugestoes" on niche_service_templates for select using (true);
create policy "admin gerencia sugestoes" on niche_service_templates for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());


-- =====================================================================
-- PARTE 3 — Nichos iniciais (sem área da saúde)
-- =====================================================================
insert into niches (id, segment, name, description, icon, sort_order) values
  ('salao',            'beleza',   'Salão de beleza',        'Cortes, escovas, coloração e tratamentos capilares.',  'scissors', 1),
  ('barbearia',        'beleza',   'Barbearia',              'Cortes masculinos, barba e acabamento na navalha.',     'scissors', 2),
  ('unhas',            'beleza',   'Unhas',                  'Manicure, pedicure, alongamento e nail art.',           'hand',     3),
  ('sobrancelhas',     'beleza',   'Design de sobrancelhas', 'Design, henna e brow lamination.',                      'eye',      4),
  ('lash',             'beleza',   'Lash designer',          'Extensão e lifting de cílios.',                         'eye',      5),
  ('maquiagem',        'beleza',   'Maquiagem',              'Maquiagem social, para festas e para noivas.',          'brush',    6),
  ('clinica-estetica', 'estetica', 'Clínica de estética',    'Tratamentos faciais e corporais.',                      'sparkles', 10),
  ('depilacao',        'estetica', 'Depilação',              'Depilação com cera, linha ou fotodepilação.',           'sparkles', 11),
  ('massagem',         'estetica', 'Massagem e spa',         'Massagens relaxantes, modeladoras e day spa.',          'flower',   12),
  ('tattoo',           'outros',   'Tatuagem e piercing',    'Tatuagens, piercings e retoques.',                      'pen',      20),
  ('personal',         'outros',   'Personal trainer',       'Treinos individuais e avaliações físicas.',             'dumbbell', 21),
  ('outros-servicos',  'outros',   'Outros serviços',        'Qualquer serviço com hora marcada.',                    'calendar', 22)
on conflict (id) do nothing;

-- espaços antigos com subcategorias que mudaram de nome
update businesses set subcategory = 'clinica-estetica' where subcategory = 'estetica';
update businesses set subcategory = 'sobrancelhas'     where subcategory = 'designer';
update businesses set subcategory = 'massagem'         where subcategory = 'spa';


-- =====================================================================
-- PARTE 4 — Serviços sugeridos por nicho (preços de referência)
-- =====================================================================
insert into niche_service_templates (niche_id, name, category, duration_min, price, description, sort_order)
select * from (values
  ('salao', 'Corte feminino', 'Cabelo', 60, 80.00, 'Corte com lavagem e finalização.', 1),
  ('salao', 'Escova', 'Cabelo', 45, 50.00, 'Escova modelada com finalização.', 2),
  ('salao', 'Coloração', 'Coloração', 120, 150.00, 'Coloração completa com produtos profissionais.', 3),
  ('salao', 'Mechas / Luzes', 'Coloração', 180, 280.00, 'Mechas com técnica de iluminação.', 4),
  ('salao', 'Hidratação', 'Tratamento', 60, 70.00, 'Hidratação profunda e brilho.', 5),
  ('barbearia', 'Corte masculino', 'Cabelo', 30, 45.00, 'Corte na tesoura ou máquina.', 1),
  ('barbearia', 'Barba', 'Barba', 30, 35.00, 'Barba com toalha quente e navalha.', 2),
  ('barbearia', 'Corte + Barba', 'Combo', 60, 70.00, 'Combo completo.', 3),
  ('barbearia', 'Sobrancelha', 'Acabamento', 15, 15.00, 'Alinhamento na navalha.', 4),
  ('unhas', 'Manicure', 'Mãos', 45, 35.00, 'Cutilagem e esmaltação.', 1),
  ('unhas', 'Pedicure', 'Pés', 50, 40.00, 'Cuidado completo dos pés.', 2),
  ('unhas', 'Esmaltação em gel', 'Mãos', 60, 70.00, 'Esmaltação de longa duração.', 3),
  ('unhas', 'Alongamento em fibra', 'Alongamento', 120, 150.00, 'Alongamento com acabamento natural.', 4),
  ('sobrancelhas', 'Design de sobrancelhas', 'Sobrancelhas', 40, 45.00, 'Design personalizado.', 1),
  ('sobrancelhas', 'Design com henna', 'Sobrancelhas', 50, 60.00, 'Design com preenchimento em henna.', 2),
  ('sobrancelhas', 'Brow lamination', 'Sobrancelhas', 60, 120.00, 'Alinhamento e volume dos fios.', 3),
  ('lash', 'Extensão de cílios fio a fio', 'Cílios', 120, 150.00, 'Aplicação clássica.', 1),
  ('lash', 'Volume brasileiro', 'Cílios', 150, 180.00, 'Mais volume e curvatura.', 2),
  ('lash', 'Manutenção', 'Cílios', 90, 90.00, 'Reposição dos fios.', 3),
  ('lash', 'Lash lifting', 'Cílios', 60, 120.00, 'Curvatura dos cílios naturais.', 4),
  ('maquiagem', 'Maquiagem social', 'Maquiagem', 60, 150.00, 'Para eventos e festas.', 1),
  ('maquiagem', 'Maquiagem para noivas', 'Maquiagem', 120, 450.00, 'Com teste prévio.', 2),
  ('clinica-estetica', 'Limpeza de pele', 'Facial', 90, 150.00, 'Higienização, extração e máscara calmante.', 1),
  ('clinica-estetica', 'Peeling', 'Facial', 60, 180.00, 'Renovação e uniformização da pele.', 2),
  ('clinica-estetica', 'Drenagem linfática', 'Corporal', 60, 120.00, 'Sensação de leveza e redução de inchaço.', 3),
  ('clinica-estetica', 'Massagem modeladora', 'Corporal', 60, 130.00, 'Massagem vigorosa para contorno.', 4),
  ('depilacao', 'Depilação de pernas', 'Corpo', 45, 70.00, 'Pernas completas com cera.', 1),
  ('depilacao', 'Depilação de axilas', 'Corpo', 15, 25.00, 'Com cera.', 2),
  ('depilacao', 'Depilação de buço', 'Rosto', 10, 15.00, 'Com cera ou linha.', 3),
  ('massagem', 'Massagem relaxante', 'Massagem', 60, 120.00, 'Alívio de tensões e bem-estar.', 1),
  ('massagem', 'Pedras quentes', 'Massagem', 75, 150.00, 'Relaxamento profundo.', 2),
  ('massagem', 'Day spa', 'Spa', 180, 350.00, 'Ritual completo de cuidados.', 3),
  ('tattoo', 'Avaliação de projeto', 'Tatuagem', 30, 0.00, 'Conversa sobre a ideia e orçamento.', 1),
  ('tattoo', 'Sessão de tatuagem', 'Tatuagem', 180, 400.00, 'Sessão por tempo.', 2),
  ('tattoo', 'Piercing', 'Piercing', 30, 80.00, 'Aplicação com joia inclusa.', 3),
  ('personal', 'Aula avulsa', 'Treino', 60, 80.00, 'Treino individual.', 1),
  ('personal', 'Avaliação inicial', 'Avaliação', 45, 60.00, 'Avaliação e definição de metas.', 2),
  ('outros-servicos', 'Atendimento', 'Atendimentos', 60, 100.00, 'Atendimento padrão.', 1),
  ('outros-servicos', 'Avaliação inicial', 'Atendimentos', 30, 50.00, 'Primeiro contato.', 2)
) as v(niche_id, name, category, duration_min, price, description, sort_order)
where not exists (select 1 from niche_service_templates t where t.niche_id = v.niche_id and t.name = v.name);


-- =====================================================================
-- PARTE 5 — Diretório público com o nome e o ícone do nicho
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
  n.icon as niche_icon
from businesses b
left join reviews r on r.business_id = b.id and r.visible
left join niches n on n.id = b.subcategory
where b.is_published
group by b.id, n.name, n.icon;


-- =====================================================================
-- PARTE 6 — Cadastro passa a receber o nicho
-- =====================================================================
drop function if exists create_business_for_user(text, text, business_segment, text, text);

create or replace function create_business_for_user(
  p_owner_name    text,
  p_business_name text,
  p_segment       business_segment,
  p_whatsapp      text,
  p_slug_base     text,
  p_niche         text default null
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
  v_niche text;
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

  -- nicho só vale se existir, estiver ativo e for do mesmo segmento
  select id into v_niche from niches where id = p_niche and active and segment = p_segment;

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

  insert into businesses (owner_id, owner_name, slug, name, segment, subcategory, phone, whatsapp,
                          whatsapp_message, terms_accepted_at, hero_image)
  values (v_uid, trim(p_owner_name), v_slug, trim(p_business_name), p_segment, v_niche,
          '(' || left(v_wa, 2) || ') ' || substr(v_wa, 3, char_length(v_wa) - 6) || '-' || right(v_wa, 4),
          '55' || v_wa,
          'Olá! Vim pela sua vitrine e gostaria de agendar um horário.',
          now(), null)
  returning id into v_biz;

  update professionals set name = trim(p_owner_name)
   where business_id = v_biz and user_id = v_uid;

  insert into subscriptions (business_id, status, trial_ends_at)
  values (v_biz, 'trialing', now() + interval '15 days');

  return json_build_object('business_id', v_biz, 'slug', v_slug);
end;
$$;

revoke all on function create_business_for_user(text, text, business_segment, text, text, text) from public, anon;
grant execute on function create_business_for_user(text, text, business_segment, text, text, text) to authenticated;


-- =====================================================================
-- PARTE 7 — Conferência
-- =====================================================================
select n.segment, n.name, count(t.id) as sugestoes
from niches n left join niche_service_templates t on t.niche_id = n.id
group by n.segment, n.name, n.sort_order
order by n.sort_order;

select exists (select 1 from platform_admins) as admin_cadastrado;
