-- =====================================================================
-- 38c — Cortesia vitalícia do plano Equipe para a conta matriz
-- Rode DEPOIS do merge do PR (migration 38 já aplicada).
-- Antes: se o espaço tiver asaas_subscription_id, cancele a assinatura no Asaas.
-- =====================================================================
begin;

insert into plan_grants (business_id, kind, reason, granted_by, expires_at)
select 'e57523b5-bd1f-4441-bb10-337ea8b7ca49', 'equipe', 'Conta matriz Genix (cortesia vitalícia)',
       (select id from auth.users where email = 'webgenixdigital@gmail.com'), null
on conflict (business_id) do update
set kind = excluded.kind, reason = excluded.reason, granted_by = excluded.granted_by,
    granted_at = now(), expires_at = null;

commit;

-- Conferência (esperado: completo | equipe | null)
select access_tier(id) as tier, plan_kind(id) as plano, plan_max_professionals(id) as max_prof
  from businesses where id = 'e57523b5-bd1f-4441-bb10-337ea8b7ca49';

-- Desfazer só a concessão:
-- delete from plan_grants where business_id = 'e57523b5-bd1f-4441-bb10-337ea8b7ca49';
