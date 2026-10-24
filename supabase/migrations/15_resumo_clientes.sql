-- =====================================================================
-- GENIX AGENDA — B1.2: resumo por cliente (respeita as regras de cada papel)
-- =====================================================================
-- "security invoker" (padrão): a função só enxerga os agendamentos que o
-- usuário logado pode ver. Para o profissional, conta só os atendimentos dele.
create or replace function customer_summary(bid uuid)
returns table (customer_id uuid, visits int, last_visit date, next_visit date, total numeric)
language sql stable
as $$
  select
    b.customer_id,
    count(*) filter (where b.status = 'completed')::int,
    max(b.booking_date) filter (where b.status = 'completed'),
    min(b.booking_date) filter (where b.status in ('pending', 'confirmed') and b.booking_date >= current_date),
    coalesce(sum(b.price) filter (where b.status = 'completed'), 0)
  from bookings b
  where b.business_id = bid and b.customer_id is not null
  group by b.customer_id;
$$;

grant execute on function customer_summary(uuid) to authenticated;

-- Conferência: a função existe
select proname from pg_proc where proname = 'customer_summary';
