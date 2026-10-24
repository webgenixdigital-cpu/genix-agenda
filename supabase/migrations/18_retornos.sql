-- =====================================================================
-- GENIX AGENDA — N3.2 Retornos ("hora de voltar")
-- Prazo de retorno por serviço + fila de clientes que já deveriam ter voltado.
-- Aditiva: só cria colunas, índice, função e trigger novos.
-- Reversão no final do arquivo (comentada).
-- =====================================================================

-- 1. Prazo de retorno no serviço (null = serviço não gera retorno)
alter table services add column if not exists return_after_days int
  check (return_after_days is null or return_after_days between 1 and 365);

-- 2. Marca "já chamei para voltar" no último atendimento concluído
alter table bookings add column if not exists return_contacted_at timestamptz;

create index if not exists idx_bookings_return
  on bookings (business_id, customer_id, service_id, booking_date desc)
  where status = 'completed';

-- 3. Fila de retornos
-- security invoker: respeita a RLS de bookings (staff só vê quem atendeu).
-- Regra: último atendimento concluído por cliente + serviço com prazo,
-- sem agendamento futuro (pending/confirmed) desse cliente no espaço.
create or replace function return_queue(p_business uuid, p_days_ahead int default 7)
returns table (
  booking_id          uuid,
  customer_id         uuid,
  customer_name       text,
  customer_phone      text,
  service_id          uuid,
  service_name        text,
  professional_name   text,
  last_date           date,
  due_date            date,
  days_overdue        int,
  return_contacted_at timestamptz
)
language sql stable security invoker set search_path = public
as $$
  with today as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  ),
  last_visit as (
    select distinct on (b.customer_id, b.service_id)
      b.id, b.customer_id, b.service_id, b.booking_date, b.service_name,
      b.professional_name, b.return_contacted_at, s.return_after_days
    from bookings b
    join services s on s.id = b.service_id
    where b.business_id = p_business
      and b.status = 'completed'
      and b.customer_id is not null
      and s.return_after_days is not null
    order by b.customer_id, b.service_id, b.booking_date desc, b.start_time desc
  )
  select
    lv.id, lv.customer_id, c.name, c.phone, lv.service_id, lv.service_name, lv.professional_name,
    lv.booking_date,
    lv.booking_date + lv.return_after_days,
    (t.d - (lv.booking_date + lv.return_after_days))::int,
    lv.return_contacted_at
  from last_visit lv
  join customers c on c.id = lv.customer_id
  cross join today t
  where lv.booking_date + lv.return_after_days <= t.d + greatest(p_days_ahead, 0)
    and not exists (
      select 1 from bookings f
      where f.business_id = p_business
        and f.customer_id = lv.customer_id
        and f.status in ('pending', 'confirmed')
        and f.booking_date >= t.d
    )
  order by lv.booking_date + lv.return_after_days;
$$;

grant execute on function return_queue(uuid, int) to authenticated;

-- 4. Histórico: registra o contato de retorno em booking_events
-- (trigger separado para não mexer em log_booking_event)
create or replace function log_return_contact()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.return_contacted_at is not null and old.return_contacted_at is null then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role)
    values (new.id, new.business_id, 'return_contact', auth.uid(),
            coalesce(member_role_of(new.business_id), 'sistema'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_return_contact on bookings;
create trigger trg_log_return_contact
after update of return_contacted_at on bookings
for each row execute function log_return_contact();

-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- drop trigger if exists trg_log_return_contact on bookings;
-- drop function if exists log_return_contact();
-- drop function if exists return_queue(uuid, int);
-- drop index if exists idx_bookings_return;
-- alter table bookings drop column if exists return_contacted_at;
-- alter table services drop column if exists return_after_days;
-- =====================================================================
