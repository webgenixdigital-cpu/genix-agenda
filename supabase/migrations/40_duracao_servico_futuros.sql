-- =====================================================================
-- GENIX AGENDA — 40: mudar a duração de um serviço e atualizar os
-- agendamentos FUTUROS que já têm esse serviço.
--
-- Ao salvar uma duração nova em Serviços, o painel pergunta se atualiza os
-- N agendamentos futuros (pending/confirmed, a partir de agora no fuso do
-- espaço) que têm um item desse serviço — avulso, adicional ou dentro de
-- combo. Antes de aplicar, mostra os que passariam do início do próximo
-- horário do mesmo profissional (conflito) ou da meia-noite.
--
--   preview_service_duration_change(serviço, nova duração)  → lista (só leitura)
--   apply_service_duration_change(serviço, nova duração, ids) → aplica
--
-- Aplicar: troca booking_items.duration_min dos itens desse serviço e roda
-- recalc_booking (31/32), que recalcula duration_min e end_time do
-- agendamento somando os itens (adicionais e combos). Registra em
-- booking_events a ação 'duration_updated' com a duração antiga e a nova
-- (do serviço e do agendamento). Só matriz (owner) e recepção. Cada
-- agendamento vai num bloco próprio: conflito (no_overlap), meia-noite ou
-- item mudado no meio do caminho pula só aquele e entra em "skipped" com o
-- motivo (CONFLITO | MEIA_NOITE | NAO_ENCONTRADO | ERRO), que o painel mostra.
-- O horário de início nunca muda.
--
-- ORDEM: rodar ANTES do merge (só acrescenta funções; o código atual
-- continua funcionando). Tudo dentro de begin/commit. Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Prévia (só leitura)
-- =====================================================================
create or replace function preview_service_duration_change(p_service uuid, p_duration int)
returns table (
  booking_id        uuid,
  booking_date      date,
  start_time        time,
  old_end           time,
  new_end           time,
  old_duration      int,
  new_duration      int,
  customer_name     text,
  professional_name text,
  conflict          text,   -- null = ok | 'proximo' | 'meia_noite'
  next_start        time,
  next_customer     text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz  uuid;
  v_tz   text;
  v_now  timestamp;
begin
  if p_duration is null or p_duration < 5 or p_duration > 600 then
    raise exception 'DURACAO_INVALIDA';
  end if;

  select s.business_id, b.timezone into v_biz, v_tz
    from services s join businesses b on b.id = s.business_id
   where s.id = p_service;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;

  if coalesce(member_role_of(v_biz), '') not in ('owner', 'reception') then
    raise exception 'SEM_PERMISSAO';
  end if;

  v_now := now() at time zone v_tz;

  return query
  with afetados as (
    select bk.id, bk.booking_date, bk.start_time, bk.end_time, bk.duration_min,
           bk.customer_name, bk.professional_name, bk.professional_id,
           (select coalesce(sum(case when i.service_id = p_service then p_duration else i.duration_min end), 0)
              from booking_items i
             where i.booking_id = bk.id and (i.position = 0 or i.extends_time))::int as nova
      from bookings bk
     where bk.business_id = v_biz
       and bk.status in ('pending', 'confirmed')
       and (bk.booking_date + bk.start_time) > v_now
       and exists (select 1 from booking_items i
                    where i.booking_id = bk.id and i.service_id = p_service and i.duration_min <> p_duration)
  ),
  calc as (
    select a.*,
           (extract(hour from a.start_time)::int * 60 + extract(minute from a.start_time)::int + a.nova) as fim_min,
           nx.start_time as nx_start, nx.customer_name as nx_customer
      from afetados a
      left join lateral (
        select o.start_time, o.customer_name
          from bookings o
         where o.professional_id = a.professional_id
           and o.booking_date = a.booking_date
           and o.status in ('pending', 'confirmed')
           and o.id <> a.id
           and o.start_time >= a.start_time
         order by o.start_time
         limit 1
      ) nx on true
  )
  select c.id, c.booking_date, c.start_time, c.end_time,
         case when c.fim_min < 24 * 60 then make_time(c.fim_min / 60, c.fim_min % 60, 0) end,
         c.duration_min::int, c.nova,
         c.customer_name, c.professional_name,
         case
           when c.fim_min >= 24 * 60 then 'meia_noite'
           when c.nx_start is not null and make_time(c.fim_min / 60, c.fim_min % 60, 0) > c.nx_start then 'proximo'
         end,
         c.nx_start, c.nx_customer
    from calc c
   order by c.booking_date, c.start_time;
end;
$$;


-- =====================================================================
-- PARTE 2 — Aplicar
-- Recebe os ids escolhidos no painel (normalmente os sem conflito) e
-- confere tudo de novo aqui: só agendamento futuro, do mesmo espaço, com
-- item desse serviço. Devolve {"updated": n, "skipped": [{id, reason, detail?}]}
-- reason: CONFLITO (no_overlap) | MEIA_NOITE | NAO_ENCONTRADO (não é mais
-- futuro/ativo, ou o item já mudou) | ERRO (outro; texto em detail).
-- =====================================================================
create or replace function apply_service_duration_change(p_service uuid, p_duration int, p_booking_ids uuid[])
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_biz     uuid;
  v_tz      text;
  v_now     timestamp;
  v_role    text;
  v_old_svc int;
  bk        bookings;
  v_new     bookings;
  v_updated int := 0;
  v_skipped json[] := '{}';   -- {"id", "reason": CONFLITO|MEIA_NOITE|NAO_ENCONTRADO|ERRO, "detail"?}
  v_id      uuid;
  v_prev    text := coalesce(current_setting('genix.booking_edit', true), '');
begin
  if p_duration is null or p_duration < 5 or p_duration > 600 then
    raise exception 'DURACAO_INVALIDA';
  end if;

  select s.business_id, b.timezone into v_biz, v_tz
    from services s join businesses b on b.id = s.business_id
   where s.id = p_service;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;

  v_role := member_role_of(v_biz);
  if coalesce(v_role, '') not in ('owner', 'reception') then
    raise exception 'SEM_PERMISSAO';
  end if;

  v_now := now() at time zone v_tz;

  foreach v_id in array coalesce(p_booking_ids, '{}') loop
    select * into bk from bookings
     where id = v_id
       and business_id = v_biz
       and status in ('pending', 'confirmed')
       and (booking_date + start_time) > v_now
     for update;
    if not found then
      v_skipped := v_skipped || json_build_object('id', v_id, 'reason', 'NAO_ENCONTRADO');
      continue;
    end if;

    -- duração antiga do item desse serviço (a primeira, para o histórico)
    v_old_svc := null;
    select i.duration_min into v_old_svc
      from booking_items i
     where i.booking_id = bk.id and i.service_id = p_service and i.duration_min <> p_duration
     order by i.position
     limit 1;
    if v_old_svc is null then
      v_skipped := v_skipped || json_build_object('id', v_id, 'reason', 'NAO_ENCONTRADO');
      continue;
    end if;

    begin
      -- 31 não tem guard em booking_items (só em bookings); o flag fica ligado
      -- por precaução, como no recalc_booking, e volta ao valor anterior abaixo
      perform set_config('genix.booking_edit', '1', true);
      update booking_items
         set duration_min = p_duration
       where booking_id = bk.id and service_id = p_service;

      -- recalcula total, duration_min e end_time (liga e devolve genix.booking_edit)
      perform recalc_booking(bk.id);
      perform set_config('genix.booking_edit', v_prev, true);

      select * into v_new from bookings where id = bk.id;

      insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
      values (bk.id, bk.business_id, 'duration_updated', auth.uid(), v_role,
              jsonb_build_object(
                'service_id', p_service,
                'service_from', v_old_svc,
                'service_to', p_duration,
                'from', bk.duration_min,
                'to', v_new.duration_min,
                'end_from', to_char(bk.end_time, 'HH24:MI'),
                'end_to', to_char(v_new.end_time, 'HH24:MI')));

      v_updated := v_updated + 1;
    exception
      -- desfaz só este e segue, guardando o motivo
      when exclusion_violation then   -- trava no_overlap: invadiu o próximo horário
        perform set_config('genix.booking_edit', v_prev, true);
        v_skipped := v_skipped || json_build_object('id', v_id, 'reason', 'CONFLITO');
      when others then
        perform set_config('genix.booking_edit', v_prev, true);
        v_skipped := v_skipped || json_build_object(
          'id', v_id,
          'reason', case when sqlerrm like '%MEIA_NOITE%' then 'MEIA_NOITE' else 'ERRO' end,
          'detail', sqlerrm);
    end;
  end loop;

  return json_build_object('updated', v_updated, 'skipped', array_to_json(v_skipped));
end;
$$;


-- =====================================================================
-- PARTE 3 — Permissões
-- =====================================================================
revoke all on function preview_service_duration_change(uuid, int)        from public, anon;
revoke all on function apply_service_duration_change(uuid, int, uuid[])   from public, anon;
grant execute on function preview_service_duration_change(uuid, int)      to authenticated;
grant execute on function apply_service_duration_change(uuid, int, uuid[]) to authenticated;

commit;


-- =====================================================================
-- Conferência: as duas funções devem aparecer
-- =====================================================================
select proname from pg_proc
 where proname in ('preview_service_duration_change', 'apply_service_duration_change')
 order by 1;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer)
-- Agendamentos já atualizados mantêm a duração nova (e o evento no histórico)
-- =====================================================================
-- drop function if exists apply_service_duration_change(uuid, int, uuid[]);
-- drop function if exists preview_service_duration_change(uuid, int);
