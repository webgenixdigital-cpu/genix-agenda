-- =====================================================================
-- GENIX AGENDA — 58: Metas
-- Aditiva. Rodar ANTES do merge (a tela nova lê a tabela e as funções
-- daqui). Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   • business_goals: metas do espaço (ou de 1 profissional, só no Equipe)
--     de faturamento, atendimentos, ticket médio e clientes novos, com
--     período (início/fim, até 366 dias);
--   • a partir do Profissional (plan_allows 'profissional'); matriz e
--     recepção criam, editam e excluem; a demonstração (viewer) só lê;
--     o profissional (staff) não vê;
--   • escrita só por save_goal / delete_goal (sem política de escrita);
--   • goals_with_progress devolve cada meta com o realizado: SÓ totais,
--     nunca lançamentos. A recepção continua sem ler cash_entries.
--
-- Como o realizado é contado (datas puras, sem fuso):
--   • faturamento: entradas (income) do caixa com entry_date no período,
--     pela DATA DO PAGAMENTO (igual ao Financeiro). Meta de profissional:
--     só entradas ligadas a atendimento desse profissional (venda de
--     pacote e produto ficam de fora);
--   • atendimentos: bookings concluídos com booking_date no período;
--   • ticket médio: entradas ligadas a atendimento no período ÷ quantidade
--     dessas entradas (valor médio cobrado por atendimento pago);
--   • clientes novos: clientes cujo 1º atendimento concluído do espaço cai
--     no período (meta de profissional: esse 1º atendimento foi com ele).
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Tabela
-- =====================================================================
create table if not exists business_goals (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  kind            text not null,
  target          numeric(12,2) not null,
  period_start    date not null,
  period_end      date not null,
  professional_id uuid references professionals(id) on delete cascade,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint business_goals_kind_valid
    check (kind in ('faturamento', 'atendimentos', 'ticket_medio', 'clientes_novos')),
  constraint business_goals_target_valid check (target > 0),
  constraint business_goals_period_valid
    check (period_end >= period_start and period_end - period_start <= 365)
);

create index if not exists idx_business_goals_business on business_goals (business_id, period_end);

drop trigger if exists trg_business_goals_updated on business_goals;
create trigger trg_business_goals_updated before update on business_goals
  for each row execute function set_updated_at();

alter table business_goals enable row level security;
drop policy if exists "matriz e recepcao veem metas" on business_goals;
create policy "matriz e recepcao veem metas" on business_goals
  for select to authenticated
  using (coalesce(member_role_of(business_id) in ('owner', 'reception', 'viewer'), false)
         and plan_allows(business_id, 'profissional'));
-- sem políticas de escrita: só save_goal / delete_goal


-- =====================================================================
-- PARTE 2 — Gravar (criar ou editar)
-- =====================================================================
create or replace function save_goal(
  p_business     uuid,
  p_id           uuid,
  p_kind         text,
  p_target       numeric,
  p_start        date,
  p_end          date,
  p_professional uuid
)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if not plan_allows(p_business, 'profissional') then
    raise exception 'PLANO_PROFISSIONAL';
  end if;

  if p_kind is null or p_kind not in ('faturamento', 'atendimentos', 'ticket_medio', 'clientes_novos') then
    raise exception 'TIPO_INVALIDO';
  end if;
  if p_target is null or p_target <= 0 or p_target > 9999999999.99
     or (p_kind in ('atendimentos', 'clientes_novos') and p_target <> trunc(p_target)) then
    raise exception 'VALOR_INVALIDO';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365 then
    raise exception 'DATA_INVALIDA';
  end if;

  if p_professional is not null then
    if not plan_allows(p_business, 'equipe') then
      raise exception 'PLANO_EQUIPE';
    end if;
    if not exists (select 1 from professionals where id = p_professional and business_id = p_business) then
      raise exception 'NAO_ENCONTRADO';
    end if;
  end if;

  if p_id is null then
    insert into business_goals (business_id, kind, target, period_start, period_end, professional_id, created_by)
    values (p_business, p_kind, round(p_target, 2), p_start, p_end, p_professional, auth.uid())
    returning id into v_id;
  else
    -- security definer passa por cima da RLS: a meta precisa ser DESTE espaço
    update business_goals
       set kind = p_kind, target = round(p_target, 2), period_start = p_start,
           period_end = p_end, professional_id = p_professional
     where id = p_id and business_id = p_business
    returning id into v_id;
    if v_id is null then
      raise exception 'NAO_ENCONTRADO';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function save_goal(uuid, uuid, text, numeric, date, date, uuid) from public, anon;
grant execute on function save_goal(uuid, uuid, text, numeric, date, date, uuid) to authenticated;


-- =====================================================================
-- PARTE 3 — Excluir
-- =====================================================================
create or replace function delete_goal(p_business uuid, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if not plan_allows(p_business, 'profissional') then
    raise exception 'PLANO_PROFISSIONAL';
  end if;

  delete from business_goals where id = p_id and business_id = p_business;
  if not found then
    raise exception 'NAO_ENCONTRADO';
  end if;
end;
$$;

revoke all on function delete_goal(uuid, uuid) from public, anon;
grant execute on function delete_goal(uuid, uuid) to authenticated;


-- =====================================================================
-- PARTE 4 — Metas com o realizado (só totais)
-- realized: R$ (faturamento, ticket médio) ou quantidade (atendimentos,
-- clientes novos); base_count: quantos itens entraram na conta
-- (lançamentos, atendimentos ou clientes).
-- =====================================================================
create or replace function goals_with_progress(p_business uuid)
returns table (
  id              uuid,
  kind            text,
  target          numeric,
  period_start    date,
  period_end      date,
  professional_id uuid,
  professional_name text,
  realized        numeric,
  base_count      int
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if not plan_allows(p_business, 'profissional') then
    raise exception 'PLANO_PROFISSIONAL';
  end if;

  return query
  with first_visit as (
    -- 1º atendimento concluído de cada cliente no espaço
    select distinct on (b.customer_id) b.customer_id, b.booking_date, b.professional_id
      from bookings b
     where b.business_id = p_business and b.status = 'completed' and b.customer_id is not null
     order by b.customer_id, b.booking_date, b.start_time, b.created_at
  )
  select g.id, g.kind, g.target, g.period_start, g.period_end, g.professional_id, pr.name,
         m.realized, m.base_count
    from business_goals g
    left join professionals pr on pr.id = g.professional_id
    cross join lateral (
      select
        case g.kind
          when 'faturamento' then coalesce((
            select sum(ce.amount) from cash_entries ce
              left join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id)), 0)
          when 'ticket_medio' then coalesce((
            select round(avg(ce.amount), 2) from cash_entries ce
              join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id)), 0)
          when 'atendimentos' then (
            select count(*) from bookings bk
             where bk.business_id = p_business and bk.status = 'completed'
               and bk.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::numeric
          else (
            select count(*) from first_visit fv
             where fv.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or fv.professional_id = g.professional_id))::numeric
        end as realized,
        case g.kind
          when 'faturamento' then (
            select count(*) from cash_entries ce
              left join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::int
          when 'ticket_medio' then (
            select count(*) from cash_entries ce
              join bookings bk on bk.id = ce.booking_id
             where ce.business_id = p_business and ce.kind = 'income'
               and ce.entry_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::int
          when 'atendimentos' then (
            select count(*) from bookings bk
             where bk.business_id = p_business and bk.status = 'completed'
               and bk.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or bk.professional_id = g.professional_id))::int
          else (
            select count(*) from first_visit fv
             where fv.booking_date between g.period_start and g.period_end
               and (g.professional_id is null or fv.professional_id = g.professional_id))::int
        end as base_count
    ) m
   where g.business_id = p_business
   order by g.period_end desc, g.period_start desc, g.created_at;
end;
$$;

revoke all on function goals_with_progress(uuid) from public, anon;
grant execute on function goals_with_progress(uuid) to authenticated;

commit;


-- =====================================================================
-- CONFERIR (depois de rodar)
-- =====================================================================
-- 1) Funções criadas:
-- select proname from pg_proc where proname in ('save_goal', 'delete_goal', 'goals_with_progress') order by 1;
--
-- 2) A demonstração precisa estar no Profissional ou no Equipe para mostrar
--    a lista (sem assinatura, o plan_kind cai em 'equipe'):
-- select b.name, b.slug, b.is_demo, plan_kind(b.id) as plano
--   from businesses b where b.slug = 'luminabelle';
--
-- 3) OPCIONAL — metas de exemplo SÓ na demonstração (nunca em contas de
--    clientes). Só cria se a conta for a demo e ainda não tiver metas:
-- insert into business_goals (business_id, kind, target, period_start, period_end)
-- select b.id, v.kind, v.target,
--        date_trunc('month', now() at time zone b.timezone)::date,
--        (date_trunc('month', now() at time zone b.timezone) + interval '1 month - 1 day')::date
--   from businesses b
--  cross join (values ('faturamento', 8000::numeric), ('atendimentos', 90), ('clientes_novos', 12)) as v(kind, target)
--  where b.slug = 'luminabelle' and b.is_demo
--    and not exists (select 1 from business_goals g where g.business_id = b.id);


-- =====================================================================
-- REVERSÃO (rodar inteira; antes, volte o código)
-- =====================================================================
-- begin;
-- drop function if exists goals_with_progress(uuid);
-- drop function if exists delete_goal(uuid, uuid);
-- drop function if exists save_goal(uuid, uuid, text, numeric, date, date, uuid);
-- drop table if exists business_goals;
-- commit;
