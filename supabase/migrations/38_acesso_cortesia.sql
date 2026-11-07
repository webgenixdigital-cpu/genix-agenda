-- =====================================================================
-- GENIX AGENDA — 38: Acesso por cortesia (plano pago sem cobrança)
-- Rode o arquivo inteiro no SQL Editor, ANTES do merge. Só acrescenta.
-- Conferência: supabase/manual/38b_conferencia.sql
-- Concessão da conta matriz (DEPOIS do merge): supabase/manual/38c_concessao_matriz.sql
--
-- Regras:
--   • plan_grants guarda a cortesia por espaço (kind, motivo, quem, quando,
--     expires_at; null = vitalícia).
--   • Concessão válida vem ANTES de tudo em access_tier e plan_kind: fim do
--     teste, webhook do Asaas (que só mexe em subscriptions) e crons não
--     rebaixam o espaço.
--   • Sem política de escrita: só o SQL Editor / service role grava.
-- Reversão comentada no final.
-- =====================================================================
begin;

-- PARTE 1 — Tabela das concessões
create table if not exists plan_grants (
  business_id uuid primary key references businesses(id) on delete cascade,
  kind        text not null check (kind in ('profissional', 'equipe')),
  reason      text not null,
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz   -- null = vitalícia
);

alter table plan_grants enable row level security;
drop policy if exists "membro ou admin ve concessao" on plan_grants;
create policy "membro ou admin ve concessao" on plan_grants
  for select to authenticated using (is_business_member(business_id) or is_platform_admin());
-- sem políticas de escrita

-- PARTE 2 — Concessão válida do espaço ('profissional' | 'equipe' | null)
create or replace function active_plan_grant(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select g.kind from plan_grants g
   where g.business_id = bid and (g.expires_at is null or g.expires_at > now());
$$;
grant execute on function active_plan_grant(uuid) to authenticated;

-- PARTE 3 — access_tier: concessão primeiro; o resto igual à 08
create or replace function access_tier(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when active_plan_grant(bid) is not null then 'completo'
    else coalesce(
      (select case
                when s.status = 'active' then 'completo'
                when s.status = 'trialing' and s.trial_ends_at > now() then 'completo'
                when s.status = 'past_due' and coalesce(s.current_period_end, now()) > now() - interval '5 days' then 'completo'
                when s.status = 'canceled' and s.current_period_end > now() then 'completo'
                else 'gratis'
              end
         from subscriptions s where s.business_id = bid),
      'completo'
    )
  end;
$$;

-- PARTE 4 — plan_kind: concessão primeiro; o resto igual à 28a
create or replace function plan_kind(bid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when active_plan_grant(bid) is not null then active_plan_grant(bid)
    when access_tier(bid) = 'gratis' then 'gratis'
    else coalesce(
      (select p.kind
         from subscriptions s join plans p on p.id = s.plan_id
        where s.business_id = bid and s.status <> 'trialing'),
      'equipe'
    )
  end;
$$;

commit;

-- =====================================================================
-- REVERSÃO (rodar inteira se precisar desfazer)
-- =====================================================================
-- begin;
-- create or replace function access_tier(bid uuid)
-- returns text
-- language sql stable security definer set search_path = public
-- as $$
--   select coalesce(
--     (select case
--               when s.status = 'active' then 'completo'
--               when s.status = 'trialing' and s.trial_ends_at > now() then 'completo'
--               when s.status = 'past_due' and coalesce(s.current_period_end, now()) > now() - interval '5 days' then 'completo'
--               when s.status = 'canceled' and s.current_period_end > now() then 'completo'
--               else 'gratis'
--             end
--        from subscriptions s where s.business_id = bid),
--     'completo'
--   );
-- $$;
-- create or replace function plan_kind(bid uuid)
-- returns text
-- language sql stable security definer set search_path = public
-- as $$
--   select case
--     when access_tier(bid) = 'gratis' then 'gratis'
--     else coalesce(
--       (select p.kind
--          from subscriptions s join plans p on p.id = s.plan_id
--         where s.business_id = bid and s.status <> 'trialing'),
--       'equipe'
--     )
--   end;
-- $$;
-- drop function if exists active_plan_grant(uuid);
-- drop table if exists plan_grants;
-- commit;
