-- =====================================================================
-- GENIX AGENDA — 61: Indicação com crédito proporcional
-- Aditiva. Rodar ANTES do merge (o código novo chama as funções daqui).
-- Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que muda (regra nova, só para prêmios gerados depois desta migration):
--   • crédito = MENOR valor entre a mensalidade paga de fato pelo indicado
--     (1ª cobrança, com desconto de lançamento; anual = valor pago ÷ 12,
--     arredondado para baixo no centavo) e a mensalidade de quem indicou
--     (preço do vencimento da cobrança afetada; anual = renovação ÷ 12);
--   • crédito >= mensalidade de quem indicou → adia 1 mês (como na 56);
--   • crédito menor → reduz o valor da próxima cobrança pendente; se ela
--     ficaria abaixo de R$ 5,00, adia 1 mês em vez de reduzir;
--   • cobrança ainda não gerada → o crédito fica guardado e entra quando o
--     Asaas gerar a cobrança (webhook PAYMENT_CREATED);
--   • 1 crédito por cobrança (índice único); o valor esperado da cobrança
--     passa a ser preço do vencimento − créditos ligados a ela (o servidor
--     usa referral_credit_for_payment em applySubscriptionValues e na rede
--     de segurança do webhook).
-- Prêmios já gerados (kind = 'mes') continuam 1 mês grátis.
--
-- A versão de 4 parâmetros de referral_on_first_payment (56) continua aqui
-- para o código atual funcionar até o deploy. Pode sair numa migration
-- futura, depois do deploy deste código.
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Colunas novas em referral_rewards
-- =====================================================================
alter table referral_rewards add column if not exists kind text not null default 'mes';
alter table referral_rewards drop constraint if exists referral_rewards_kind_check;
alter table referral_rewards add constraint referral_rewards_kind_check check (kind in ('mes', 'credito'));

-- mensalidade paga de fato pelo indicado (anual ÷ 12)
alter table referral_rewards add column if not exists referred_monthly numeric(10,2);
-- como o crédito saiu: reduzindo a cobrança ou adiando 1 mês
alter table referral_rewards add column if not exists applied_as text;
alter table referral_rewards drop constraint if exists referral_rewards_applied_as_check;
alter table referral_rewards add constraint referral_rewards_applied_as_check
  check (applied_as is null or applied_as in ('reducao', 'adiamento'));
-- valor do crédito usado (reducao) ou a mensalidade adiada (adiamento)
alter table referral_rewards add column if not exists credit_amount numeric(10,2);
alter table referral_rewards add column if not exists payment_value_before numeric(10,2);
alter table referral_rewards add column if not exists payment_value_after numeric(10,2);

alter table referral_rewards drop constraint if exists referral_rewards_credito_valor;
alter table referral_rewards add constraint referral_rewards_credito_valor
  check (kind <> 'credito' or (referred_monthly is not null and referred_monthly > 0));
alter table referral_rewards drop constraint if exists referral_rewards_credit_amount_pos;
alter table referral_rewards add constraint referral_rewards_credit_amount_pos
  check (credit_amount is null or credit_amount > 0);

-- 1 crédito de redução por cobrança (o 2º vai para a cobrança seguinte)
create unique index if not exists referral_rewards_one_credit_per_payment
  on referral_rewards (applied_payment_id)
  where kind = 'credito' and applied_as = 'reducao' and status = 'aplicado';


-- =====================================================================
-- PARTE 2 — Mensalidade paga pelo indicado
-- =====================================================================
create or replace function referral_monthly_value(p_plan text, p_value numeric)
returns numeric
language sql stable set search_path = public
as $$
  select case
           when p_value is null or p_value <= 0 then null
           when (select billing_cycle from plans where id = p_plan) = 'YEARLY'
             then floor(p_value * 100 / 12) / 100
           else round(p_value, 2)
         end;
$$;
revoke all on function referral_monthly_value(text, numeric) from public, anon, authenticated;
grant execute on function referral_monthly_value(text, numeric) to service_role;


-- =====================================================================
-- PARTE 3 — 1ª cobrança paga do indicado (versão nova, com o valor)
-- Igual à 56, mas o prêmio nasce como 'credito' com a mensalidade paga.
-- p_value sem padrão: chamada com 4 parâmetros continua indo para a 56.
-- =====================================================================
create or replace function referral_on_first_payment(
  bid uuid, p_payment_id text, p_plan text, p_block_reason text, p_value numeric
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_r   referrals%rowtype;
  v_id  uuid;
  v_st  text := case when p_block_reason is null then 'guardado' else 'bloqueado' end;
  v_m   numeric;
begin
  select * into v_r from referrals where referred_business_id = bid for update;
  if not found or v_r.status = 'bloqueado' then return null; end if;
  -- 1 prêmio por indicado, mesmo se cancelar e assinar de novo
  if exists (select 1 from referral_rewards where referral_id = v_r.id) then return null; end if;
  if not exists (select 1 from plans where id = p_plan and kind <> 'gratis') then return null; end if;

  v_m := referral_monthly_value(p_plan, p_value);
  if v_m is null then raise exception 'VALOR_INDICADO_INVALIDO'; end if;

  update referrals
     set status = case when v_st = 'guardado' then 'premio' else 'pagou' end,
         subscribed_at = coalesce(subscribed_at, now()),
         paid_at = now(), first_payment_id = p_payment_id, first_plan_id = p_plan
   where id = v_r.id;

  insert into referral_rewards (referral_id, referrer_business_id, status, kind, referred_monthly, note)
  values (v_r.id, v_r.referrer_business_id, v_st, 'credito', v_m,
          case when p_block_reason is null then null else 'Autoindicação: ' || p_block_reason end)
  returning id into v_id;

  return json_build_object('reward_id', v_id, 'referrer_business_id', v_r.referrer_business_id,
                           'status', v_st, 'kind', 'credito', 'referred_monthly', v_m);
end;
$$;
revoke all on function referral_on_first_payment(uuid, text, text, text, numeric) from public, anon, authenticated;
grant execute on function referral_on_first_payment(uuid, text, text, text, numeric) to service_role;


-- =====================================================================
-- PARTE 4 — Reservas
-- referral_rewards_claim (56) passa a reservar só os meses antigos ('mes');
-- os créditos saem um por vez por referral_credit_claim.
-- =====================================================================
create or replace function referral_rewards_claim(bid uuid)
returns uuid[]
language sql volatile security definer set search_path = public
as $$
  with c as (
    update referral_rewards set status = 'aplicado', applied_at = now()
     where referrer_business_id = bid and status = 'guardado' and kind = 'mes'
    returning id
  )
  select coalesce(array_agg(id), '{}') from c;
$$;
revoke all on function referral_rewards_claim(uuid) from public, anon, authenticated;
grant execute on function referral_rewards_claim(uuid) to service_role;

-- reserva o crédito guardado mais antigo (atômico: dois avisos ao mesmo tempo pegam linhas diferentes)
create or replace function referral_credit_claim(bid uuid)
returns json
language sql volatile security definer set search_path = public
as $$
  with pick as (
    select id from referral_rewards
     where referrer_business_id = bid and status = 'guardado' and kind = 'credito'
     order by granted_at, id
     limit 1
     for update skip locked
  ), c as (
    update referral_rewards w set status = 'aplicado', applied_at = now()
      from pick where w.id = pick.id
    returning w.id, w.referred_monthly
  )
  select json_build_object('id', id, 'referred_monthly', referred_monthly) from c;
$$;
revoke all on function referral_credit_claim(uuid) from public, anon, authenticated;
grant execute on function referral_credit_claim(uuid) to service_role;

-- devolve para "guardado" o que foi reservado e não chegou a mexer no Asaas
create or replace function referral_rewards_unclaim(p_ids uuid[])
returns void
language sql volatile security definer set search_path = public
as $$
  update referral_rewards
     set status = 'guardado', applied_at = null, applied_as = null, credit_amount = null,
         applied_payment_id = null, payment_value_before = null, payment_value_after = null
   where id = any(p_ids) and status = 'aplicado' and due_after is null and applied_as is null;
$$;
revoke all on function referral_rewards_unclaim(uuid[]) from public, anon, authenticated;
grant execute on function referral_rewards_unclaim(uuid[]) to service_role;

-- grava a redução ANTES de falar com o Asaas (o índice único barra 2 créditos na mesma cobrança).
-- Devolve false se a cobrança já tem crédito (o servidor devolve a reserva e espera a próxima).
create or replace function referral_credit_reserve_payment(
  p_id uuid, p_payment_id text, p_due date, p_credit numeric, p_before numeric, p_after numeric,
  p_plan text, p_cycle text
)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
begin
  update referral_rewards
     set applied_as = 'reducao', applied_payment_id = p_payment_id, credit_amount = p_credit,
         payment_value_before = p_before, payment_value_after = p_after,
         due_before = p_due, due_after = p_due, plan_id = p_plan, cycle = p_cycle,
         note = 'Crédito por indicação'
   where id = p_id and status = 'aplicado' and kind = 'credito' and applied_as is null;
  return found;
exception when unique_violation then
  return false;
end;
$$;
revoke all on function referral_credit_reserve_payment(uuid, text, date, numeric, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function referral_credit_reserve_payment(uuid, text, date, numeric, numeric, numeric, text, text) to service_role;

-- o Asaas recusou a redução: desfaz a gravação acima e volta a "guardado"
create or replace function referral_credit_release(p_id uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  update referral_rewards
     set status = 'guardado', applied_at = null, applied_as = null, applied_payment_id = null,
         credit_amount = null, payment_value_before = null, payment_value_after = null,
         due_before = null, due_after = null, plan_id = null, cycle = null, note = null
   where id = p_id and kind = 'credito' and status = 'aplicado' and applied_as = 'reducao';
$$;
revoke all on function referral_credit_release(uuid) from public, anon, authenticated;
grant execute on function referral_credit_release(uuid) to service_role;

-- soma dos créditos ligados a cada cobrança (valor esperado = preço do vencimento − isto)
create or replace function referral_credit_for_payments(p_payment_ids text[])
returns json
language sql stable security definer set search_path = public
as $$
  select coalesce(json_object_agg(applied_payment_id, total), '{}'::json)
    from (
      select applied_payment_id, sum(credit_amount) as total
        from referral_rewards
       where applied_payment_id = any(p_payment_ids)
         and kind = 'credito' and applied_as = 'reducao' and status = 'aplicado'
       group by applied_payment_id
    ) t;
$$;
revoke all on function referral_credit_for_payments(text[]) from public, anon, authenticated;
grant execute on function referral_credit_for_payments(text[]) to service_role;


-- =====================================================================
-- PARTE 5 — Leitura (card da Assinatura e /genix)
-- O card não mostra quanto o indicado paga: só o crédito já usado.
-- =====================================================================
create or replace function my_referrals()
returns json
language sql stable security definer set search_path = public
as $$
  with me as (
    select b.id, b.referral_code from businesses b
     where b.owner_id = auth.uid() and is_business_owner(b.id)
     order by b.created_at desc limit 1
  ), w as (
    select r.* from referral_rewards r, me where r.referrer_business_id = me.id
  )
  select json_build_object(
    'code', (select referral_code from me),
    'rewards', json_build_object(
      'guardado', (select count(*) from w where status = 'guardado'),
      'aplicado', (select count(*) from w where status = 'aplicado'),
      'meses_aplicados', (select count(*) from w where status = 'aplicado'
                            and (kind = 'mes' or applied_as = 'adiamento')),
      'credito_aplicado', (select coalesce(sum(credit_amount), 0) from w
                             where status = 'aplicado' and applied_as = 'reducao')
    ),
    'items', coalesce((
      select json_agg(json_build_object(
               'name', b.name,
               'created_at', r.created_at,
               'status', r.status,
               'reward', rw.status,
               'due_after', rw.due_after,
               'kind', rw.kind,
               'applied_as', rw.applied_as,
               'credit_amount', case when rw.applied_as = 'reducao' then rw.credit_amount end
             ) order by r.created_at desc)
        from referrals r
        join me on me.id = r.referrer_business_id
        join businesses b on b.id = r.referred_business_id
        left join referral_rewards rw on rw.referral_id = r.id
       where r.status <> 'bloqueado'
    ), '[]'::json)
  )
  where exists (select 1 from me);
$$;
revoke all on function my_referrals() from public, anon;
grant execute on function my_referrals() to authenticated;

create or replace function genix_referrals_overview()
returns json
language sql stable security definer set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'id', r.id,
           'referrer', rb.name, 'referrer_slug', rb.slug,
           'referred', db.name, 'referred_slug', db.slug,
           'status', r.status, 'blocked_reason', r.blocked_reason,
           'created_at', r.created_at, 'paid_at', r.paid_at,
           'first_payment_id', r.first_payment_id, 'first_plan_id', r.first_plan_id,
           'reward_status', w.status, 'reward_note', w.note, 'granted_at', w.granted_at,
           'applied_at', w.applied_at, 'applied_payment_id', w.applied_payment_id,
           'due_before', w.due_before, 'due_after', w.due_after, 'canceled_at', w.canceled_at,
           'reward_kind', w.kind, 'referred_monthly', w.referred_monthly, 'applied_as', w.applied_as,
           'credit_amount', w.credit_amount,
           'payment_value_before', w.payment_value_before, 'payment_value_after', w.payment_value_after
         ) order by r.created_at desc), '[]'::json)
    from referrals r
    join businesses rb on rb.id = r.referrer_business_id
    join businesses db on db.id = r.referred_business_id
    left join referral_rewards w on w.referral_id = r.id
   where is_platform_admin();
$$;
revoke all on function genix_referrals_overview() from public, anon;
grant execute on function genix_referrals_overview() to authenticated;

commit;


-- =====================================================================
-- CONFERIR
-- =====================================================================
-- select kind, status, applied_as, count(*) from referral_rewards group by 1, 2, 3 order by 1, 2, 3;
-- select id, referred_monthly, credit_amount, applied_payment_id, payment_value_before, payment_value_after
--   from referral_rewards where kind = 'credito' order by granted_at desc;


-- =====================================================================
-- REVERSÃO (rodar inteira; antes, volte o código)
-- Créditos já gerados viram 'mes' (1 mês grátis), como era na 56.
-- my_referrals, genix_referrals_overview, referral_rewards_claim e
-- referral_rewards_unclaim voltam para o texto da 56 (rode as Partes 4 e 5
-- da 56 de novo depois deste bloco).
-- =====================================================================
-- begin;
-- drop function if exists referral_credit_for_payments(text[]);
-- drop function if exists referral_credit_release(uuid);
-- drop function if exists referral_credit_reserve_payment(uuid, text, date, numeric, numeric, numeric, text, text);
-- drop function if exists referral_credit_claim(uuid);
-- drop function if exists referral_on_first_payment(uuid, text, text, text, numeric);
-- drop function if exists referral_monthly_value(text, numeric);
-- drop index if exists referral_rewards_one_credit_per_payment;
-- update referral_rewards set kind = 'mes' where kind = 'credito';
-- alter table referral_rewards drop constraint if exists referral_rewards_credit_amount_pos;
-- alter table referral_rewards drop constraint if exists referral_rewards_credito_valor;
-- alter table referral_rewards drop constraint if exists referral_rewards_applied_as_check;
-- alter table referral_rewards drop constraint if exists referral_rewards_kind_check;
-- alter table referral_rewards drop column if exists payment_value_after;
-- alter table referral_rewards drop column if exists payment_value_before;
-- alter table referral_rewards drop column if exists credit_amount;
-- alter table referral_rewards drop column if exists applied_as;
-- alter table referral_rewards drop column if exists referred_monthly;
-- alter table referral_rewards drop column if exists kind;
-- commit;
