-- =====================================================================
-- GENIX AGENDA — 55: Cupom de lançamento — quando o desconto pode ser anulado
-- Aditiva (só troca 1 função). Rodar ANTES do merge. Pode rodar de novo.
--
-- Anular (1ª fatura nunca paga) só vale para um desconto que nunca foi usado
-- numa assinatura paga. Além de "reaproveitado" (54), também protegem:
--   • troca_plano — só acontece com a assinatura ativa (já paga);
--   • virada      — o desconto já chegou ao fim.
-- Reversão comentada no final (volta a função da 54).
-- =====================================================================

begin;

create or replace function subscription_discount_void(bid uuid, p_actor uuid default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  update subscription_discounts d set status = 'anulado', voided_at = now()
   where d.business_id = bid and d.status = 'ativo'
     and not exists (
       select 1 from subscription_discount_log l
        where l.discount_id = d.id and l.event in ('reaproveitado', 'troca_plano', 'virada')
     )
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
-- REVERSÃO (volta a função da 54)
-- =====================================================================
-- begin;
-- create or replace function subscription_discount_void(bid uuid, p_actor uuid default null)
-- returns boolean
-- language plpgsql security definer set search_path = public
-- as $$
-- declare v_id uuid;
-- begin
--   update subscription_discounts d set status = 'anulado', voided_at = now()
--    where d.business_id = bid and d.status = 'ativo'
--      and not exists (select 1 from subscription_discount_log l where l.discount_id = d.id and l.event = 'reaproveitado')
--   returning d.id into v_id;
--   if v_id is null then return false; end if;
--   insert into subscription_discount_log (discount_id, business_id, event, actor, note)
--   values (v_id, bid, 'anulado', p_actor, '1ª fatura não paga');
--   return true;
-- end;
-- $$;
-- commit;
