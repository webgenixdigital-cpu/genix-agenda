-- =====================================================================
-- GENIX AGENDA — 48: pacote com datas fixas, serviços escolhidos por data
-- (N4.3, continuação da 37_plano_fechado e da 39_pacote_datas_fixas)
--
-- 1) Venda: em vez de "cada data leva todos os serviços da regra que têm
--    saldo", a tela manda a LISTA DE VISITAS já decidida (data, horário,
--    profissional e os serviços marcados em cada uma). O banco confere:
--    saldo por serviço (não passa do modelo), validade, horário de cada
--    visita pela duração SOMADA (expediente, bloqueio, ocupado) e visitas
--    da mesma venda que se sobrepõem. Data sem serviço marcado é ignorada.
--    Mais de um serviço na mesma data = UMA visita (item 0 + adicionais
--    pagos pelo pacote, como na 39). Data com problema é pulada e a sessão
--    fica livre no saldo ("sem data").
-- 2) Depois da venda: em qualquer sessão de pacote (pendente/confirmada),
--    matriz, recepção e o profissional da própria data marcam/desmarcam os
--    serviços do pacote daquela data. Se o 1º serviço sair, outro serviço
--    marcado vira o principal (item 0) — só aqui, só com serviço do mesmo
--    pacote, com registro no histórico. Nunca fica sem serviço (aí é cancelar).
--
-- Só acrescenta funções: 37, 39 e 45 continuam iguais (sell_package_fixed,
-- preview_package_sale, package_plan_dates, booking_add_item, booking_remove_item
-- não mudam). Nenhuma tabela nova, nenhuma coluna nova.
-- Rode inteira de uma vez, ANTES do merge. Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Visitas da venda (regra única da prévia e da venda)
-- p_visits = [{"rule": 0, "date": "AAAA-MM-DD", "time": "HH:MM",
--              "professional_id": uuid, "service_ids": [uuid, ...]}]  (1 a 100)
-- Serviços de cada visita na ordem do pacote: o primeiro é o item 0.
-- issue: null (ok) | PACOTE_VENCIDO | OCUPADO_NA_VENDA | motivos de
--        booking_slot_issue_except (PASSADO, FECHADO, FORA_EXPEDIENTE, BLOQUEIO, OCUPADO...)
-- Erros: VISITAS_INVALIDAS | DADOS_INVALIDOS | SERVICOS_INVALIDOS | SALDO_EXCEDIDO
--        PROFISSIONAL_INDISPONIVEL | PROFISSIONAL_NAO_FAZ | SEM_PERMISSAO
-- =====================================================================
create or replace function package_plan_visits(p_business uuid, p_template uuid, p_expires date, p_visits jsonb)
returns table (idx int, rule_idx int, occurs_on date, start_time time, professional_id uuid,
               service_ids uuid[], service_names text, duration_min int, issue text)
language plpgsql volatile security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_saldo jsonb;
  v_used  jsonb := '{}'::jsonb;
  v_taken tsrange[] := '{}';
  v_visit jsonb;
  v_prof  uuid;
  v_ids   uuid[];
  v_names text;
  v_dur   int;
  v_issue text;
  v_range tsrange;
  v_sid   text;
  r       record;
begin
  if p_visits is null or jsonb_typeof(p_visits) <> 'array'
     or jsonb_array_length(p_visits) < 1 or jsonb_array_length(p_visits) > 100 then
    raise exception 'VISITAS_INVALIDAS';
  end if;

  select coalesce(jsonb_object_agg(i.service_id::text, i.sessions), '{}'::jsonb)
    into v_saldo
    from package_template_items i where i.template_id = p_template;

  -- confere cada visita e soma o uso por serviço
  for v_visit in select value from jsonb_array_elements(p_visits) loop
    if jsonb_typeof(v_visit) <> 'object'
       or coalesce(v_visit->>'time', '') !~ '^\d{2}:\d{2}$'
       or coalesce(v_visit->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_visit->>'professional_id', '') !~* '^[0-9a-f-]{36}$'
       or coalesce(v_visit->>'rule', '0') !~ '^\d{1,2}$'
       or jsonb_typeof(coalesce(v_visit->'service_ids', '[]'::jsonb)) <> 'array' then
      raise exception 'DADOS_INVALIDOS';
    end if;
    -- data sem serviço marcado não vira visita
    continue when jsonb_array_length(coalesce(v_visit->'service_ids', '[]'::jsonb)) = 0;

    v_prof := (v_visit->>'professional_id')::uuid;
    if not exists (select 1 from professionals p where p.id = v_prof and p.business_id = p_business and p.active) then
      raise exception 'PROFISSIONAL_INDISPONIVEL';
    end if;
    if not can_manage_booking(p_business, v_prof) then raise exception 'SEM_PERMISSAO'; end if;

    if exists (select 1 from jsonb_array_elements_text(v_visit->'service_ids') x where x !~* '^[0-9a-f-]{36}$')
       or (select count(distinct x) <> count(*) from jsonb_array_elements_text(v_visit->'service_ids') x)
       or exists (select 1 from jsonb_array_elements_text(v_visit->'service_ids') x where not (v_saldo ? x)) then
      raise exception 'SERVICOS_INVALIDOS';
    end if;
    if exists (select 1 from jsonb_array_elements_text(v_visit->'service_ids') x
                where not professional_does_service(v_prof, x::uuid)) then
      raise exception 'PROFISSIONAL_NAO_FAZ';
    end if;

    for v_sid in select x from jsonb_array_elements_text(v_visit->'service_ids') x loop
      v_used := jsonb_set(v_used, array[v_sid], to_jsonb(coalesce((v_used->>v_sid)::int, 0) + 1));
    end loop;
  end loop;

  -- nenhum serviço passa do saldo do pacote
  if exists (select 1 from jsonb_each_text(v_used) u where u.value::int > (v_saldo->>u.key)::int) then
    raise exception 'SALDO_EXCEDIDO';
  end if;

  for r in
    select (q.idx - 1)::int as vidx, coalesce((q.value->>'rule')::int, 0) as vrule,
           (q.value->>'date')::date as vday, (q.value->>'time')::time as vtime,
           (q.value->>'professional_id')::uuid as vprof,
           array(select x::uuid from jsonb_array_elements_text(q.value->'service_ids') x) as vsvc
      from jsonb_array_elements(p_visits) with ordinality q(value, idx)
     where jsonb_array_length(coalesce(q.value->'service_ids', '[]'::jsonb)) > 0
     order by (q.value->>'date')::date, (q.value->>'time')::time, q.idx
  loop
    -- na ordem do pacote: o primeiro é o serviço principal (item 0)
    select array_agg(i.service_id order by i.position), string_agg(s.name, ' + ' order by i.position),
           sum(s.duration_min)::int
      into v_ids, v_names, v_dur
      from package_template_items i join services s on s.id = i.service_id
     where i.template_id = p_template and i.service_id = any(r.vsvc);

    v_issue := null;
    if p_expires is not null and r.vday > p_expires then
      v_issue := 'PACOTE_VENCIDO';
    else
      v_issue := booking_slot_issue_except(p_business, r.vprof, v_ids[1], r.vday, r.vtime, null, v_dur, false);
    end if;

    if v_issue is null then
      v_range := tsrange(r.vday + r.vtime, r.vday + r.vtime + make_interval(mins => v_dur), '[)');
      -- a cliente não pode estar em duas visitas da venda ao mesmo tempo
      if exists (select 1 from unnest(v_taken) t(rg) where t.rg && v_range) then
        v_issue := 'OCUPADO_NA_VENDA';
      else
        v_taken := v_taken || v_range;
      end if;
    end if;

    idx := r.vidx; rule_idx := r.vrule; occurs_on := r.vday; start_time := r.vtime;
    professional_id := r.vprof; service_ids := v_ids; service_names := v_names;
    duration_min := v_dur; issue := v_issue;
    return next;
  end loop;
end;
$$;

revoke all on function package_plan_visits(uuid, uuid, date, jsonb) from public, anon, authenticated;


-- =====================================================================
-- PARTE 2 — Prévia (nada é gravado)
-- =====================================================================
create or replace function preview_package_sale_visits(p_customer uuid, p_template uuid, p_visits jsonb)
returns table (idx int, rule_idx int, occurs_on date, start_time time, professional_id uuid,
               service_ids uuid[], service_names text, duration_min int, issue text, package_expires date)
language plpgsql volatile security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_bid  uuid;
  v_exp  date;
  v_days int;
begin
  v_bid := check_package_sale(p_customer, p_template);
  select validity_days into v_days from package_templates where id = p_template;
  if v_days is not null then
    select (now() at time zone timezone)::date + v_days into v_exp from businesses where id = v_bid;
  end if;

  return query
  select d.idx, d.rule_idx, d.occurs_on, d.start_time, d.professional_id,
         d.service_ids, d.service_names, d.duration_min, d.issue, v_exp
    from package_plan_visits(v_bid, p_template, v_exp, p_visits) d;
end;
$$;

revoke all on function preview_package_sale_visits(uuid, uuid, jsonb) from public, anon;
grant execute on function preview_package_sale_visits(uuid, uuid, jsonb) to authenticated;


-- =====================================================================
-- PARTE 3 — Venda com as visitas escolhidas (pacote + caixa + visitas
-- na mesma transação). Mesmo corpo da sell_package_fixed (45), lendo as
-- visitas da PARTE 1. p_rules (as regras da tela) só guardam a série de
-- cada regra (booking_series); pode ser '[]'.
-- Devolve {package_id, created, skipped, dates: [{idx, rule, date, time,
--          services, issue, booking_id}]}
-- =====================================================================
create or replace function sell_package_fixed_visits(
  p_customer uuid, p_template uuid, p_method text, p_visits jsonb, p_rules jsonb default '[]'::jsonb
)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  c        customers;
  v_bid    uuid;
  v_pkg    uuid;
  v_exp    date;
  v_series uuid[] := '{}';
  v_sid    uuid;
  v_bk     uuid;
  v_issue  text;
  v_made   int := 0;
  v_skip   int := 0;
  v_dates  jsonb := '[]'::jsonb;
  v_endm   int;
  v_pos    int;
  v_rule   jsonb;
  v_i      int;
  s0       services;
  p        professionals;
  sx       services;
  d        record;
begin
  v_bid := check_package_sale(p_customer, p_template);
  -- trava a cliente: duas vendas ao mesmo tempo esperam uma pela outra
  select * into c from customers where id = p_customer for update;

  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 10 then
    raise exception 'REGRAS_INVALIDAS';
  end if;

  -- visita inválida (package_plan_visits) desfaz tudo, inclusive o caixa
  v_pkg := sell_package_core(p_customer, p_template, p_method, 'fixed');
  select expires_at into v_exp from customer_packages where id = v_pkg;

  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if coalesce(v_rule->>'frequency', '') not in ('weekly', 'biweekly', 'monthly')
       or coalesce(v_rule->>'start_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_rule->>'time', '') !~ '^\d{2}:\d{2}$'
       or coalesce(v_rule->>'professional_id', '') !~* '^[0-9a-f-]{36}$'
       or coalesce(v_rule->>'count', '') !~ '^\d{1,2}$' then
      raise exception 'REGRAS_INVALIDAS';
    end if;
    insert into booking_series (business_id, professional_id, service_id, customer_package_id,
                                frequency, start_date, start_time, occurrences, created_by, service_ids)
    values (v_bid, (v_rule->>'professional_id')::uuid, (v_rule->'service_ids'->>0)::uuid, v_pkg,
            v_rule->>'frequency', (v_rule->>'start_date')::date, (v_rule->>'time')::time,
            least(greatest((v_rule->>'count')::int, 1), 52), auth.uid(),
            array(select x::uuid from jsonb_array_elements_text(coalesce(v_rule->'service_ids', '[]'::jsonb)) x))
    returning id into v_sid;
    v_series := v_series || v_sid;
  end loop;

  for d in select * from package_plan_visits(v_bid, p_template, v_exp, p_visits) loop
    v_bk := null;
    v_issue := d.issue;

    if v_issue is null then
      begin
        select * into s0 from services where id = d.service_ids[1];
        select * into p from professionals where id = d.professional_id;
        v_endm := extract(hour from d.start_time)::int * 60 + extract(minute from d.start_time)::int + s0.duration_min;

        insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
                              professional_name, customer_name, customer_phone, customer_phone_country,
                              booking_date, start_time, end_time, status, source,
                              customer_package_id, series_id)
        values (v_bid, s0.id, p.id, s0.name, s0.price, s0.duration_min,
                p.name, c.name, c.phone, c.phone_country,
                d.occurs_on, d.start_time, make_time(v_endm / 60 % 24, v_endm % 60, 0), 'confirmed', 'manual',
                v_pkg, v_series[d.rule_idx + 1])
        returning id into v_bk;

        -- adicionais da mesma visita, pagos pelo pacote (estende o horário)
        if array_length(d.service_ids, 1) > 1 then
          v_pos := 0;
          for v_i in 2 .. array_length(d.service_ids, 1) loop
            select * into sx from services where id = d.service_ids[v_i];
            v_pos := v_pos + 1;
            insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                                       position, extends_time, paid_by_package, added_by, customer_package_item_id)
            values (v_bk, v_bid, sx.id, sx.name, sx.price, sx.duration_min,
                    v_pos, true, true, auth.uid(),
                    (select id from customer_package_items
                      where customer_package_id = v_pkg and service_id = sx.id order by position limit 1));
          end loop;
          perform recalc_booking(v_bk);
        end if;
        v_made := v_made + 1;
      exception
        when exclusion_violation then v_bk := null; v_issue := 'OCUPADO';
        when others then
          v_bk := null;
          v_issue := case when sqlerrm like 'PACOTE_%' or sqlerrm in ('MEIA_NOITE')
                          then split_part(sqlerrm, ' ', 1) else 'RECUSADO' end;
      end;
    end if;

    if v_bk is null then v_skip := v_skip + 1; end if;
    v_dates := v_dates || jsonb_build_object(
      'idx', d.idx, 'rule', d.rule_idx, 'date', d.occurs_on, 'time', to_char(d.start_time, 'HH24:MI'),
      'services', d.service_names, 'issue', v_issue, 'booking_id', v_bk);
  end loop;

  -- série sem nenhuma visita não fica guardada
  delete from booking_series bs
   where bs.id = any(v_series)
     and not exists (select 1 from bookings b where b.series_id = bs.id);

  return json_build_object('package_id', v_pkg, 'created', v_made, 'skipped', v_skip, 'dates', v_dates);
end;
$$;

revoke all on function sell_package_fixed_visits(uuid, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function sell_package_fixed_visits(uuid, uuid, text, jsonb, jsonb) to authenticated;


-- =====================================================================
-- PARTE 4 — Serviços do pacote numa data já marcada (leitura)
-- null = o agendamento não é sessão de pacote.
-- items[]: serviços do pacote, com o total, o usado FORA desta data,
--          se está marcado nesta data, se o profissional faz e se é o principal.
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO
-- =====================================================================
create or replace function package_visit_options(p_booking uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  bk bookings;
  cp customer_packages;
begin
  select * into bk from bookings where id = p_booking;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.customer_package_id is null then return null; end if;

  select * into cp from customer_packages where id = bk.customer_package_id;

  return json_build_object(
    'package_id',   cp.id,
    'package_name', cp.name,
    'expires_at',   cp.expires_at,
    'status',       cp.status,
    'editable',     bk.status in ('pending', 'confirmed') and cp.status = 'active'
                    and (cp.expires_at is null or bk.booking_date <= cp.expires_at),
    'items', coalesce((
      select json_agg(json_build_object(
               'package_item_id', pi.id,
               'service_id',      pi.service_id,
               'service_name',    pi.service_name,
               'sessions_total',  pi.sessions_total,
               'used_elsewhere',  package_item_used(pi.id, bk.id),
               'marked',          exists (select 1 from booking_items i
                                           where i.booking_id = bk.id and i.customer_package_item_id = pi.id),
               'main',            exists (select 1 from booking_items i
                                           where i.booking_id = bk.id and i.position = 0
                                             and i.customer_package_item_id = pi.id),
               'can_do',          pi.service_id is not null and professional_does_service(bk.professional_id, pi.service_id))
               order by pi.position)
        from customer_package_items pi
       where pi.customer_package_id = cp.id
    ), '[]'::json)
  );
end;
$$;

revoke all on function package_visit_options(uuid) from public, anon;
grant execute on function package_visit_options(uuid) to authenticated;


-- =====================================================================
-- PARTE 5 — Marcar/desmarcar os serviços do pacote numa data já marcada
-- p_service_ids = serviços DO PACOTE desta sessão que serão feitos nesta
-- data (1 ou mais). Adicionais cobrados (fora do pacote) não mudam.
-- Quem: matriz, recepção e o profissional da própria data (can_manage_booking).
-- Se o principal (item 0) for desmarcado, o primeiro serviço marcado (na
-- ordem do pacote) vira o principal. Tempo: soma dos serviços; se aumentar,
-- confere bloqueio e ocupado no trecho novo; meia-noite pelo recalc.
-- Saldo e validade: gatilhos da 37 (validate_booking_item_package).
-- Erros: NAO_ENCONTRADO | SEM_PERMISSAO | STATUS_INVALIDO | NAO_E_PACOTE
--        SERVICOS_VAZIOS | SERVICOS_INVALIDOS | PROFISSIONAL_NAO_FAZ | LIMITE_ITENS
--        BLOQUEIO | OCUPADO | MEIA_NOITE | PACOTE_INVALIDO | PACOTE_VENCIDO | PACOTE_SEM_SALDO
-- =====================================================================
create or replace function package_visit_set_services(p_booking uuid, p_service_ids uuid[])
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  bk       bookings;
  cp       customer_packages;
  it0      booking_items;
  s        services;
  v_before text;
  v_after  text;
  v_want   uuid[];
  v_new0   uuid;
  v_pi     uuid;
  v_pos    int;
  v_endm   int;
  v_oldend time;
  v_sid    uuid;
begin
  select * into bk from bookings where id = p_booking for update;
  if not found then raise exception 'NAO_ENCONTRADO'; end if;
  if not can_manage_booking(bk.business_id, bk.professional_id) then raise exception 'SEM_PERMISSAO'; end if;
  if bk.status not in ('pending', 'confirmed') then raise exception 'STATUS_INVALIDO'; end if;
  if bk.customer_package_id is null then raise exception 'NAO_E_PACOTE'; end if;

  select * into cp from customer_packages where id = bk.customer_package_id for update;
  if cp.status <> 'active' then raise exception 'PACOTE_INVALIDO'; end if;
  if cp.expires_at is not null and bk.booking_date > cp.expires_at then raise exception 'PACOTE_VENCIDO'; end if;

  if p_service_ids is null or coalesce(array_length(p_service_ids, 1), 0) = 0 then raise exception 'SERVICOS_VAZIOS'; end if;
  if (select count(distinct x) <> count(*) from unnest(p_service_ids) x)
     or exists (select 1 from unnest(p_service_ids) x
                 where not exists (select 1 from customer_package_items pi
                                    where pi.customer_package_id = cp.id and pi.service_id = x)) then
    raise exception 'SERVICOS_INVALIDOS';
  end if;
  if exists (select 1 from unnest(p_service_ids) x where not professional_does_service(bk.professional_id, x)) then
    raise exception 'PROFISSIONAL_NAO_FAZ';
  end if;

  -- na ordem do pacote
  select array_agg(pi.service_id order by pi.position) into v_want
    from customer_package_items pi
   where pi.customer_package_id = cp.id and pi.service_id = any(p_service_ids);

  select string_agg(service_name, ' + ' order by position) into v_before from booking_items where booking_id = bk.id;
  v_oldend := bk.end_time;
  select * into it0 from booking_items where booking_id = bk.id and position = 0;

  -- 1) sai: serviços deste pacote desmarcados (menos o item 0, tratado abaixo)
  delete from booking_items i
   using customer_package_items pi
   where i.booking_id = bk.id and i.position > 0
     and pi.id = i.customer_package_item_id and pi.customer_package_id = cp.id
     and not (pi.service_id = any(v_want));

  -- 2) principal desmarcado: o primeiro serviço marcado vira o item 0
  if not (it0.service_id = any(v_want)) then
    v_new0 := v_want[1];
    -- se ele já estava como adicional desta data, sai de lá e sobe para o item 0
    delete from booking_items i
     using customer_package_items pi
     where i.booking_id = bk.id and i.position > 0
       and pi.id = i.customer_package_item_id and pi.customer_package_id = cp.id
       and pi.service_id = v_new0;

    select * into s from services where id = v_new0;
    if not found then raise exception 'SERVICOS_INVALIDOS'; end if;
    select id into v_pi from customer_package_items
     where customer_package_id = cp.id and service_id = v_new0 order by position limit 1;

    update booking_items
       set service_id = s.id, service_name = s.name, price = s.price, duration_min = s.duration_min,
           extends_time = true, combo_group = null, combo_name = null,
           customer_package_item_id = v_pi, paid_by_package = true
     where id = it0.id;

    perform set_config('genix.booking_edit', '1', true);
    update bookings set service_id = s.id where id = bk.id;
  end if;

  -- 3) entra: serviços marcados que ainda não estão nesta data
  foreach v_sid in array v_want loop
    if not exists (select 1 from booking_items i
                     join customer_package_items pi on pi.id = i.customer_package_item_id
                    where i.booking_id = bk.id and pi.customer_package_id = cp.id and pi.service_id = v_sid) then
      if (select count(*) from booking_items where booking_id = bk.id) >= 10 then raise exception 'LIMITE_ITENS'; end if;
      select * into s from services where id = v_sid;
      if not found then raise exception 'SERVICOS_INVALIDOS'; end if;
      select coalesce(max(position), 0) + 1 into v_pos from booking_items where booking_id = bk.id;
      insert into booking_items (booking_id, business_id, service_id, service_name, price, duration_min,
                                 position, extends_time, paid_by_package, added_by, customer_package_item_id)
      values (bk.id, bk.business_id, s.id, s.name, s.price, s.duration_min,
              v_pos, true, true, auth.uid(),
              (select id from customer_package_items
                where customer_package_id = cp.id and service_id = s.id order by position limit 1));
    end if;
  end loop;

  -- 4) tempo: se aumentou, o trecho novo precisa estar livre
  select extract(hour from bk.start_time)::int * 60 + extract(minute from bk.start_time)::int
         + coalesce(sum(duration_min) filter (where position = 0 or extends_time), 0)::int
    into v_endm from booking_items where booking_id = bk.id;
  if v_endm >= 24 * 60 then raise exception 'MEIA_NOITE'; end if;
  if make_time(v_endm / 60, v_endm % 60, 0) > v_oldend then
    if slot_conflicts_block(bk.business_id, bk.professional_id, bk.booking_date, v_oldend, make_time(v_endm / 60, v_endm % 60, 0)) then
      raise exception 'BLOQUEIO';
    end if;
    if exists (
      select 1 from bookings o
       where o.professional_id = bk.professional_id
         and o.status in ('pending', 'confirmed')
         and o.id <> bk.id
         and o.period && tsrange(bk.booking_date + v_oldend, bk.booking_date + make_time(v_endm / 60, v_endm % 60, 0), '[)')
    ) then
      raise exception 'OCUPADO';
    end if;
  end if;

  begin
    perform recalc_booking(bk.id);
  exception
    when exclusion_violation then raise exception 'OCUPADO';
  end;

  select string_agg(service_name, ' + ' order by position) into v_after from booking_items where booking_id = bk.id;
  if v_after is distinct from v_before then
    insert into booking_events (booking_id, business_id, action, actor_id, actor_role, details)
    values (bk.id, bk.business_id, 'package_services', auth.uid(), coalesce(member_role_of(bk.business_id), 'sistema'),
            jsonb_build_object('before', v_before, 'after', v_after, 'package', cp.name));
  end if;

  return json_build_object('ok', true, 'services', v_after);
end;
$$;

revoke all on function package_visit_set_services(uuid, uuid[]) from public, anon;
grant execute on function package_visit_set_services(uuid, uuid[]) to authenticated;

commit;

-- Conferência
select proname from pg_proc
 where proname in ('package_plan_visits', 'preview_package_sale_visits', 'sell_package_fixed_visits',
                   'package_visit_options', 'package_visit_set_services')
 order by 1;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; pacotes e visitas já criados
-- continuam válidos — são as mesmas tabelas da 37/39)
-- =====================================================================
-- begin;
-- drop function if exists package_visit_set_services(uuid, uuid[]);
-- drop function if exists package_visit_options(uuid);
-- drop function if exists sell_package_fixed_visits(uuid, uuid, text, jsonb, jsonb);
-- drop function if exists preview_package_sale_visits(uuid, uuid, jsonb);
-- drop function if exists package_plan_visits(uuid, uuid, date, jsonb);
-- commit;
