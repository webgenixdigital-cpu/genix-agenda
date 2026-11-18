-- =====================================================================
-- GENIX AGENDA — 54: Cupom de lançamento — ajustes da 53
-- Aditiva (só troca 2 funções). Rodar ANTES do merge. Pode rodar de novo.
--
-- 1) Cobrança ANUAL só sai com desconto se o ano inteiro couber até a data
--    final do desconto (vencimento + 12 meses <= ends_on). Quem assina o
--    anual direto ganha a 1ª anuidade; quem passa do mensal para o anual
--    no meio do desconto paga o anual cheio. Nunca passa de 12 meses.
--    Mensal continua: vencimento < ends_on.
--    "encerrado" (virada registrada) não muda o preço: uma cobrança já gerada
--    com vencimento antes do fim continua com desconto.
-- 2) Anular o desconto (1ª fatura nunca paga) só vale para quem nunca o
--    reaproveitou: quem já pagou com desconto, cancelou e assinou de novo
--    não ganha 12 meses novos ao desistir da fatura nova.
-- Reversão comentada no final (volta as funções da 53).
-- =====================================================================

begin;

create or replace function plan_price_for(bid uuid, p_plan text, p_ref date)
returns json
language sql stable security definer set search_path = public
as $$
  with d as (
    select * from subscription_discounts where business_id = bid and status <> 'anulado' limit 1
  ),
  pl as (select * from plans where id = p_plan),
  own as (   -- desconto do espaço (anual: o ano inteiro precisa caber até o fim)
    select cp.base_price, co.code, co.label, co.duration_months, d.ends_on
      from d
      join coupons co on co.code = d.coupon_code
      join coupon_prices cp on cp.code = d.coupon_code and cp.plan_id = p_plan
      join pl on true
     where d.status in ('ativo', 'encerrado')   -- encerrado = virada registrada; o preço segue a data
       and p_ref < d.ends_on
       and (pl.billing_cycle <> 'YEARLY' or (p_ref + interval '12 months')::date <= d.ends_on)
  ),
  fresh as ( -- quem nunca usou desconto, com o cupom automático no prazo
    select cp.base_price, co.code, co.label, co.duration_months, null::date as ends_on
      from coupons co
      join coupon_prices cp on cp.code = co.code and cp.plan_id = p_plan
     where co.code = auto_coupon_code() and not exists (select 1 from d)
  ),
  pick as (select * from own union all select * from fresh limit 1)
  select json_build_object(
    'full_price',      p.base_price,
    'price',           coalesce((select base_price from pick), p.base_price),
    'discounted',      exists (select 1 from pick),
    'coupon_code',     (select code from pick),
    'coupon_label',    (select label from pick),
    'discount_months', (select duration_months from pick),
    'discount_ends_on',(select ends_on from pick)
  )
  from plans p where p.id = p_plan;
$$;
revoke all on function plan_price_for(uuid, text, date) from public, anon, authenticated;
grant execute on function plan_price_for(uuid, text, date) to service_role;

create or replace function subscription_discount_void(bid uuid, p_actor uuid default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  update subscription_discounts d set status = 'anulado', voided_at = now()
   where d.business_id = bid and d.status = 'ativo'
     and not exists (select 1 from subscription_discount_log l where l.discount_id = d.id and l.event = 'reaproveitado')
  returning d.id into v_id;
  if v_id is null then return false; end if;
  insert into subscription_discount_log (discount_id, business_id, event, actor, note)
  values (v_id, bid, 'anulado', p_actor, '1ª fatura não paga');
  return true;
end;
$$;
revoke all on function subscription_discount_void(uuid, uuid) from public, anon, authenticated;
grant execute on function subscription_discount_void(uuid, uuid) to service_role;

commit;


-- =====================================================================
-- REVERSÃO (volta as funções da 53)
-- =====================================================================
-- begin;
-- create or replace function plan_price_for(bid uuid, p_plan text, p_ref date)
-- returns json
-- language sql stable security definer set search_path = public
-- as $$
--   with d as (
--     select * from subscription_discounts where business_id = bid and status <> 'anulado' limit 1
--   ),
--   own as (
--     select cp.base_price, co.code, co.label, co.duration_months, d.ends_on
--       from d
--       join coupons co on co.code = d.coupon_code
--       join coupon_prices cp on cp.code = d.coupon_code and cp.plan_id = p_plan
--      where d.status = 'ativo' and p_ref < d.ends_on
--   ),
--   fresh as (
--     select cp.base_price, co.code, co.label, co.duration_months, null::date as ends_on
--       from coupons co
--       join coupon_prices cp on cp.code = co.code and cp.plan_id = p_plan
--      where co.code = auto_coupon_code() and not exists (select 1 from d)
--   ),
--   pick as (select * from own union all select * from fresh limit 1)
--   select json_build_object(
--     'full_price',      p.base_price,
--     'price',           coalesce((select base_price from pick), p.base_price),
--     'discounted',      exists (select 1 from pick),
--     'coupon_code',     (select code from pick),
--     'coupon_label',    (select label from pick),
--     'discount_months', (select duration_months from pick),
--     'discount_ends_on',(select ends_on from pick)
--   )
--   from plans p where p.id = p_plan;
-- $$;
-- create or replace function subscription_discount_void(bid uuid, p_actor uuid default null)
-- returns boolean
-- language plpgsql security definer set search_path = public
-- as $$
-- declare v_id uuid;
-- begin
--   update subscription_discounts set status = 'anulado', voided_at = now()
--    where business_id = bid and status = 'ativo'
--   returning id into v_id;
--   if v_id is null then return false; end if;
--   insert into subscription_discount_log (discount_id, business_id, event, actor, note)
--   values (v_id, bid, 'anulado', p_actor, '1ª fatura não paga');
--   return true;
-- end;
-- $$;
-- commit;
