-- =====================================================================
-- GENIX AGENDA — Nichos em destaque na página principal
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta).
-- Reversão comentada no final.
--
-- A "/" mostra os nichos ativos com featured = true, pela featured_order.
-- Sem nenhum marcado, a página cai nos 8 primeiros por sort_order.
-- As políticas atuais de niches (leitura pública dos ativos, escrita só
-- do admin da plataforma) já cobrem as colunas novas.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Colunas
-- =====================================================================
alter table niches add column if not exists featured boolean not null default false;
alter table niches add column if not exists featured_order int;


-- =====================================================================
-- PARTE 2 — Seleção inicial (só marca os ids que existirem)
-- =====================================================================
update niches n
set featured = true, featured_order = v.o
from (values
  ('salao', 1),
  ('barbearia', 2),
  ('unhas', 3),
  ('sobrancelhas', 4),
  ('lash', 5),
  ('clinica-estetica', 6),
  ('depilacao', 7),
  ('maquiagem', 8)
) as v(id, o)
where n.id = v.id;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; antes, volte o código)
-- =====================================================================
-- alter table niches drop column if exists featured_order;
-- alter table niches drop column if exists featured;
-- =====================================================================
