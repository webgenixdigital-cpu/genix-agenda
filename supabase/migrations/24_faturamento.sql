-- =====================================================================
-- GENIX AGENDA — Faturamento e limites + Relatório para o contador
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta).
-- Não depende da 23 (WhatsApp).
-- Reversão comentada no final.
--
-- Princípio: NÃO calcula imposto nem gera declaração. Só soma o caixa
-- (regime de caixa: data do recebimento) e compara com os limites.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Enquadramento do espaço
-- Tabela separada de businesses porque businesses é lida pela vitrine
-- pública. Só a matriz (e a demonstração, só leitura) enxerga.
-- =====================================================================
create table if not exists business_fiscal (
  business_id    uuid primary key references businesses(id) on delete cascade,
  regime         text check (regime in ('nanoempreendedor', 'mei', 'simples', 'outro')),
  activity_start date,
  partner_salon  boolean not null default false,   -- Lei 13.352/2016 (salão-parceiro)
  cnpj           text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_business_fiscal_updated on business_fiscal;
create trigger trg_business_fiscal_updated before update on business_fiscal
  for each row execute function set_updated_at();

alter table business_fiscal enable row level security;
revoke all on business_fiscal from public, anon;
grant select, insert, update on business_fiscal to authenticated;

drop policy if exists "matriz ve enquadramento" on business_fiscal;
drop policy if exists "matriz cria enquadramento" on business_fiscal;
drop policy if exists "matriz altera enquadramento" on business_fiscal;

create policy "matriz ve enquadramento" on business_fiscal
  for select to authenticated
  using (coalesce(member_role_of(business_id) in ('owner', 'viewer'), false));

create policy "matriz cria enquadramento" on business_fiscal
  for insert to authenticated
  with check (is_business_owner(business_id));

create policy "matriz altera enquadramento" on business_fiscal
  for update to authenticated
  using (is_business_owner(business_id))
  with check (is_business_owner(business_id));


-- =====================================================================
-- PARTE 2 — Limites por enquadramento (editados pela Genix em /genix)
-- basis: annual = ano civil | rbt12 = receita dos 12 meses
-- first_year_monthly: limite por mês de atividade no ano de início
-- sublimit: aviso informativo (Simples: ICMS/ISS fora do Simples)
-- Vale a linha com o maior valid_from <= data de referência.
-- =====================================================================
create table if not exists revenue_limits (
  id                 uuid primary key default gen_random_uuid(),
  regime             text not null check (regime in ('nanoempreendedor', 'mei', 'simples')),
  basis              text not null check (basis in ('annual', 'rbt12')),
  annual_limit       numeric(14,2) not null check (annual_limit > 0),
  first_year_monthly numeric(14,2) check (first_year_monthly is null or first_year_monthly > 0),
  sublimit           numeric(14,2) check (sublimit is null or sublimit > 0),
  valid_from         date not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (regime, valid_from)
);

drop trigger if exists trg_revenue_limits_updated on revenue_limits;
create trigger trg_revenue_limits_updated before update on revenue_limits
  for each row execute function set_updated_at();

alter table revenue_limits enable row level security;
revoke all on revenue_limits from public, anon;
grant select, insert, update, delete on revenue_limits to authenticated;

drop policy if exists "todos leem limites" on revenue_limits;
drop policy if exists "genix cria limites" on revenue_limits;
drop policy if exists "genix altera limites" on revenue_limits;
drop policy if exists "genix exclui limites" on revenue_limits;

create policy "todos leem limites" on revenue_limits
  for select to authenticated using (true);
create policy "genix cria limites" on revenue_limits
  for insert to authenticated with check (is_platform_admin());
create policy "genix altera limites" on revenue_limits
  for update to authenticated using (is_platform_admin()) with check (is_platform_admin());
create policy "genix exclui limites" on revenue_limits
  for delete to authenticated using (is_platform_admin());

insert into revenue_limits (regime, basis, annual_limit, first_year_monthly, sublimit, valid_from) values
  ('nanoempreendedor', 'annual',   40500.00, 3375.00, null,       '2026-01-01'),
  ('mei',              'annual',   81000.00, 6750.00, null,       '2026-01-01'),
  ('simples',          'rbt12',  4800000.00,    null, 3600000.00, '2026-01-01')
on conflict (regime, valid_from) do nothing;


-- =====================================================================
-- PARTE 3 — Profissional parceiro (salão-parceiro)
-- Alterado pela política existente "matriz altera" de professionals.
-- =====================================================================
alter table professionals add column if not exists is_partner boolean not null default false;


-- =====================================================================
-- PARTE 4 — % do repasse congelado na conclusão do atendimento
-- partner_pct: comissão do parceiro no momento da conclusão;
--              0 = não era parceiro; null = concluído antes desta migration
-- =====================================================================
alter table bookings add column if not exists partner_pct numeric(5,2)
  check (partner_pct is null or partner_pct between 0 and 100);

create or replace function snapshot_partner_pct()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select case when p.is_partner and coalesce(f.partner_salon, false) then p.commission_pct else 0 end
      into new.partner_pct
      from professionals p
      left join business_fiscal f on f.business_id = new.business_id
     where p.id = new.professional_id;
    new.partner_pct := coalesce(new.partner_pct, 0);
  elsif new.status <> 'completed' then
    new.partner_pct := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_snapshot_partner_pct on bookings;
create trigger trg_snapshot_partner_pct
before insert or update of status on bookings
for each row execute function snapshot_partner_pct();


-- =====================================================================
-- PARTE 5 — Caixa agregado por mês (base do painel e do relatório)
-- kind 'income' | 'expense': lançamentos do caixa por categoria e forma;
--   partner_amount = repasse ao parceiro das entradas ligadas a atendimento
-- kind 'repasse_pacote': sessões de pacote concluídas por parceiro
--   (preço do pacote ÷ sessões) × % do parceiro, no mês da sessão
-- Atendimento sem partner_pct (anterior a esta migration) usa a comissão
-- atual, se o profissional for parceiro e o espaço usar salão-parceiro.
-- Erros: SEM_PERMISSAO
-- =====================================================================
create or replace function billing_monthly(p_business uuid, p_from date, p_to date)
returns table (month text, kind text, category text, method text, amount numeric, partner_amount numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_partner boolean;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  select coalesce(f.partner_salon, false) into v_partner from business_fiscal f where f.business_id = p_business;
  v_partner := coalesce(v_partner, false);

  return query
  select to_char(c.entry_date, 'YYYY-MM'), c.kind::text, c.category::text, c.method::text,
         sum(c.amount)::numeric,
         sum(case
               when c.kind = 'income' and bk.id is not null then
                 round(c.amount * coalesce(bk.partner_pct,
                                           case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2)
               else 0
             end)::numeric
    from cash_entries c
    left join bookings bk on bk.id = c.booking_id
    left join professionals p on p.id = bk.professional_id
   where c.business_id = p_business
     and c.entry_date between p_from and p_to
   group by 1, 2, 3, 4

  union all

  select to_char(bk.booking_date, 'YYYY-MM'), 'repasse_pacote', 'pacote', null::text,
         0::numeric,
         sum(round(cp.price / cp.sessions_total
                   * coalesce(bk.partner_pct,
                              case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2))::numeric
    from bookings bk
    join customer_packages cp on cp.id = bk.customer_package_id
    left join professionals p on p.id = bk.professional_id
   where bk.business_id = p_business
     and bk.status = 'completed'
     and bk.booking_date between p_from and p_to
   group by 1
  having sum(round(cp.price / cp.sessions_total
                   * coalesce(bk.partner_pct,
                              case when v_partner and p.is_partner then p.commission_pct else 0 end) / 100, 2)) > 0;
end;
$$;


-- =====================================================================
-- PARTE 6 — Permissões das funções
-- =====================================================================
revoke all on function snapshot_partner_pct()                from public, anon, authenticated;
revoke all on function billing_monthly(uuid, date, date)    from public, anon;
grant execute on function billing_monthly(uuid, date, date) to authenticated;


-- =====================================================================
-- PARTE 7 — Conferência
-- Deve listar os 3 limites iniciais.
-- =====================================================================
select regime, basis, annual_limit, first_year_monthly, sublimit, valid_from
  from revenue_limits order by regime, valid_from;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- drop function if exists billing_monthly(uuid, date, date);
-- drop trigger  if exists trg_snapshot_partner_pct on bookings;
-- drop function if exists snapshot_partner_pct();
-- alter table bookings      drop column if exists partner_pct;
-- alter table professionals drop column if exists is_partner;
-- drop table if exists revenue_limits;
-- drop table if exists business_fiscal;
-- =====================================================================
