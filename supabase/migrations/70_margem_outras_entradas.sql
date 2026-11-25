-- =====================================================================
-- 70 — Margem do Caixa: "Outras entradas do período"
--
-- finance_margin_summary (69) passa a devolver também:
--   other_income      = soma das ENTRADAS (kind income) do caixa no período
--                       (entry_date, o mesmo filtro do Caixa) SEM booking_id:
--                       venda de pacote, produtos, lançamentos avulsos.
--   other_by_category = a mesma soma por categoria ({"pacote": 2.00, ...}).
-- Essas entradas aparecem no saldo do Caixa, mas não entram na margem nem no
-- lucro estimado (que medem só os atendimentos). O resto da função é igual à 69.
-- Só leitura; mesmos grants. Todo DELETE/UPDATE com WHERE (pg-safeupdate).
--
-- Rodar no SQL Editor (depois da 69). Reversão no fim (volta a função da 69).
-- =====================================================================

create or replace function finance_margin_summary(p_business uuid, p_from date, p_to date)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  ps        pricing_settings;
  v_rev     numeric;
  v_cost    numeric;
  v_n_ok    int;
  v_n_no    int;
  v_n_pkg   int;
  v_rev_no  numeric;
  v_recv    numeric;
  v_tax     numeric;
  v_fees    numeric;
  v_comm    numeric;
  v_fixed   numeric;
  v_days    int;
  v_profit  json := null;
  v_other   numeric;
  v_other_by json;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(p_business, 'basico') then raise exception 'PLANO_BASICO'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'DADOS_INVALIDOS'; end if;

  create temporary table if not exists _margin_bk (
    id uuid, price numeric, charge numeric, paid numeric, pending boolean, pkg boolean,
    partner_pct numeric, commission_pct numeric, has_cost boolean, cost numeric
  ) on commit drop;
  delete from _margin_bk where true;   -- PostgREST (pg_safeupdate) recusa delete sem where

  insert into _margin_bk
  select b.id, b.price, booking_charge(b.id), b.amount_paid, b.payment_status = 'pending',
         exists (select 1 from booking_items i where i.booking_id = b.id and i.paid_by_package)
           or (b.customer_package_id is not null and not exists (select 1 from booking_items i where i.booking_id = b.id)),
         b.partner_pct, p.commission_pct,
         exists (select 1 from booking_item_costs c where c.booking_id = b.id)
           and not exists (select 1 from booking_item_costs c where c.booking_id = b.id and c.cost is null),
         (select sum(c.cost) from booking_item_costs c where c.booking_id = b.id)
    from bookings b
    left join professionals p on p.id = b.professional_id
   where b.business_id = p_business
     and b.status = 'completed'
     and b.booking_date between p_from and p_to;

  select coalesce(sum(charge) filter (where has_cost), 0),
         coalesce(sum(cost)   filter (where has_cost), 0),
         count(*) filter (where has_cost),
         count(*) filter (where not has_cost),
         count(*) filter (where has_cost and pkg),
         coalesce(sum(charge) filter (where not has_cost), 0),
         coalesce(sum(greatest(charge - paid, 0)) filter (where pending), 0)
    into v_rev, v_cost, v_n_ok, v_n_no, v_n_pkg, v_rev_no, v_recv
    from _margin_bk;

  -- 70: outras entradas do período (sem atendimento ligado), pela data do lançamento
  select coalesce(sum(t.total), 0),
         coalesce(json_object_agg(t.category, t.total), '{}'::json)
    into v_other, v_other_by
    from (select ce.category::text as category, sum(ce.amount) as total
            from cash_entries ce
           where ce.business_id = p_business
             and ce.kind = 'income'
             and ce.booking_id is null
             and ce.entry_date between p_from and p_to
           group by ce.category) t;

  select * into ps from pricing_settings where business_id = p_business;
  if found and plan_allows(p_business, 'profissional') then
    v_days  := (p_to - p_from) + 1;
    v_tax   := round(v_rev * ps.tax_pct / 100, 2);
    select coalesce(round(sum(ce.amount * case ce.method
                                when 'credito'  then ps.fee_credito_pct
                                when 'debito'   then ps.fee_debito_pct
                                when 'pix'      then ps.fee_pix_pct
                                when 'dinheiro' then ps.fee_dinheiro_pct
                                else 0 end / 100), 2), 0)
      into v_fees
      from cash_entries ce
      join _margin_bk m on m.id = ce.booking_id and m.has_cost
     where ce.kind = 'income';
    v_comm := case when plan_allows(p_business, 'equipe') then
                (select coalesce(round(sum(m.price * coalesce(nullif(m.partner_pct, 0), m.commission_pct, 0) / 100), 2), 0)
                   from _margin_bk m where m.has_cost)
              else 0 end;
    select coalesce(sum((x->>'amount')::numeric), 0) into v_fixed from jsonb_array_elements(ps.fixed_costs) x;
    v_fixed := round(v_fixed * v_days / 30, 2);
    v_profit := json_build_object(
      'taxes', v_tax, 'fees', v_fees, 'commissions', v_comm, 'fixed', v_fixed, 'days', v_days,
      'profit', round(v_rev - v_cost - v_tax - v_fees - v_comm - v_fixed, 2));
  end if;

  return json_build_object(
    'revenue', v_rev, 'cost', v_cost, 'margin', v_rev - v_cost,
    'margin_pct', case when v_rev > 0 then round((v_rev - v_cost) * 100 / v_rev, 1) end,
    'with_cost', v_n_ok, 'without_cost', v_n_no, 'revenue_without_cost', v_rev_no,
    'package_sessions', v_n_pkg, 'to_receive', v_recv,
    'other_income', v_other, 'other_by_category', v_other_by,
    'estimate', v_profit);
end;
$$;
revoke all on function finance_margin_summary(uuid, date, date) from public, anon;
grant execute on function finance_margin_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Conferência (opcional, só leitura):
--   select pg_get_functiondef('finance_margin_summary(uuid,date,date)'::regprocedure) like '%other_by_category%';
--
-- Reversão: rodar de novo a função finance_margin_summary da 69
-- (supabase/migrations/69_custo_servico_calculadora.sql, PARTE 5, já com o "where true").
-- ---------------------------------------------------------------------
