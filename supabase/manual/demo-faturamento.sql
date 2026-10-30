-- =====================================================================
-- DEMONSTRAÇÃO — enquadramento do Lumina (opcional)
-- Rodar DEPOIS da 24_faturamento.sql, só se quiser que a demo mostre o
-- painel Faturamento preenchido. Não cria lançamentos: usa o caixa que a
-- demonstração já tem.
-- =====================================================================
insert into business_fiscal (business_id, regime)
select id, 'mei' from businesses where slug = 'luminabelle' and is_demo
on conflict (business_id) do nothing;

-- Reversão: delete from business_fiscal where business_id = (select id from businesses where slug = 'luminabelle');
