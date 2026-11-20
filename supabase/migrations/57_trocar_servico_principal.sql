-- =====================================================================
-- GENIX AGENDA — 57: Trocar o serviço principal no "Editar agendamento"
-- Aditiva. Rodar ANTES do merge (a tela nova chama booking_change_service
-- e lê os campos novos de booking_edit_info). Pode rodar de novo sem erro.
-- Tudo em begin/commit. Reversão comentada no final.
--
-- O que faz:
--   • booking_change_service: troca o item 0 (ou o combo inteiro do item 0)
--     por outro serviço ou combo que o profissional faz. Só pending/confirmed.
--     Mantém o início, os adicionais e o desconto; recalcula preço e duração
--     (recalc_booking). Confere meia-noite, bloqueio no trecho novo, ocupado
--     (no_overlap + gatilho do encaixe sobreposto) e, se o próprio agendamento
--     for um encaixe sobreposto, overlay_slot_issue. Não coube = nada muda.
--   • Pacote: item 0 pago pelo pacote só troca por outro serviço com saldo no
--     MESMO pacote (o saldo do anterior volta sozinho: é calculado); qualquer
--     outro serviço exige p_unlink_package = true (sai do pacote e passa a ser
--     cobrado). Combo nunca é pago por pacote.
--   • Combo → serviço: o combo inteiro sai. Serviço → combo: só a partir do
--     Profissional (PLANO_PROFISSIONAL), preço dividido como no Adicionar.
--   • Desconto do profissional: se, com o novo valor, passar do limite dele
--     (staff_discount_max_pct), a troca é recusada (mesma regra do
--     booking_set_discount: ele não mexe em desconto acima do limite).
--   • Histórico: booking_events 'service_changed' com de/para e quem trocou.
--     Não gera 'confirmed' nem 'rescheduled' (o WhatsApp não reenvia a
--     confirmação; véspera e antes do horário leem o serviço na hora do envio).
--   • booking_edit_info (corpo da 52a) ganha main_package_id e, em
--     package_options[], package_id.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Trocar o serviço principal
-- p_package_item: serviço do MESMO pacote do item 0 (só em sessão de pacote)
-- p_unlink_package: confirma que a sessão sai do pacote (serviço de fora)
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | STATUS_INVALIDO | SERVICO_INVALIDO
--        SEM_MUDANCA | PLANO_PROFISSIONAL | PROFISSIONAL_NAO_FAZ | COMBO_INCOMPLETO
--        LIMITE_ITENS | MEIA_NOITE | BLOQUEIO | OCUPADO | LIVRE | JA_TEM_ENCAIXE
--        PACOTE_INVALIDO | PACOTE_VENCIDO | PACOTE_SEM_SALDO | PACOTE_DESVINCULAR
--        JA_NO_AGENDAMENTO | DESCONTO_ACIMA_LIMITE:<limite>
-- =====================================================================
create or replace function booking_change_service(
  p_booking uuid, p_service uuid, p_package_item uuid default null, p_unlink_package boolean default false
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk        bookings;
  nb        bookings;
  it0       booking_items;
  s         services;
  pi        customer_package_items;
  v_role    text;
  v_pkg     uuid;          -- pacote do item 0 (sessão de pacote)
  v_mode    text;          -- null | 'kept' | 'unlinked'
  v_old_n   int;           -- itens do principal antigo (combo = vários)
  v_old_dur int;
  v_old_prc numeric;
  v_old_nm  text;
  v_new_n   int;
  v_new_dur int;
  v_total   int;
  v_dur     int;
  v_endm    int;
  v_end     time;
  v_issue   text;
  v_lim     numeric;
  v_base    numeric;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;
  v_role := member_role_of(bk.business_id);

  select * into s from services where id = p_service and business_id = bk.business_id and active;
  if not found then raise exception 'SERVICO_INVALIDO'; end if;
  if s.id = bk.service_id then raise exception 'SEM_MUDANCA'; end if;
  if s.kind = 'combo' and not plan_allows(bk.business_id, 'profissional') then raise exception 'PLANO_PROFISSIONAL'; end if;
  if not professional_does_service(bk.professional_id, s.id) then raise exception 'PROFISSIONAL_NAO_FAZ'; end if;

  select * into it0 from booking_items where booking_id = bk.id and position = 0;
  if not found then raise exception 'SEM_ITENS'; end if;

  -- principal antigo: o item 0 ou o combo inteiro dele
  select count(*), coalesce(sum(duration_min), 0), coalesce(sum(price), 0),
         coalesce(max(combo_name), max(service_name))
    into v_old_n, v_old_dur, v_old_prc, v_old_nm
    from booking_items
   where booking_id = bk.id
     and (id = it0.id or (it0.combo_group is not null and combo_group = it0.combo_group));

  -- principal novo
  if s.kind = 'combo' then
    select count(*), coalesce(sum(c.duration_min), 0) into v_new_n, v_new_dur
      from combo_items ci join services c on c.id = ci.service_id where ci.combo_id = s.id;
    if v_new_n = 0 then raise exception 'COMBO_INCOMPLETO'; end if;
  else
    v_new_n := 1;
    v_new_dur := s.duration_min;
  end if;

  select count(*) into v_total from booking_items where booking_id = bk.id;
  if v_total - v_old_n + v_new_n > 10 then raise exception 'LIMITE_ITENS'; end if;

  -- pacote
  if it0.customer_package_item_id is not null then
    select customer_package_id into v_pkg from customer_package_items where id = it0.customer_package_item_id;
  end if;
  v_pkg := coalesce(v_pkg, bk.customer_package_id);

  if v_pkg is not null and p_package_item is not null then
    select * into pi from customer_package_items where id = p_package_item;
    if not found or pi.customer_package_id <> v_pkg or pi.service_id is distinct from s.id or s.kind = 'combo' then
      raise exception 'PACOTE_INVALIDO';
    end if;
    -- já está nesta data como serviço do mesmo pacote: usar "Serviços do pacote nesta data"
    if exists (select 1 from booking_items i join customer_package_items x on x.id = i.customer_package_item_id
                where i.booking_id = bk.id and i.position > 0
                  and x.customer_package_id = v_pkg and x.service_id = s.id) then
      raise exception 'JA_NO_AGENDAMENTO';
    end if;
    v_mode := 'kept';
  elsif v_pkg is not null then
    if not coalesce(p_unlink_package, false) then raise exception 'PACOTE_DESVINCULAR'; end if;
    v_mode := 'unlinked';
  elsif p_package_item is not null then
    raise exception 'PACOTE_INVALIDO';
  end if;

  -- horário: o início não muda; nova duração = total − antigo + novo
  v_dur := bk.duration_min - v_old_dur + v_new_dur;
  v_endm := extract(hour from bk.start_time)::int * 60 + extract(minute from bk.start_time)::int + v_dur;
  if v_endm >= 24 * 60 then raise exception 'MEIA_NOITE'; end if;
  v_end := make_time(v_endm / 60, v_endm % 60, 0);

  if v_end > bk.end_time then
    if coalesce(bk.overlay, false) then
      -- encaixe sobreposto: precisa continuar por cima de um atendimento, sem outro encaixe nem bloqueio
      v_issue := overlay_slot_issue(bk.business_id, null, bk.professional_id, bk.booking_date,
                                    bk.start_time, v_dur, bk.id);
      if v_issue is not null then raise exception '%', v_issue; end if;
    elsif slot_conflicts_block(bk.business_id, bk.professional_id, bk.booking_date, bk.end_time, v_end) then
      raise exception 'BLOQUEIO';
    end if;
  end if;

  -- troca dos itens: sai o principal antigo, adicionais vão para o fim
  delete from booking_items
   where booking_id = bk.id
     and (id = it0.id or (it0.combo_group is not null and combo_group = it0.combo_group));
  update booking_items set position = position + 100 where booking_id = bk.id;

  if v_mode = 'kept' then
    insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                               position, extends_time, paid_by_package, added_by, customer_package_item_id)
    values (bk.id, bk.business_id, s.id, s.name, s.price, s.duration_min,
            0, true, true, auth.uid(), p_package_item);
  else
    perform add_service_items(bk.id, s.id, 0, true, false, s.price);
  end if;

  update booking_items i
     set position = v_new_n + r.rn - 1
    from (select id, row_number() over (order by position) as rn
            from booking_items where booking_id = bk.id and position >= 100) r
   where i.id = r.id;

  perform set_config('genix.booking_edit', '1', true);
  if v_mode = 'unlinked' then
    update bookings set service_id = s.id, customer_package_id = null where id = bk.id;
  else
    update bookings set service_id = s.id where id = bk.id;
  end if;

  begin
    perform recalc_booking(bk.id);
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  select * into nb from bookings where id = bk.id;

  -- desconto do profissional: com o novo valor, não pode passar do limite dele
  if v_role = 'staff' and nb.discount_amount > 0 then
    select coalesce(staff_discount_max_pct, 0) into v_lim from businesses where id = bk.business_id;
    select coalesce(sum(price) filter (where not paid_by_package), 0) into v_base
      from booking_items where booking_id = bk.id;
    if nb.discount_amount > round(v_base * v_lim / 100, 2) then
      raise exception 'DESCONTO_ACIMA_LIMITE:%', v_lim;
    end if;
  end if;

  insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
  values (bk.id, bk.business_id, 'service_changed', auth.uid(), coalesce(v_role, 'sistema'),
          jsonb_build_object(
            'from', jsonb_build_object('service', v_old_nm, 'price', v_old_prc, 'duration', v_old_dur,
                                       'combo', it0.combo_group is not null),
            'to',   jsonb_build_object('service', s.name, 'price', s.price, 'duration', v_new_dur,
                                       'combo', s.kind = 'combo'),
            'total_from', jsonb_build_object('price', bk.price, 'duration', bk.duration_min),
            'total_to',   jsonb_build_object('price', nb.price, 'duration', nb.duration_min),
            'package', v_mode));

  return json_build_object('ok', true, 'end_time', to_char(nb.end_time, 'HH24:MI'), 'price', nb.price,
                           'package', v_mode);
end;
$$;

revoke all on function booking_change_service(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function booking_change_service(uuid, uuid, uuid, boolean) to authenticated;


-- =====================================================================
-- PARTE 2 — Dados do "Editar" (corpo da 52a + main_package_id e
-- package_options[].package_id). Só acrescenta campos ao JSON.
-- =====================================================================
create or replace function booking_edit_info(p_booking uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  bk     bookings;
  v_role text;
  v_lim  numeric;
  v_paid boolean;
  v_pkg  uuid;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;

  v_role := member_role_of(bk.business_id);
  if v_role = 'staff' then
    select staff_discount_max_pct into v_lim from businesses where id = bk.business_id;
  end if;
  v_paid := plan_allows(bk.business_id, 'profissional');

  -- 57: pacote do serviço principal (sessão de pacote)
  select x.customer_package_id into v_pkg
    from booking_items i join customer_package_items x on x.id = i.customer_package_item_id
   where i.booking_id = bk.id and i.position = 0;
  v_pkg := coalesce(v_pkg, bk.customer_package_id);

  return json_build_object(
    'status',          bk.status,
    'start_time',      to_char(bk.start_time, 'HH24:MI'),
    'end_time',        to_char(bk.end_time, 'HH24:MI'),
    'price',           bk.price,
    'discount_kind',   bk.discount_kind,
    'discount_input',  bk.discount_input,
    'discount_amount', bk.discount_amount,
    'discount_reason', bk.discount_reason,
    'discount_limit',  v_lim,
    'main_service_id', bk.service_id,
    'main_package_id', v_pkg,
    'items', coalesce((
      select json_agg(json_build_object(
               'id', i.id, 'service_id', i.service_id, 'name', i.service_name, 'price', i.price,
               'duration', i.duration_min, 'position', i.position, 'extends_time', i.extends_time,
               'paid_by_package', i.paid_by_package, 'combo_group', i.combo_group, 'combo_name', i.combo_name,
               'package_item_id', i.customer_package_item_id)
               order by i.position)
        from booking_items i where i.booking_id = bk.id), '[]'::json),
    'services', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name, 'price', s.price, 'duration', s.duration_min,
                                        'kind', s.kind,
                                        'normal_price', case when s.kind = 'combo' then
                                          (select coalesce(sum(c.price), 0) from combo_items ci
                                             join services c on c.id = ci.service_id where ci.combo_id = s.id) end)
                      order by s.kind desc, s.sort_order, s.name)
        from services s
       where s.business_id = bk.business_id and s.active
         and (s.kind = 'servico' or v_paid)
         and professional_does_service(bk.professional_id, s.id)), '[]'::json),
    'package_options', coalesce((
      select json_agg(json_build_object('id', pi.id, 'service_id', pi.service_id, 'package_name', cp.name,
                                        'package_id', cp.id,
                                        'remaining', pi.sessions_total - package_item_used(pi.id))
                      order by cp.sold_at, pi.position)
        from customer_package_items pi
        join customer_packages cp on cp.id = pi.customer_package_id
       where bk.customer_id is not null
         and cp.customer_id = bk.customer_id
         and cp.business_id = bk.business_id
         and cp.status = 'active'
         and (cp.expires_at is null or cp.expires_at >= bk.booking_date)
         and pi.service_id is not null
         and package_item_used(pi.id) < pi.sessions_total), '[]'::json)
  );
end;
$$;

commit;


-- =====================================================================
-- Conferência (depois do commit): deve devolver 1 linha
-- =====================================================================
-- select proname from pg_proc where proname = 'booking_change_service';


-- =====================================================================
-- REVERSÃO
-- Reverta o código ANTES se o PR já estiver no ar (a tela chamaria uma
-- função que não existe mais). Trocas já feitas continuam como estão; o
-- histórico 'service_changed' fica (a ficha antiga mostra só o nome da ação).
-- =====================================================================
-- begin;
-- drop function if exists booking_change_service(uuid, uuid, uuid, boolean);
-- -- cole e rode o booking_edit_info da 52a (6.3, sem main_service_id/main_package_id/package_id)
-- commit;
