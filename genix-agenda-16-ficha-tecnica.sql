-- =====================================================================
-- GENIX AGENDA — N3.1: FICHA TÉCNICA DO CLIENTE POR NICHO
-- Rode o arquivo inteiro no SQL Editor.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Campos da ficha de cada nicho (administrados pela Genix)
-- =====================================================================
create table if not exists niche_profile_fields (
  id          uuid primary key default gen_random_uuid(),
  niche_id    text not null references niches(id) on delete cascade on update cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  type        text not null default 'text' check (type in ('text', 'textarea', 'select')),
  options     text[] not null default '{}',
  help        text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (niche_id, key)
);

create index if not exists idx_profile_fields_niche on niche_profile_fields (niche_id, sort_order);

alter table niche_profile_fields enable row level security;
drop policy if exists "todos leem campos" on niche_profile_fields;
drop policy if exists "admin gerencia campos" on niche_profile_fields;
create policy "todos leem campos" on niche_profile_fields for select using (true);
create policy "admin gerencia campos" on niche_profile_fields for all to authenticated
  using (is_platform_admin()) with check (is_platform_admin());


-- =====================================================================
-- PARTE 2 — Respostas da ficha guardadas no cliente
-- =====================================================================
alter table customers add column if not exists profile jsonb not null default '{}'::jsonb;


-- =====================================================================
-- PARTE 3 — Campos iniciais (sem dados de saúde)
-- =====================================================================
insert into niche_profile_fields (niche_id, key, label, type, options, help, sort_order)
select * from (values
  ('salao', 'tipo_cabelo', 'Tipo de cabelo', 'select', array['Liso','Ondulado','Cacheado','Crespo'], null, 1),
  ('salao', 'comprimento', 'Comprimento', 'select', array['Curto','Médio','Longo'], null, 2),
  ('salao', 'formula_coloracao', 'Fórmula de coloração', 'textarea', '{}'::text[], 'Marca, tom, volume da oxigenada e tempo de pausa.', 3),
  ('salao', 'quimicas_anteriores', 'Químicas anteriores', 'textarea', '{}'::text[], 'Progressiva, descoloração, coloração... e quando foi feita.', 4),
  ('salao', 'preferencias', 'Preferências', 'textarea', '{}'::text[], null, 5),

  ('barbearia', 'estilo_corte', 'Estilo de corte', 'text', '{}'::text[], null, 1),
  ('barbearia', 'maquina_laterais', 'Máquina / altura nas laterais', 'text', '{}'::text[], 'Ex.: degradê na 0 até a 2.', 2),
  ('barbearia', 'barba', 'Barba', 'select', array['Sem barba','Curta','Média','Longa'], null, 3),
  ('barbearia', 'preferencias', 'Preferências', 'textarea', '{}'::text[], null, 4),

  ('unhas', 'formato', 'Formato', 'select', array['Quadrada','Redonda','Amendoada','Stiletto','Bailarina'], null, 1),
  ('unhas', 'comprimento', 'Comprimento', 'select', array['Curto','Médio','Longo'], null, 2),
  ('unhas', 'tecnica', 'Técnica', 'select', array['Esmaltação comum','Gel','Fibra','Acrílico','Banho de gel'], null, 3),
  ('unhas', 'cores_favoritas', 'Cores favoritas', 'text', '{}'::text[], null, 4),

  ('sobrancelhas', 'formato_desejado', 'Formato desejado', 'text', '{}'::text[], null, 1),
  ('sobrancelhas', 'cor_henna', 'Cor da henna', 'text', '{}'::text[], null, 2),
  ('sobrancelhas', 'observacoes', 'Observações do design', 'textarea', '{}'::text[], null, 3),

  ('lash', 'tecnica', 'Técnica', 'select', array['Fio a fio','Volume brasileiro','Volume russo','Lash lifting'], null, 1),
  ('lash', 'curvatura', 'Curvatura', 'select', array['B','C','CC','D','L'], null, 2),
  ('lash', 'espessura', 'Espessura', 'text', '{}'::text[], 'Ex.: 0,15', 3),
  ('lash', 'comprimento_mm', 'Comprimento (mm)', 'text', '{}'::text[], 'Ex.: 9-12', 4),
  ('lash', 'mapeamento', 'Mapeamento', 'textarea', '{}'::text[], 'Distribuição dos comprimentos por região.', 5),

  ('maquiagem', 'tom_base', 'Tom de base / corretivo', 'text', '{}'::text[], null, 1),
  ('maquiagem', 'estilo', 'Estilo', 'select', array['Natural','Social','Glam','Artística'], null, 2),
  ('maquiagem', 'produtos_preferidos', 'Produtos preferidos', 'textarea', '{}'::text[], null, 3),

  ('clinica-estetica', 'tipo_pele', 'Tipo de pele', 'select', array['Normal','Seca','Oleosa','Mista'], null, 1),
  ('clinica-estetica', 'objetivos', 'Objetivos do tratamento', 'textarea', '{}'::text[], null, 2),
  ('clinica-estetica', 'protocolo', 'Protocolo em andamento', 'textarea', '{}'::text[], 'Sessões realizadas e próximos passos.', 3),

  ('depilacao', 'metodo', 'Método preferido', 'select', array['Cera quente','Cera fria','Linha','Fotodepilação'], null, 1),
  ('depilacao', 'areas_habituais', 'Áreas habituais', 'text', '{}'::text[], null, 2),

  ('massagem', 'pressao', 'Pressão preferida', 'select', array['Leve','Média','Forte'], null, 1),
  ('massagem', 'aroma', 'Aroma preferido', 'text', '{}'::text[], null, 2),
  ('massagem', 'areas_foco', 'Áreas de foco', 'text', '{}'::text[], null, 3),

  ('tattoo', 'estilo', 'Estilo', 'text', '{}'::text[], 'Ex.: fineline, blackwork, realismo.', 1),
  ('tattoo', 'local_tamanho', 'Local e tamanho', 'text', '{}'::text[], null, 2),
  ('tattoo', 'referencias', 'Referências', 'textarea', '{}'::text[], null, 3),

  ('personal', 'objetivo', 'Objetivo', 'select', array['Condicionamento','Emagrecimento','Hipertrofia','Outro'], null, 1),
  ('personal', 'dias_semana', 'Dias por semana', 'text', '{}'::text[], null, 2),
  ('personal', 'local_treino', 'Local de treino', 'text', '{}'::text[], null, 3),

  ('outros-servicos', 'preferencias', 'Preferências', 'textarea', '{}'::text[], null, 1)
) as v(niche_id, key, label, type, options, help, sort_order)
where exists (select 1 from niches n where n.id = v.niche_id)
on conflict (niche_id, key) do nothing;


-- =====================================================================
-- PARTE 4 — Conferência
-- =====================================================================
select n.name, count(f.id) as campos
from niches n left join niche_profile_fields f on f.niche_id = n.id
group by n.name, n.sort_order
order by n.sort_order;
