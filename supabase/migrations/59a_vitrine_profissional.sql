-- =====================================================================
-- GENIX AGENDA — 59: Vitrine com agendamento online só a partir do
-- Profissional; Grátis e Básico com "cartão de visita" (PARTE A)
-- ✅ Rodar ANTES do merge/deploy. Só ACRESCENTA: nada deixa de funcionar.
-- Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   • vitrine_online_allowed(bid): a regra única da vitrine online
--     (= plan_allows(bid, 'profissional'); cortesia e teste do Equipe liberam).
--     Leitura para anon (vitrine/diretório) e authenticated (painel).
--   • moderação de avaliações (ocultar/excluir) passa a valer em TODOS os
--     planos (antes exigia plano pago: o Grátis não conseguia ocultar).
--
-- A PARTE B (59b) é a que tira acesso e roda DEPOIS do deploy.
-- Reversão comentada no final.
-- =====================================================================

begin;

-- =====================================================================
-- PARTE 1 — Regra da vitrine online
-- =====================================================================
create or replace function vitrine_online_allowed(bid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(plan_allows(bid, 'profissional'), false);
$$;
revoke all on function vitrine_online_allowed(uuid) from public;
grant execute on function vitrine_online_allowed(uuid) to anon, authenticated;


-- =====================================================================
-- PARTE 2 — Avaliações: a matriz modera em qualquer plano
-- (antes: is_business_owner + access_tier = 'completo', migration 10)
-- =====================================================================
drop policy if exists "matriz modera avaliacoes" on reviews;
create policy "matriz modera avaliacoes" on reviews
  for update to authenticated
  using (is_business_owner(business_id))
  with check (is_business_owner(business_id));

drop policy if exists "matriz exclui avaliacoes" on reviews;
create policy "matriz exclui avaliacoes" on reviews
  for delete to authenticated
  using (is_business_owner(business_id));

commit;

-- =====================================================================
-- CONFERÊNCIA (rodar depois; só leitura)
-- =====================================================================
-- select proname from pg_proc where proname = 'vitrine_online_allowed';          -- 1 linha
-- select policyname, qual from pg_policies where tablename = 'reviews'
--  and policyname like 'matriz%';                                              -- sem access_tier

-- =====================================================================
-- REVERSÃO (rodar inteira se precisar desfazer)
-- =====================================================================
-- begin;
-- drop policy if exists "matriz modera avaliacoes" on reviews;
-- create policy "matriz modera avaliacoes" on reviews for update to authenticated
--   using (is_business_owner(business_id) and access_tier(business_id) = 'completo')
--   with check (is_business_owner(business_id) and access_tier(business_id) = 'completo');
-- drop policy if exists "matriz exclui avaliacoes" on reviews;
-- create policy "matriz exclui avaliacoes" on reviews for delete to authenticated
--   using (is_business_owner(business_id) and access_tier(business_id) = 'completo');
-- drop function if exists vitrine_online_allowed(uuid);   -- só depois de reverter a 59b
-- commit;
