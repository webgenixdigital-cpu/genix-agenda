-- =====================================================================
-- GENIX AGENDA — Planos Grátis / Profissional / Equipe (PARTE B)
-- ⚠️ Rodar DEPOIS do deploy do código novo (e depois da 28a).
-- Antes do deploy, a tela de preços antiga mostraria valores errados.
-- Pode rodar de novo sem erro.
--
-- O que faz:
--   • ativa Grátis, Profissional e Equipe na tela de preços;
--   • tira da tela os planos antigos 'mensal'/'anual' (as assinaturas
--     atuais continuam neles, como Equipe, com o mesmo valor);
--   • Grátis passa de 10 para 6 agendamentos online por dia (só vale
--     para pedidos novos; nada já marcado é cancelado).
-- Reversão comentada no final.
-- =====================================================================

update plans set active = true
 where id in ('gratis', 'profissional_mensal', 'profissional_anual', 'equipe_mensal', 'equipe_anual');

update plans set active = false where id in ('mensal', 'anual');

update plans set online_daily_limit = 6 where id = 'gratis';

-- Conferência
select id, kind, active, base_price, online_daily_limit from plans order by active desc, kind, billing_cycle;


-- =====================================================================
-- REVERSÃO DA PARTE B
-- =====================================================================
-- update plans set online_daily_limit = 10 where id = 'gratis';
-- update plans set active = true where id in ('mensal', 'anual');
-- update plans set active = false
--  where id in ('gratis', 'profissional_mensal', 'profissional_anual', 'equipe_mensal', 'equipe_anual');
-- =====================================================================
