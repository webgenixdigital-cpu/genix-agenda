-- =====================================================================
-- 38b — Conferência da migration 38 (só leitura). Rode cada consulta separada.
-- =====================================================================

-- 1) Tabela e RLS
select relname, relrowsecurity from pg_class where relname = 'plan_grants';

-- 2) Funções novas/alteradas usam a concessão
select proname, position('active_plan_grant' in prosrc) > 0 as usa_concessao
  from pg_proc where proname in ('access_tier', 'plan_kind', 'active_plan_grant');

-- 3) Concessões gravadas
select g.*, b.name, access_tier(g.business_id) as tier, plan_kind(g.business_id) as plano,
       plan_max_professionals(g.business_id) as max_prof
  from plan_grants g join businesses b on b.id = g.business_id;

-- 4) Estado da conta matriz
select b.id, b.name, s.status, s.plan_id, s.trial_ends_at, s.asaas_subscription_id,
       access_tier(b.id) as tier, plan_kind(b.id) as plano, plan_max_professionals(b.id) as max_prof
  from businesses b left join subscriptions s on s.business_id = b.id
 where b.id = 'e57523b5-bd1f-4441-bb10-337ea8b7ca49';

-- 5) Nenhum outro espaço mudou: contagem por tier (compare com antes)
select access_tier(id) as tier, plan_kind(id) as plano, count(*) from businesses group by 1, 2 order by 1, 2;
