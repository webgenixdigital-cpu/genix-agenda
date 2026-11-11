-- =====================================================================
-- 43 — Caixa por período + aniversário só com dia e mês
--
--   1) cash_period_summary(...)  resumo do período do Caixa (entradas, saídas
--                                e totais por forma), com filtro de forma e tipo
--      cash_monthly_totals(...)  entradas e saídas por mês (gráfico)
--      As duas são SECURITY INVOKER: a RLS de cash_entries ("matriz ve caixa")
--      continua decidindo quem lê. Sem elas a tela soma pelo navegador do
--      servidor (mais lento), então a ordem é: migration antes do merge.
--      Índice: idx_cash_business_date (business_id, entry_date) já existe (01).
--
--   2) customers.birth_date passa a guardar só dia e mês, sempre no ano 2000
--      (bissexto: aceita 29/02). Normaliza o que já existe e um gatilho
--      garante o ano 2000 em toda gravação nova (inclusive do código antigo).
--      whatsapp_is_birthday (42) compara só mês e dia: segue igual.
--
-- Aditiva. Rodar inteira no SQL Editor (está em transação).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Caixa
-- ---------------------------------------------------------------------
create or replace function cash_period_summary(
  p_business uuid,
  p_from     date,
  p_to       date,
  p_methods  text[] default null,   -- null = todas as formas
  p_kind     text   default null    -- null = entradas e saídas
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with e as (
    select c.kind::text as kind, c.method::text as method, c.amount
      from cash_entries c
     where c.business_id = p_business
       and c.entry_date between p_from and p_to
       and (p_methods is null or c.method::text = any (p_methods))
       and (p_kind is null or c.kind::text = p_kind)
  ), m as (
    select method,
           coalesce(sum(amount) filter (where kind = 'income'), 0)  as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense
      from e group by method
  )
  select jsonb_build_object(
    'count',   (select count(*) from e),
    'income',  (select coalesce(sum(amount) filter (where kind = 'income'), 0) from e),
    'expense', (select coalesce(sum(amount) filter (where kind = 'expense'), 0) from e),
    'by_method', coalesce((select jsonb_object_agg(method, jsonb_build_object('income', income, 'expense', expense)) from m),
                          '{}'::jsonb)
  );
$$;

create or replace function cash_monthly_totals(p_business uuid, p_until date, p_months int default 6)
returns table (month text, income numeric, expense numeric)
language sql stable security invoker set search_path = public
as $$
  with months as (
    select to_char(d, 'YYYY-MM') as month
      from generate_series(
             date_trunc('month', p_until) - make_interval(months => least(greatest(p_months, 1), 24) - 1),
             date_trunc('month', p_until),
             interval '1 month') d
  )
  select mo.month,
         coalesce(sum(c.amount) filter (where c.kind = 'income'), 0),
         coalesce(sum(c.amount) filter (where c.kind = 'expense'), 0)
    from months mo
    left join cash_entries c
      on c.business_id = p_business
     and to_char(c.entry_date, 'YYYY-MM') = mo.month
     and c.entry_date >= (date_trunc('month', p_until) - make_interval(months => least(greatest(p_months, 1), 24) - 1))::date
     and c.entry_date <= (date_trunc('month', p_until) + interval '1 month - 1 day')::date
   group by mo.month
   order by mo.month;
$$;

revoke all on function cash_period_summary(uuid, date, date, text[], text) from public, anon;
revoke all on function cash_monthly_totals(uuid, date, int) from public, anon;
grant execute on function cash_period_summary(uuid, date, date, text[], text) to authenticated;
grant execute on function cash_monthly_totals(uuid, date, int) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Aniversário: dia e mês, ano fixo 2000
-- ---------------------------------------------------------------------
-- Conferência ANTES (anote o resultado: o ano original não volta na reversão)
--   select count(*) filter (where birth_date is not null) as com_data,
--          count(*) filter (where extract(year from birth_date) <> 2000) as a_normalizar
--     from customers;

create or replace function normalize_customer_birth_date()
returns trigger
language plpgsql
as $$
begin
  if new.birth_date is not null and extract(year from new.birth_date) <> 2000 then
    new.birth_date := make_date(2000, extract(month from new.birth_date)::int, extract(day from new.birth_date)::int);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_birth_date_2000 on customers;
create trigger trg_customer_birth_date_2000
  before insert or update of birth_date on customers
  for each row execute function normalize_customer_birth_date();

-- 29/02 de qualquer ano bissexto vira 2000-02-29 (2000 é bissexto)
update customers
   set birth_date = make_date(2000, extract(month from birth_date)::int, extract(day from birth_date)::int)
 where birth_date is not null
   and extract(year from birth_date) <> 2000;

commit;

-- =====================================================================
-- CONFERÊNCIA (rodar depois)
-- =====================================================================
-- 1) funções do caixa (deve voltar 2 linhas, prosecdef = false = invoker)
--   select proname, prosecdef from pg_proc
--    where proname in ('cash_period_summary', 'cash_monthly_totals');
--
-- 2) nenhuma data fora do ano 2000 (deve voltar 0)
--   select count(*) from customers where birth_date is not null and extract(year from birth_date) <> 2000;
--
-- 3) gatilho ativo (deve voltar 1 linha)
--   select tgname from pg_trigger where tgname = 'trg_customer_birth_date_2000';
--
-- 4) resumo de um espaço seu no mês atual (troque o id; leia como dono no app
--    ou aqui no SQL Editor, que ignora a RLS)
--   select cash_period_summary('<business_id>', date_trunc('month', current_date)::date, current_date);
--   select * from cash_monthly_totals('<business_id>', current_date, 6);
--
-- 5) aniversário: quem faz aniversário hoje continua aparecendo
--   select id, name, birth_date from customers
--    where whatsapp_is_birthday(birth_date, (now() at time zone 'America/Sao_Paulo')::date);

-- =====================================================================
-- REVERSÃO (comentada)
-- ATENÇÃO: o ano original das datas de nascimento NÃO volta. A normalização
-- sobrescreveu o ano por 2000 e não guardou cópia (decisão do produto: a
-- tela não mostra nem pede o ano). Dia e mês ficam corretos.
-- =====================================================================
-- begin;
-- drop trigger if exists trg_customer_birth_date_2000 on customers;
-- drop function if exists normalize_customer_birth_date();
-- drop function if exists cash_period_summary(uuid, date, date, text[], text);
-- drop function if exists cash_monthly_totals(uuid, date, int);
-- commit;
