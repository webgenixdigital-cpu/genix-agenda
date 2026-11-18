-- =====================================================================
-- GENIX AGENDA — 56: Indique e ganhe
-- Aditiva. Rodar ANTES do merge (o código novo lê as tabelas e funções
-- daqui). Pode rodar de novo sem erro. Tudo em begin/commit.
--
-- O que faz:
--   • businesses.referral_code: link único por espaço (/cadastro?ind=CODIGO);
--   • referrals: 1 por espaço indicado, só no CADASTRO (até 2 h depois de
--     criar o espaço, sem assinatura); autoindicação barrada (mesmo dono,
--     e-mail ou WhatsApp; o documento é conferido no pagamento, no servidor);
--   • referral_rewards: 1 prêmio por indicado, criado quando ele PAGA a 1ª
--     cobrança de um plano pago. Prêmio = 1 mês grátis para quem indicou
--     (o servidor adia a próxima cobrança 1 mês). Guardado enquanto quem
--     indicou não tem assinatura paga; acumula; estorno da 1ª cobrança do
--     indicado cancela o prêmio ainda não usado;
--   • escrita só pelo servidor (service role); a matriz lê as próprias
--     indicações por my_referrals(); a Genix vê tudo.
-- Reversão comentada no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Código de indicação por espaço
-- 8 caracteres, sem 0/O/1/I (fácil de ler e ditar)
-- =====================================================================
create or replace function gen_referral_code()
returns text
language plpgsql volatile set search_path = public
as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from businesses where referral_code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function gen_referral_code() from public, anon, authenticated;

alter table businesses add column if not exists referral_code text;

do $$
declare r record;
begin
  for r in select id from businesses where referral_code is null loop
    update businesses set referral_code = gen_referral_code() where id = r.id;
  end loop;
end $$;

create unique index if not exists businesses_referral_code_key on businesses (referral_code);
alter table businesses alter column referral_code set not null;

create or replace function set_referral_code()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.referral_code is null then new.referral_code := gen_referral_code(); end if;
  return new;
end;
$$;
drop trigger if exists trg_businesses_referral_code on businesses;
create trigger trg_businesses_referral_code before insert on businesses
  for each row execute function set_referral_code();

-- o código não muda depois de criado (o link já pode ter sido divulgado)
create or replace function guard_referral_code()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.referral_code is distinct from old.referral_code then
    raise exception 'CODIGO_INDICACAO_FIXO';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_businesses_referral_code_guard on businesses;
create trigger trg_businesses_referral_code_guard before update of referral_code on businesses
  for each row execute function guard_referral_code();


-- =====================================================================
-- PARTE 2 — Indicações e prêmios
-- referrals.status: cadastrou → assinou → pagou → premio | bloqueado
-- referral_rewards.status: guardado → aplicado | cancelado | bloqueado
-- =====================================================================
create table if not exists referrals (
  id                    uuid primary key default gen_random_uuid(),
  referrer_business_id  uuid not null references businesses(id) on delete cascade,
  referred_business_id  uuid not null references businesses(id) on delete cascade,
  code                  text not null,
  status                text not null default 'cadastrou'
                        check (status in ('cadastrou', 'assinou', 'pagou', 'premio', 'bloqueado')),
  blocked_reason        text,
  created_at            timestamptz not null default now(),
  subscribed_at         timestamptz,
  paid_at               timestamptz,
  first_payment_id      text,
  first_plan_id         text references plans(id),
  check (referrer_business_id <> referred_business_id)
);
create unique index if not exists referrals_referred_key on referrals (referred_business_id);
create index if not exists referrals_referrer on referrals (referrer_business_id, created_at desc);
create index if not exists referrals_first_payment on referrals (first_payment_id) where first_payment_id is not null;

create table if not exists referral_rewards (
  id                    uuid primary key default gen_random_uuid(),
  referral_id           uuid not null references referrals(id) on delete cascade,
  referrer_business_id  uuid not null references businesses(id) on delete cascade,
  months                smallint not null default 1 check (months = 1),
  status                text not null default 'guardado'
                        check (status in ('guardado', 'aplicado', 'cancelado', 'bloqueado')),
  granted_at            timestamptz not null default now(),
  -- aplicação (o servidor adia a próxima cobrança de quem indicou)
  applied_at            timestamptz,
  plan_id               text references plans(id),
  cycle                 text check (cycle in ('MONTHLY', 'YEARLY')),
  applied_payment_id    text,          -- cobrança adiada (null = só a assinatura foi adiada)
  due_before            date,          -- vencimento antes
  due_after             date,          -- vencimento depois
  canceled_at           timestamptz,
  note                  text
);
create unique index if not exists referral_rewards_one_per_referral on referral_rewards (referral_id);
create index if not exists referral_rewards_referrer on referral_rewards (referrer_business_id, status);

alter table referrals enable row level security;
alter table referral_rewards enable row level security;
-- sem políticas de escrita: só funções do servidor
drop policy if exists "matriz e genix leem indicacoes" on referrals;
create policy "matriz e genix leem indicacoes" on referrals
  for select to authenticated using (is_business_owner(referrer_business_id) or is_platform_admin());
drop policy if exists "matriz e genix leem premios" on referral_rewards;
create policy "matriz e genix leem premios" on referral_rewards
  for select to authenticated using (is_business_owner(referrer_business_id) or is_platform_admin());


-- =====================================================================
-- PARTE 3 — Vínculo no cadastro (o próprio usuário, logado)
-- Devolve um código de situação; nunca lança erro (o cadastro não pode
-- falhar por causa da indicação).
-- =====================================================================
create or replace function referral_attach(p_code text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_me    businesses%rowtype;
  v_ref   businesses%rowtype;
  v_reason text;
begin
  if v_uid is null then return 'NAO_AUTENTICADO'; end if;
  if char_length(v_code) <> 8 then return 'CODIGO_INVALIDO'; end if;

  select * into v_me from businesses where owner_id = v_uid order by created_at desc limit 1;
  if not found then return 'SEM_ESPACO'; end if;

  -- só no cadastro: espaço recém-criado e sem assinatura
  if v_me.created_at < now() - interval '2 hours' then return 'FORA_DO_CADASTRO'; end if;
  if exists (select 1 from subscriptions s
              where s.business_id = v_me.id and (s.asaas_subscription_id is not null or s.plan_id is not null)) then
    return 'FORA_DO_CADASTRO';
  end if;
  if exists (select 1 from referrals where referred_business_id = v_me.id) then return 'JA_INDICADO'; end if;

  select * into v_ref from businesses where referral_code = v_code;
  if not found then return 'CODIGO_INVALIDO'; end if;

  -- autoindicação: mesmo espaço, mesmo dono, mesmo e-mail do dono ou mesmo WhatsApp do espaço
  if v_ref.id = v_me.id or v_ref.owner_id = v_uid then
    v_reason := 'mesmo dono';
  elsif nullif(v_ref.whatsapp, '') is not null and v_ref.whatsapp = v_me.whatsapp then
    v_reason := 'mesmo WhatsApp';
  elsif exists (select 1 from auth.users a, auth.users b
                 where a.id = v_ref.owner_id and b.id = v_uid
                   and lower(coalesce(a.email, '')) <> '' and lower(a.email) = lower(b.email)) then
    v_reason := 'mesmo e-mail';
  end if;
  if v_reason is not null and v_ref.id = v_me.id then return 'AUTOINDICACAO'; end if;

  insert into referrals (referrer_business_id, referred_business_id, code, status, blocked_reason)
  values (v_ref.id, v_me.id, v_code, case when v_reason is null then 'cadastrou' else 'bloqueado' end, v_reason)
  on conflict (referred_business_id) do nothing;

  return case when v_reason is null then 'VINCULADO' else 'AUTOINDICACAO' end;
end;
$$;
revoke all on function referral_attach(text) from public, anon;
grant execute on function referral_attach(text) to authenticated;


-- =====================================================================
-- PARTE 4 — Andamento (só o servidor: webhook e actions)
-- =====================================================================
-- o indicado criou a assinatura
create or replace function referral_mark_subscribed(bid uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  update referrals set status = 'assinou', subscribed_at = coalesce(subscribed_at, now())
   where referred_business_id = bid and status = 'cadastrou';
$$;
revoke all on function referral_mark_subscribed(uuid) from public, anon, authenticated;
grant execute on function referral_mark_subscribed(uuid) to service_role;

-- o indicado pagou uma cobrança de plano pago: na 1ª vez, cria o prêmio de quem indicou.
-- p_block_reason: o servidor achou o mesmo CPF/CNPJ no Asaas → prêmio bloqueado.
-- Devolve {reward_id, referrer_business_id, status} ou null (sem indicação / já premiado).
create or replace function referral_on_first_payment(bid uuid, p_payment_id text, p_plan text, p_block_reason text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_r   referrals%rowtype;
  v_id  uuid;
  v_st  text := case when p_block_reason is null then 'guardado' else 'bloqueado' end;
begin
  select * into v_r from referrals where referred_business_id = bid for update;
  if not found or v_r.status = 'bloqueado' then return null; end if;
  -- 1 prêmio por indicado, mesmo se cancelar e assinar de novo
  if exists (select 1 from referral_rewards where referral_id = v_r.id) then return null; end if;
  if not exists (select 1 from plans where id = p_plan and kind <> 'gratis') then return null; end if;

  update referrals
     set status = case when v_st = 'guardado' then 'premio' else 'pagou' end,
         subscribed_at = coalesce(subscribed_at, now()),
         paid_at = now(), first_payment_id = p_payment_id, first_plan_id = p_plan
   where id = v_r.id;

  insert into referral_rewards (referral_id, referrer_business_id, status, note)
  values (v_r.id, v_r.referrer_business_id, v_st,
          case when p_block_reason is null then null else 'Autoindicação: ' || p_block_reason end)
  returning id into v_id;

  return json_build_object('reward_id', v_id, 'referrer_business_id', v_r.referrer_business_id, 'status', v_st);
end;
$$;
revoke all on function referral_on_first_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function referral_on_first_payment(uuid, text, text, text) to service_role;

-- 1ª cobrança do indicado estornada/removida: cancela o prêmio ainda não usado
create or replace function referral_cancel_by_payment(p_payment_id text)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare v_n int;
begin
  update referral_rewards w
     set status = 'cancelado', canceled_at = now(), note = 'Estorno ou remoção da 1ª cobrança do indicado'
    from referrals r
   where w.referral_id = r.id and r.first_payment_id = p_payment_id and w.status = 'guardado';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update referrals set status = 'pagou' where first_payment_id = p_payment_id and status = 'premio';
  end if;
  return v_n;
end;
$$;
revoke all on function referral_cancel_by_payment(text) from public, anon, authenticated;
grant execute on function referral_cancel_by_payment(text) to service_role;

-- reserva os prêmios guardados de quem indicou (antes de falar com o Asaas)
create or replace function referral_rewards_claim(bid uuid)
returns uuid[]
language sql volatile security definer set search_path = public
as $$
  with c as (
    update referral_rewards set status = 'aplicado', applied_at = now()
     where referrer_business_id = bid and status = 'guardado'
    returning id
  )
  select coalesce(array_agg(id), '{}') from c;
$$;
revoke all on function referral_rewards_claim(uuid) from public, anon, authenticated;
grant execute on function referral_rewards_claim(uuid) to service_role;

-- o Asaas falhou: devolve os prêmios para "guardado"
create or replace function referral_rewards_unclaim(p_ids uuid[])
returns void
language sql volatile security definer set search_path = public
as $$
  update referral_rewards set status = 'guardado', applied_at = null
   where id = any(p_ids) and status = 'aplicado' and due_after is null;
$$;
revoke all on function referral_rewards_unclaim(uuid[]) from public, anon, authenticated;
grant execute on function referral_rewards_unclaim(uuid[]) to service_role;


-- =====================================================================
-- PARTE 5 — Leitura
-- my_referrals: card "Indique e ganhe" (matriz). Só o nome do espaço
-- indicado, a data e a situação; nada de dados pessoais.
-- =====================================================================
create or replace function my_referrals()
returns json
language sql stable security definer set search_path = public
as $$
  with me as (
    select b.id, b.referral_code from businesses b
     where b.owner_id = auth.uid() and is_business_owner(b.id)
     order by b.created_at desc limit 1
  )
  select json_build_object(
    'code', (select referral_code from me),
    'rewards', json_build_object(
      'guardado', (select count(*) from referral_rewards w, me where w.referrer_business_id = me.id and w.status = 'guardado'),
      'aplicado', (select count(*) from referral_rewards w, me where w.referrer_business_id = me.id and w.status = 'aplicado')
    ),
    'items', coalesce((
      select json_agg(json_build_object(
               'name', b.name,
               'created_at', r.created_at,
               'status', r.status,
               'reward', w.status,
               'due_after', w.due_after
             ) order by r.created_at desc)
        from referrals r
        join me on me.id = r.referrer_business_id
        join businesses b on b.id = r.referred_business_id
        left join referral_rewards w on w.referral_id = r.id
       where r.status <> 'bloqueado'
    ), '[]'::json)
  )
  where exists (select 1 from me);
$$;
revoke all on function my_referrals() from public, anon;
grant execute on function my_referrals() to authenticated;

-- /genix → Indicações
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
           'due_before', w.due_before, 'due_after', w.due_after, 'canceled_at', w.canceled_at
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
-- select count(*) filter (where referral_code is null) as sem_codigo from businesses;
-- select * from referrals order by created_at desc;
-- select * from referral_rewards order by granted_at desc;


-- =====================================================================
-- REVERSÃO (rodar inteira; antes, volte o código)
-- =====================================================================
-- begin;
-- drop function if exists genix_referrals_overview();
-- drop function if exists my_referrals();
-- drop function if exists referral_rewards_unclaim(uuid[]);
-- drop function if exists referral_rewards_claim(uuid);
-- drop function if exists referral_cancel_by_payment(text);
-- drop function if exists referral_on_first_payment(uuid, text, text, text);
-- drop function if exists referral_mark_subscribed(uuid);
-- drop function if exists referral_attach(text);
-- drop table if exists referral_rewards;
-- drop table if exists referrals;
-- drop trigger if exists trg_businesses_referral_code_guard on businesses;
-- drop trigger if exists trg_businesses_referral_code on businesses;
-- drop function if exists guard_referral_code();
-- drop function if exists set_referral_code();
-- drop index if exists businesses_referral_code_key;
-- alter table businesses drop column if exists referral_code;
-- drop function if exists gen_referral_code();
-- commit;
