-- =====================================================================
-- GENIX AGENDA — 69: custo do serviço, margem no caixa e calculadora de preço
--
-- O custo NÃO fica em colunas de services: services é lida sem login pela
-- vitrine (política "public le servicos ativos") e pela recepção/profissional.
-- Por isso o custo mora em tabelas que só a matriz (e a demonstração, só
-- leitura) enxergam.
--
--   PARTE 1  service_costs (custo direto por serviço/combo) + save_service_cost
--            (a partir do Básico: plan_allows(bid, 'basico'))
--   PARTE 2  service_direct_cost (serviço = material + outros; combo = valor
--            próprio ou soma dos itens)
--   PARTE 3  booking_item_costs: foto do custo na conclusão (gatilho em bookings);
--            reabrir apaga; concluir de novo grava outra vez, sem duplicar
--   PARTE 4  pricing_settings (calculadora, 1 por espaço) + save_pricing_settings
--            (a partir do Profissional)
--   PARTE 5  finance_margin_summary (Caixa: receita pelo valor COBRADO do
--            atendimento — 68 —, custo das fotos, margem bruta e lucro estimado)
--   PARTE 6  pricing_suggestions (calculadora: média das saídas, horas, comissão,
--            custo de cada serviço)
--
-- Nada é calculado para o passado: atendimento concluído antes da 69 aparece
-- como "sem custo cadastrado". Rode inteira de uma vez, ANTES do merge (só
-- acrescenta; o código atual não lê nada disto). Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Custo do serviço
-- =====================================================================
create table if not exists service_costs (
  service_id    uuid primary key references services(id) on delete cascade,
  business_id   uuid not null references businesses(id) on delete cascade,
  cost_material numeric(10,2) check (cost_material is null or cost_material >= 0),
  cost_other    numeric(10,2) check (cost_other is null or cost_other >= 0),
  cost_override numeric(10,2) check (cost_override is null or cost_override >= 0),  -- só combo
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_service_costs_business on service_costs (business_id);

alter table service_costs enable row level security;
drop policy if exists "matriz ve custo" on service_costs;
create policy "matriz ve custo" on service_costs
  for select to authenticated
  using (coalesce(member_role_of(business_id) in ('owner', 'viewer'), false));
-- sem política de escrita: só save_service_cost
revoke all on service_costs from anon;
grant select on service_costs to authenticated;

-- Grava (ou apaga, com tudo vazio) o custo de um serviço/combo.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | PLANO_BASICO | VALOR_INVALIDO | SO_COMBO
create or replace function save_service_cost(p_service uuid, p_material numeric, p_other numeric, p_override numeric default null)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  s services;
begin
  select * into s from services where id = p_service;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if coalesce(member_role_of(s.business_id) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(s.business_id, 'basico') then raise exception 'PLANO_BASICO'; end if;
  if (p_material is not null and (p_material < 0 or p_material > 99999))
     or (p_other is not null and (p_other < 0 or p_other > 99999))
     or (p_override is not null and (p_override < 0 or p_override > 99999)) then
    raise exception 'VALOR_INVALIDO';
  end if;
  if p_override is not null and s.kind is distinct from 'combo' then raise exception 'SO_COMBO'; end if;

  if p_material is null and p_other is null and p_override is null then
    delete from service_costs where service_id = s.id;
    return;
  end if;

  insert into service_costs (service_id, business_id, cost_material, cost_other, cost_override, updated_by, updated_at)
  values (s.id, s.business_id, round(p_material, 2), round(p_other, 2), round(p_override, 2), auth.uid(), now())
  on conflict (service_id) do update
     set cost_material = excluded.cost_material,
         cost_other    = excluded.cost_other,
         cost_override = excluded.cost_override,
         updated_by    = excluded.updated_by,
         updated_at    = now();
end;
$$;
revoke all on function save_service_cost(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function save_service_cost(uuid, numeric, numeric, numeric) to authenticated;


-- =====================================================================
-- PARTE 2 — Custo direto vigente (null = não informado)
-- Serviço: material + outros (um dos dois basta). Combo: valor próprio
-- (cost_override) ou a soma dos serviços dele (null se algum não tiver custo).
-- =====================================================================
create or replace function service_direct_cost(p_service uuid)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_kind text;
  c      service_costs;
  v_sum  numeric := 0;
  v_one  numeric;
  r      record;
begin
  if p_service is null then return null; end if;
  select kind into v_kind from services where id = p_service;
  if not found then return null; end if;
  select * into c from service_costs where service_id = p_service;

  if v_kind = 'combo' then
    if c.cost_override is not null then return c.cost_override; end if;
    for r in select service_id from combo_items where combo_id = p_service loop
      v_one := service_direct_cost(r.service_id);
      if v_one is null then return null; end if;
      v_sum := v_sum + v_one;
    end loop;
    return v_sum;
  end if;

  if c.cost_material is null and c.cost_other is null then return null; end if;
  return coalesce(c.cost_material, 0) + coalesce(c.cost_other, 0);
end;
$$;
revoke all on function service_direct_cost(uuid) from public, anon, authenticated;


-- =====================================================================
-- PARTE 3 — Foto do custo na conclusão
-- Uma linha por item do atendimento (booking_item_id). Atendimento sem itens
-- (não deveria existir: backfill da 31 + create_booking_first_item) ganha UMA
-- linha pelo bookings.service_id, com booking_item_id null.
-- Combo com valor próprio: o valor é dividido entre os itens do mesmo
-- combo_group pela proporção do preço (como o preço do combo).
-- =====================================================================
create table if not exists booking_item_costs (
  id              uuid primary key default gen_random_uuid(),
  booking_item_id uuid references booking_items(id) on delete cascade,
  booking_id      uuid not null references bookings(id) on delete cascade,
  business_id     uuid not null references businesses(id) on delete cascade,
  cost            numeric(10,2),   -- null = sem custo cadastrado na hora da conclusão
  captured_at     timestamptz not null default now()
);
create unique index if not exists booking_item_costs_item_unique
  on booking_item_costs (booking_item_id) where booking_item_id is not null;
create unique index if not exists booking_item_costs_booking_unique
  on booking_item_costs (booking_id) where booking_item_id is null;
create index if not exists idx_booking_item_costs_booking on booking_item_costs (booking_id);

alter table booking_item_costs enable row level security;
drop policy if exists "matriz ve foto do custo" on booking_item_costs;
create policy "matriz ve foto do custo" on booking_item_costs
  for select to authenticated
  using (coalesce(member_role_of(business_id) in ('owner', 'viewer'), false));
revoke all on booking_item_costs from anon;
grant select on booking_item_costs to authenticated;

-- (re)grava a foto de um atendimento; sempre apaga antes (nunca duplica)
create or replace function booking_cost_snapshot(p_booking uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk bookings;
begin
  select * into bk from bookings where id = p_booking;
  if not found then return; end if;
  delete from booking_item_costs where booking_id = bk.id;

  if exists (select 1 from booking_items where booking_id = bk.id) then
    insert into booking_item_costs (booking_item_id, booking_id, business_id, cost)
    select i.id, i.booking_id, i.business_id,
           case
             when sc.cost_override is not null and i.combo_group is not null then
               case when i.gsum > 0 then round(sc.cost_override * i.price / i.gsum, 2)
                    else round(sc.cost_override / i.gcount, 2) end
             else service_direct_cost(i.service_id)
           end
      from (select x.*,
                   sum(x.price) over (partition by x.combo_group) as gsum,
                   count(*)     over (partition by x.combo_group) as gcount
              from booking_items x
             where x.booking_id = bk.id) i
      left join service_costs sc on sc.service_id = i.combo_id;
  else
    insert into booking_item_costs (booking_item_id, booking_id, business_id, cost)
    values (null, bk.id, bk.business_id, service_direct_cost(bk.service_id));
  end if;
end;
$$;
revoke all on function booking_cost_snapshot(uuid) from public, anon, authenticated;

create or replace function booking_cost_on_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform booking_cost_snapshot(new.id);
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    delete from booking_item_costs where booking_id = new.id;   -- reabrir
  end if;
  return null;
end;
$$;

drop trigger if exists trg_booking_cost_on_status on bookings;
create trigger trg_booking_cost_on_status
after insert or update of status on bookings
for each row execute function booking_cost_on_status();


-- =====================================================================
-- PARTE 4 — Configurações da calculadora (1 por espaço)
-- =====================================================================
create table if not exists pricing_settings (
  business_id       uuid primary key references businesses(id) on delete cascade,
  regime            text check (regime is null or regime in ('mei', 'simples', 'autonomo', 'nao_sei')),
  tax_pct           numeric(5,2) not null default 0 check (tax_pct between 0 and 100),
  fixed_costs       jsonb not null default '[]'::jsonb,   -- [{key, label, amount}]
  hours_month       numeric(6,1) check (hours_month is null or hours_month between 1 and 744),
  fee_credito_pct   numeric(5,2) not null default 0 check (fee_credito_pct between 0 and 100),
  fee_debito_pct    numeric(5,2) not null default 0 check (fee_debito_pct between 0 and 100),
  fee_pix_pct       numeric(5,2) not null default 0 check (fee_pix_pct between 0 and 100),
  fee_dinheiro_pct  numeric(5,2) not null default 0 check (fee_dinheiro_pct between 0 and 100),
  commission_pct    numeric(5,2) not null default 0 check (commission_pct between 0 and 100),  -- só calculadora
  target_margin_pct numeric(5,2) not null default 20 check (target_margin_pct between 0 and 100),
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now()
);

alter table pricing_settings enable row level security;
drop policy if exists "matriz ve calculadora" on pricing_settings;
create policy "matriz ve calculadora" on pricing_settings
  for select to authenticated
  using (coalesce(member_role_of(business_id) in ('owner', 'viewer'), false));
revoke all on pricing_settings from anon;
grant select on pricing_settings to authenticated;

-- Erros: SEM_PERMISSAO | PLANO_PROFISSIONAL | DADOS_INVALIDOS
create or replace function save_pricing_settings(p_business uuid, p jsonb)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  e   jsonb;
  v_fixed jsonb := '[]'::jsonb;
  v_amt numeric;
  pct numeric;
  k   text;
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if not plan_allows(p_business, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'DADOS_INVALIDOS'; end if;

  -- custos fixos: até 20 linhas, rótulo até 40 letras, valor 0..999999
  if p ? 'fixed_costs' then
    if jsonb_typeof(p->'fixed_costs') <> 'array' or jsonb_array_length(p->'fixed_costs') > 20 then
      raise exception 'DADOS_INVALIDOS';
    end if;
    for e in select x from jsonb_array_elements(p->'fixed_costs') x loop
      begin
        v_amt := coalesce((e->>'amount')::numeric, 0);
      exception when others then raise exception 'DADOS_INVALIDOS';
      end;
      if v_amt < 0 or v_amt > 999999 or char_length(coalesce(e->>'label', '')) not between 1 and 40 then
        raise exception 'DADOS_INVALIDOS';
      end if;
      v_fixed := v_fixed || jsonb_build_object('key', left(coalesce(e->>'key', 'outro'), 30),
                                               'label', e->>'label', 'amount', round(v_amt, 2));
    end loop;
  end if;

  foreach k in array array['tax_pct', 'fee_credito_pct', 'fee_debito_pct', 'fee_pix_pct', 'fee_dinheiro_pct',
                           'commission_pct', 'target_margin_pct'] loop
    if p ? k then
      begin
        pct := (p->>k)::numeric;
      exception when others then raise exception 'DADOS_INVALIDOS';
      end;
      if pct is null or pct < 0 or pct > 100 then raise exception 'DADOS_INVALIDOS'; end if;
    end if;
  end loop;

  insert into pricing_settings (business_id, regime, tax_pct, fixed_costs, hours_month,
                                fee_credito_pct, fee_debito_pct, fee_pix_pct, fee_dinheiro_pct,
                                commission_pct, target_margin_pct, updated_by, updated_at)
  values (p_business,
          nullif(p->>'regime', ''),
          coalesce((p->>'tax_pct')::numeric, 0),
          v_fixed,
          (p->>'hours_month')::numeric,
          coalesce((p->>'fee_credito_pct')::numeric, 0),
          coalesce((p->>'fee_debito_pct')::numeric, 0),
          coalesce((p->>'fee_pix_pct')::numeric, 0),
          coalesce((p->>'fee_dinheiro_pct')::numeric, 0),
          coalesce((p->>'commission_pct')::numeric, 0),
          coalesce((p->>'target_margin_pct')::numeric, 20),
          auth.uid(), now())
  on conflict (business_id) do update
     set regime = excluded.regime, tax_pct = excluded.tax_pct, fixed_costs = excluded.fixed_costs,
         hours_month = excluded.hours_month, fee_credito_pct = excluded.fee_credito_pct,
         fee_debito_pct = excluded.fee_debito_pct, fee_pix_pct = excluded.fee_pix_pct,
         fee_dinheiro_pct = excluded.fee_dinheiro_pct, commission_pct = excluded.commission_pct,
         target_margin_pct = excluded.target_margin_pct, updated_by = excluded.updated_by, updated_at = now();
exception
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'DADOS_INVALIDOS';
end;
$$;
revoke all on function save_pricing_settings(uuid, jsonb) from public, anon;
grant execute on function save_pricing_settings(uuid, jsonb) to authenticated;


-- =====================================================================
-- PARTE 5 — Margem do período (Caixa)
-- Atendimentos CONCLUÍDOS com data no período. Receita = valor cobrado do
-- atendimento (booking_charge, 68: total − itens pagos pelo pacote), não o
-- que entrou no caixa. Atendimento sem foto completa de custo fica FORA da
-- margem e conta em sem_custo. Sessão de pacote: cobrado 0, custo conta.
-- Lucro estimado (só com a calculadora salva e plano Profissional+):
--   margem − imposto % × receita − taxa da forma × cada lançamento desses
--   atendimentos − comissões (Equipe: commission_pct do profissional sobre
--   bookings.price — a mesma base de "Meus ganhos"; parceiro usa o partner_pct
--   congelado na conclusão; partner_pct 0 = não era parceiro) − custos fixos × dias do período ÷ 30.
-- Quem: matriz e demonstração. A partir do Básico. (volatile só por causa da tabela
-- temporária de trabalho; não grava nada)
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
    'estimate', v_profit);
end;
$$;
revoke all on function finance_margin_summary(uuid, date, date) from public, anon;
grant execute on function finance_margin_summary(uuid, date, date) to authenticated;


-- =====================================================================
-- PARTE 6 — Sugestões da calculadora (só leitura)
--   expenses: média mensal das SAÍDAS dos 3 meses fechados anteriores, por categoria
--   hours_month: horário de funcionamento × 4,33 semanas, menos bloqueios
--                recorrentes da equipe toda (ex.: almoço) vigentes hoje
--   commission_avg: média do commission_pct dos profissionais ativos (só Equipe)
--   services: serviços e combos ativos com duração, preço e custo direto
-- Quem: matriz e demonstração.
-- =====================================================================
create or replace function pricing_suggestions(p_business uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today  date;
  v_from   date;
  v_to     date;
  v_exp    json;
  v_hours  numeric;
  v_block  numeric;
  v_comm   numeric;
  v_srv    json;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  select (now() at time zone coalesce(timezone, 'America/Sao_Paulo'))::date into v_today from businesses where id = p_business;
  v_to   := (date_trunc('month', v_today) - interval '1 day')::date;
  v_from := (date_trunc('month', v_today) - interval '3 months')::date;

  select coalesce(json_object_agg(category, avg_month), '{}'::json) into v_exp
    from (select category::text as category, round(sum(amount) / 3, 2) as avg_month
            from cash_entries
           where business_id = p_business and kind = 'expense' and entry_date between v_from and v_to
           group by category) t;

  select coalesce(sum(extract(epoch from (close_time - open_time)) / 3600), 0) into v_hours
    from business_hours where business_id = p_business and not closed;

  select coalesce(sum(extract(epoch from (sb.time_end - sb.time_start)) / 3600), 0) into v_block
    from schedule_blocks sb
    cross join lateral unnest(sb.weekdays) wd
    join business_hours h on h.business_id = sb.business_id and h.weekday = wd and not h.closed
   where sb.business_id = p_business and sb.recurring and sb.professional_id is null
     and sb.time_start is not null and v_today between sb.date_start and sb.date_end;

  if plan_allows(p_business, 'equipe') then
    select round(avg(commission_pct), 2) into v_comm from professionals where business_id = p_business and active;
  end if;

  select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'price', s.price,
                                             'duration_min', s.duration_min, 'cost', service_direct_cost(s.id))
                           order by s.kind nulls first, s.sort_order, s.name), '[]'::json)
    into v_srv
    from services s where s.business_id = p_business and s.active;

  return json_build_object(
    'expenses', v_exp, 'expense_months', json_build_array(v_from, v_to),
    'hours_month', case when v_hours > 0 then round(greatest(v_hours - v_block, 0) * 4.33, 1) end,
    'commission_avg', v_comm,
    'services', v_srv);
end;
$$;
revoke all on function pricing_suggestions(uuid) from public, anon;
grant execute on function pricing_suggestions(uuid) to authenticated;

commit;


-- =====================================================================
-- CONFERÊNCIA (só leitura; rodar depois)
-- =====================================================================
-- 1) tabelas e funções novas (deve listar 3 tabelas e 7 funções)
--   select tablename from pg_tables where tablename in ('service_costs', 'booking_item_costs', 'pricing_settings');
--   select proname from pg_proc where proname in ('save_service_cost', 'service_direct_cost', 'booking_cost_snapshot',
--     'booking_cost_on_status', 'save_pricing_settings', 'finance_margin_summary', 'pricing_suggestions') order by 1;
-- 2) ninguém sem login lê custo (deve voltar false, false, false)
--   select has_table_privilege('anon', 'service_costs', 'select'), has_table_privilege('anon', 'booking_item_costs', 'select'),
--          has_table_privilege('anon', 'pricing_settings', 'select');


-- =====================================================================
-- REVERSÃO (só se precisar desfazer; apaga os custos cadastrados)
-- =====================================================================
-- begin;
-- drop function if exists pricing_suggestions(uuid);
-- drop function if exists finance_margin_summary(uuid, date, date);
-- drop function if exists save_pricing_settings(uuid, jsonb);
-- drop table if exists pricing_settings;
-- drop trigger if exists trg_booking_cost_on_status on bookings;
-- drop function if exists booking_cost_on_status();
-- drop function if exists booking_cost_snapshot(uuid);
-- drop table if exists booking_item_costs;
-- drop function if exists service_direct_cost(uuid);
-- drop function if exists save_service_cost(uuid, numeric, numeric, numeric);
-- drop table if exists service_costs;
-- commit;
