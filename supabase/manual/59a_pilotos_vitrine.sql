-- =====================================================================
-- 59 — CONFERÊNCIA ANTES DA PARTE B (só leitura: só SELECT, nada grava)
-- Espaços que hoje recebem agendamento online e que, depois da 59 parte B,
-- ficam só com o cartão de visita (vitrine online só a partir do Profissional):
--   • em teste (o teste do Equipe libera a vitrine até trial_ends_at);
--   • no Grátis (teste vencido, sem assinatura);
--   • no Básico pago.
-- Cortesia ativa (plan_grants) aparece na coluna "cortesia" e NÃO perde nada.
-- Rodar no SQL Editor do Supabase. Os agendamentos já marcados continuam valendo.
-- =====================================================================
with alvo as (
  select
    b.id,
    b.name                                  as espaco,
    b.slug,
    plan_kind(b.id)                         as plano_hoje,
    s.status                                as assinatura,
    s.trial_ends_at at time zone b.timezone as fim_do_teste,
    s.free_ends_at  at time zone b.timezone as fim_do_gratis,
    active_plan_grant(b.id)                 as cortesia,
    (now() at time zone b.timezone)::date   as hoje
  from businesses b
  left join subscriptions s on s.business_id = b.id
  where b.is_published
    and not b.is_demo
)
select
  a.espaco,
  a.slug,
  a.plano_hoje,
  a.assinatura,
  case when a.assinatura = 'trialing' then a.fim_do_teste end as fim_do_teste,
  a.fim_do_gratis,
  a.cortesia,
  count(bk.id) filter (where bk.booking_date >= a.hoje)                       as online_futuros,
  min(bk.booking_date) filter (where bk.booking_date >= a.hoje)               as proximo_online,
  max(bk.booking_date) filter (where bk.booking_date >= a.hoje)               as ultimo_online,
  count(bk.id) filter (where bk.created_at > now() - interval '30 days')      as online_criados_30d
from alvo a
join bookings bk
  on bk.business_id = a.id
 and bk.source = 'online'
 and bk.status in ('pending', 'confirmed')
where a.cortesia is null
  and (a.assinatura = 'trialing' or a.plano_hoje in ('gratis', 'basico'))
group by a.espaco, a.slug, a.plano_hoje, a.assinatura, a.fim_do_teste, a.fim_do_gratis, a.cortesia
having count(bk.id) filter (where bk.booking_date >= a.hoje) > 0
order by online_futuros desc, a.espaco;

-- Variante: todos os espaços publicados que perdem a vitrine (mesmo sem agendamento futuro).
-- select b.name, b.slug, plan_kind(b.id) as plano, s.status, s.trial_ends_at, s.free_ends_at
--   from businesses b left join subscriptions s on s.business_id = b.id
--  where b.is_published and not b.is_demo and active_plan_grant(b.id) is null
--    and (s.status = 'trialing' or plan_kind(b.id) in ('gratis', 'basico'))
--  order by s.trial_ends_at nulls last;
