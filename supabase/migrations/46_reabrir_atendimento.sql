-- =====================================================================
-- 46 — Reabrir atendimento concluído por engano
--
-- Aditiva: nenhuma tabela ou coluna nova, nenhum dado existente muda.
--
--   1) log_booking_event: cópia EXATA da versão mais recente (PARTE 4 de
--      25_confirmacao_automatica.sql; 14 e 23 são anteriores, nenhuma
--      migration depois da 25 a redefine) com UMA linha diferente: o evento
--      de status não é gravado quando a transação liga
--      genix.booking_reopen = '1'. Sem isso, reabrir gravaria um evento
--      'confirmed', que é a âncora da confirmação automática do WhatsApp
--      (42/44/45) e mandaria “seu horário está confirmado” ao cliente.
--   2) reopen_booking(p_booking): numa transação só
--        - só matriz e recepção; recepção só até 30 dias da conclusão;
--        - status volta para o anterior à conclusão (pending/confirmed,
--          lido do evento 'completed'; senão 'confirmed');
--        - apaga SÓ o lançamento automático do caixa deste atendimento,
--          conferindo que ele está como a conclusão gravou (tipo, categoria,
--          data e valor cobrado = price − itens pagos pelo pacote, a mesma
--          conta da complete_booking da 31). Diferente → CAIXA_EDITADO;
--        - grava em booking_events a ação 'reopened' com quem, quando,
--          valor, forma e data do lançamento desfeito.
--
-- O que NÃO precisa mudar (conferido nas migrations 01→45):
--   - partner_pct (repasse do parceiro): o gatilho snapshot_partner_pct (24)
--     já volta para null quando o status sai de 'completed';
--   - “Meus ganhos”, billing_monthly, customer_summary, Retornos, ficha:
--     calculados a partir de status = 'completed' e do caixa;
--   - pacote: a sessão conta no saldo enquanto o agendamento está pendente,
--     confirmado ou concluído (views da 37). Reaberto = confirmado: a sessão
--     continua reservada para este horário; volta ao saldo só se cancelar;
--   - avaliação: o link é o id do agendamento e submit_review (04) exige
--     'completed'. Reaberto, o link recusa sozinho; avaliação já enviada fica.
--
-- Erros de reopen_booking: NAO_ENCONTRADO | STATUS_INVALIDO | SEM_PERMISSAO |
--   PRAZO_SO_DONO | CAIXA_EDITADO | HORARIO_OCUPADO
--
-- Ordem: rodar ANTES do merge. Não remove permissão de ninguém.
-- =====================================================================
begin;


-- =====================================================================
-- PARTE 1 — log_booking_event (cópia da 25 PARTE 4 + sinal da reabertura)
-- Única linha diferente: "if new.status is distinct from old.status ..."
-- =====================================================================
create or replace function log_booking_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text := coalesce(
                    nullif(current_setting('genix.actor_role', true), ''),
                    case when auth.uid() is null then 'online' else coalesce(member_role_of(new.business_id), 'sistema') end);
begin
  if tg_op = 'INSERT' then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, 'created', v_actor, v_role,
            jsonb_build_object('source', new.source, 'status', new.status,
                               'date', new.booking_date, 'time', to_char(new.start_time, 'HH24:MI'),
                               'professional', new.professional_name));
    -- 25_confirmacao_automatica
    if new.status = 'confirmed' and new.auto_confirm_reason is not null then
      insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
      values (new.id, new.business_id, 'confirmed', null, 'sistema',
              jsonb_build_object('reason', new.auto_confirm_reason));
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and coalesce(current_setting('genix.booking_reopen', true), '') <> '1' then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, new.status::text, v_actor, v_role, jsonb_build_object('from', old.status));
  end if;

  if new.booking_date is distinct from old.booking_date
     or new.start_time is distinct from old.start_time
     or new.professional_id is distinct from old.professional_id then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (new.id, new.business_id, 'rescheduled', v_actor, v_role,
            jsonb_build_object(
              'from', jsonb_build_object('date', old.booking_date, 'time', to_char(old.start_time, 'HH24:MI'), 'professional', old.professional_name),
              'to',   jsonb_build_object('date', new.booking_date, 'time', to_char(new.start_time, 'HH24:MI'), 'professional', new.professional_name)));
  end if;

  if new.reminder_sent_at is not null and old.reminder_sent_at is null then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role)
    values (new.id, new.business_id, 'reminder', v_actor, v_role);
  end if;

  return new;
end;
$$;


-- =====================================================================
-- PARTE 2 — reopen_booking: desfaz a conclusão (status + caixa + histórico)
-- =====================================================================
create or replace function reopen_booking(p_booking uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk        bookings;
  v_role    text;
  v_tz      text;
  v_done_at timestamptz;
  v_from    text;
  v_to      text;
  v_pkg     numeric;
  v_charge  numeric;
  ce        cash_entries;
  v_cash    jsonb := null;
  v_name    text;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if bk.status <> 'completed' then raise exception 'STATUS_INVALIDO'; end if;

  -- matriz e recepção (profissional e demonstração não reabrem)
  v_role := member_role_of(bk.business_id);
  if coalesce(v_role in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;

  -- quando foi concluído e de que status veio (último evento 'completed')
  select e.created_at, e.details->>'from' into v_done_at, v_from
    from booking_events e
   where e.booking_id = bk.id and e.action = 'completed'
   order by e.created_at desc
   limit 1;

  -- recepção: só até 30 dias da conclusão (sem evento, vale a data do atendimento)
  select coalesce(b.timezone, 'America/Sao_Paulo') into v_tz from businesses b where b.id = bk.business_id;
  if v_role = 'reception'
     and coalesce((v_done_at at time zone v_tz)::date, bk.booking_date)
         < (now() at time zone v_tz)::date - 30 then
    raise exception 'PRAZO_SO_DONO';
  end if;

  v_to := case when v_from in ('pending', 'confirmed') then v_from else 'confirmed' end;

  -- caixa: só o lançamento automático deste atendimento, do jeito que a conclusão gravou
  select * into ce from cash_entries where booking_id = bk.id for update;
  if found then
    select sum(price) filter (where paid_by_package) into v_pkg from booking_items where booking_id = bk.id;
    v_pkg := coalesce(v_pkg, case when bk.customer_package_id is not null then bk.price else 0 end);
    v_charge := greatest(bk.price - v_pkg, 0);

    if ce.kind <> 'income' or ce.category <> 'atendimento'
       or ce.entry_date <> bk.booking_date or ce.amount <> v_charge then
      raise exception 'CAIXA_EDITADO';
    end if;

    v_cash := jsonb_build_object('amount', ce.amount, 'method', ce.method, 'entry_date', ce.entry_date);
    delete from cash_entries where id = ce.id;
  end if;

  -- status anterior; o gatilho de histórico não grava 'confirmed' (o evento é o 'reopened')
  perform set_config('genix.booking_reopen', '1', true);
  begin
    update bookings set status = v_to::booking_status where id = bk.id;
  exception
    when exclusion_violation then raise exception 'HORARIO_OCUPADO';
  end;
  perform set_config('genix.booking_reopen', '', true);

  -- nome de quem reabriu (guardado no evento: o histórico mostra mesmo se o acesso sair)
  select coalesce(nullif(trim(m.display_name), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), ''))
    into v_name
    from business_members m
    left join auth.users u on u.id = m.user_id
   where m.business_id = bk.business_id and m.user_id = auth.uid();

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'reopened', auth.uid(), v_role,
          jsonb_build_object(
            'actor_name',   v_name,
            'from',         'completed',
            'to',           v_to,
            'completed_at', v_done_at,
            'cash',         v_cash,
            'review_kept',  exists (select 1 from reviews r where r.booking_id = bk.id)));

  return json_build_object('ok', true, 'status', v_to,
                           'cash_amount', v_cash->'amount', 'cash_method', v_cash->>'method');
end;
$$;


-- =====================================================================
-- PARTE 3 — Permissões
-- (log_booking_event mantém as que tinha: create or replace não muda grants)
-- =====================================================================
revoke all on function reopen_booking(uuid) from public, anon;
grant execute on function reopen_booking(uuid) to authenticated;

commit;


-- =====================================================================
-- PARTE 4 — Conferência
-- 1) reopen_booking presente, executável só por authenticated (+ dono)
-- 2) log_booking_event com o sinal da reabertura (deve dar true)
-- =====================================================================
select grantee, privilege_type
  from information_schema.routine_privileges
 where routine_name = 'reopen_booking'
 order by grantee;

select pg_get_functiondef('log_booking_event()'::regprocedure) like '%genix.booking_reopen%' as gatilho_atualizado;


-- =====================================================================
-- REVERSÃO (comentada; rodar só se precisar desfazer)
-- 1) Restaure log_booking_event: cole e rode a PARTE 4 de
--    25_confirmacao_automatica.sql (o create or replace da função).
-- 2) Depois:
-- drop function if exists reopen_booking(uuid);
-- (eventos 'reopened' já gravados em booking_events ficam como histórico;
--  lançamentos de caixa apagados por uma reabertura não voltam: o valor e a
--  forma estão em booking_events.details->'cash' de cada 'reopened'.)
-- =====================================================================
