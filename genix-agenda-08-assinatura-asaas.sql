-- =====================================================================
-- GENIX AGENDA — AJUSTES PARA A ASSINATURA NO ASAAS
-- Rode o arquivo inteiro no SQL Editor.
-- =====================================================================

-- PARTE 1 — Dados da cobrança pendente e forma de pagamento escolhida
alter table subscriptions
  add column if not exists billing_type        text,
  add column if not exists pending_invoice_url text,
  add column if not exists pending_due_date    date,
  add column if not exists canceled_at         timestamptz;

-- PARTE 2 — Cancelado continua Completo até o fim do período já pago
create or replace function access_tier(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select case
              when s.status = 'active' then 'completo'
              when s.status = 'trialing' and s.trial_ends_at > now() then 'completo'
              when s.status = 'past_due' and coalesce(s.current_period_end, now()) > now() - interval '5 days' then 'completo'
              when s.status = 'canceled' and s.current_period_end > now() then 'completo'
              else 'gratis'
            end
       from subscriptions s where s.business_id = bid),
    'completo'
  );
$$;

-- PARTE 3 — Conferência
select column_name from information_schema.columns
where table_name = 'subscriptions' and column_name in ('billing_type', 'pending_invoice_url', 'pending_due_date', 'canceled_at')
order by column_name;
