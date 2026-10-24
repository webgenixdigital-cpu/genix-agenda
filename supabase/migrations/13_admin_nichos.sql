-- =====================================================================
-- GENIX AGENDA — N1.2: apoio à tela de administração (/genix)
-- =====================================================================

-- Quantos espaços usam um nicho (só administradores podem consultar)
create or replace function niche_usage_count(p_niche text)
returns integer
language sql stable security definer set search_path = public
as $$
  select case when is_platform_admin()
              then (select count(*)::int from businesses where subcategory = p_niche)
              else 0 end;
$$;
grant execute on function niche_usage_count(text) to authenticated;

-- Resumo por nicho para a tela (só administradores)
create or replace function niche_usage_summary()
returns table (niche_id text, businesses integer)
language sql stable security definer set search_path = public
as $$
  select subcategory, count(*)::int
  from businesses
  where is_platform_admin() and subcategory is not null
  group by subcategory;
$$;
grant execute on function niche_usage_summary() to authenticated;

-- Conferência: quantos espaços usam cada nicho
-- (no SQL Editor não há usuário logado, por isso a consulta é direta na tabela)
select subcategory as nicho, count(*) as espacos
from businesses
group by subcategory
order by espacos desc;
