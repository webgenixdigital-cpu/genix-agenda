-- =====================================================================
-- GENIX AGENDA — N4.3 PR B: venda de pacote com DATAS FIXAS
-- O dono monta regras (profissional, serviços, 1ª data, horário,
-- frequência, quantidade), vê a prévia e vende: o pacote e as visitas
-- nascem juntos (customer_packages.schedule_mode = 'fixed').
-- Uma regra pode juntar serviços na mesma visita (manicure + pedicure às
-- 14h = 1 agendamento: item 0 + adicional, ambos pagos pelo pacote); o
-- conflito é conferido pela duração total. Quando o saldo de um serviço
-- acaba, as datas seguintes saem só com os demais. Data com conflito é
-- pulada e a sessão fica livre no saldo ("sem data" na ficha).
-- Remarcar/cancelar a visita já move/devolve todos os itens juntos
-- (reschedule_booking e package_item_used, 31/37) — nada muda aqui.
--
-- ORDEM: supabase/manual/39a_backup.sql → ESTE ARQUIVO →
--        supabase/manual/39b_conferencia.sql (uma consulta por vez).
-- Rode inteira de uma vez, ANTES do merge (só acrescenta; o código atual
-- continua funcionando). Tudo dentro de begin/commit. Reversão no final.
-- Datas e "passado" no fuso do espaço (businesses.timezone).
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Série guarda os serviços da regra
-- =====================================================================
alter table booking_series add column if not exists service_ids uuid[];


-- =====================================================================
-- PARTE 2 — Conferência da venda (papel, plano, modelo, cliente)
-- Devolve o espaço. Erros: MODELO_INVALIDO | SEM_PERMISSAO | PLANO_GRATIS | CLIENTE_INVALIDO
-- =====================================================================
create or replace function check_package_sale(p_customer uuid, p_template uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  t package_templates;
begin
  select * into t from package_templates where id = p_template;
  if not found or not t.active then raise exception 'MODELO_INVALIDO'; end if;
  if coalesce(member_role_of(t.business_id) in ('owner', 'reception'), false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if access_tier(t.business_id) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
  if not exists (select 1 from customers where id = p_customer and business_id = t.business_id) then
    raise exception 'CLIENTE_INVALIDO';
  end if;
  return t.business_id;
end;
$$;

revoke all on function check_package_sale(uuid, uuid) from public, anon, authenticated;


-- =====================================================================
-- PARTE 3 — Datas da venda (regra única da prévia e da venda)
-- p_rules = [{"professional_id", "service_ids": [...], "start_date": "AAAA-MM-DD",
--             "time": "HH:MM", "frequency": "weekly|biweekly|monthly", "count": 1..52}]
-- Saldo simulado por serviço do modelo, consumido em ordem de data/hora
-- (entre todas as regras). Em cada data entram os serviços da regra que
-- ainda têm saldo, na ordem marcada; o primeiro é o item 0.
-- issue: null (ok) | SEM_SALDO | PACOTE_VENCIDO | OCUPADO_NA_VENDA | motivos de
--        booking_slot_issue_except (PASSADO, FECHADO, FORA_EXPEDIENTE, BLOQUEIO, OCUPADO...)
-- Erros: REGRAS_INVALIDAS | FREQUENCIA_INVALIDA | QUANTIDADE_INVALIDA | DADOS_INVALIDOS
--        SERVICOS_INVALIDOS | PROFISSIONAL_INDISPONIVEL | PROFISSIONAL_NAO_FAZ | SEM_PERMISSAO
-- =====================================================================
create or replace function package_plan_dates(p_business uuid, p_template uuid, p_expires date, p_rules jsonb)
returns table (rule_idx int, seq int, occurs_on date, start_time time, professional_id uuid,
               service_ids uuid[], service_names text, duration_min int, issue text)
language plpgsql volatile security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_total  int;
  v_sum    int := 0;
  v_saldo  jsonb := '{}'::jsonb;
  v_taken  tsrange[] := '{}';
  v_ids    uuid[];
  v_names  text;
  v_dur    int;
  v_issue  text;
  v_range  tsrange;
  v_sid    uuid;
  v_prof   uuid;
  v_rule   jsonb;
  r        record;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array'
     or jsonb_array_length(p_rules) < 1 or jsonb_array_length(p_rules) > 10 then
    raise exception 'REGRAS_INVALIDAS';
  end if;

  select coalesce(sum(i.sessions), 0), coalesce(jsonb_object_agg(i.service_id::text, i.sessions), '{}'::jsonb)
    into v_total, v_saldo
    from package_template_items i where i.template_id = p_template;

  -- confere cada regra
  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if coalesce(v_rule->>'frequency', '') not in ('weekly', 'biweekly', 'monthly') then raise exception 'FREQUENCIA_INVALIDA'; end if;
    if coalesce(v_rule->>'count', '') !~ '^\d{1,2}$' or (v_rule->>'count')::int not between 1 and 52 then
      raise exception 'QUANTIDADE_INVALIDA';
    end if;
    v_sum := v_sum + (v_rule->>'count')::int;
    if coalesce(v_rule->>'time', '') !~ '^\d{2}:\d{2}$'
       or coalesce(v_rule->>'start_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_rule->>'professional_id', '') !~* '^[0-9a-f-]{36}$' then
      raise exception 'DADOS_INVALIDOS';
    end if;
    v_prof := (v_rule->>'professional_id')::uuid;
    if not exists (select 1 from professionals p where p.id = v_prof and p.business_id = p_business and p.active) then
      raise exception 'PROFISSIONAL_INDISPONIVEL';
    end if;
    if not can_manage_booking(p_business, v_prof) then raise exception 'SEM_PERMISSAO'; end if;

    if jsonb_typeof(v_rule->'service_ids') <> 'array' or jsonb_array_length(v_rule->'service_ids') < 1 then
      raise exception 'SERVICOS_INVALIDOS';
    end if;
    if (select count(*) from jsonb_array_elements_text(v_rule->'service_ids') x
         where x !~* '^[0-9a-f-]{36}$') > 0 then
      raise exception 'SERVICOS_INVALIDOS';
    end if;
    if (select count(distinct x) <> count(*) from jsonb_array_elements_text(v_rule->'service_ids') x)
       or exists (select 1 from jsonb_array_elements_text(v_rule->'service_ids') x
                   where not (v_saldo ? x)) then
      raise exception 'SERVICOS_INVALIDOS';
    end if;
    if exists (select 1 from jsonb_array_elements_text(v_rule->'service_ids') x
                where not professional_does_service(v_prof, x::uuid)) then
      raise exception 'PROFISSIONAL_NAO_FAZ';
    end if;
  end loop;

  -- teto: visitas da venda ≤ sessões do pacote (máx. 100)
  if v_sum > least(v_total, 100) then raise exception 'QUANTIDADE_INVALIDA'; end if;

  for r in
    select (q.idx - 1)::int as ridx, d.seq as dseq, d.occurs_on as dday,
           (q.value->>'time')::time as dtime, (q.value->>'professional_id')::uuid as dprof,
           array(select x::uuid from jsonb_array_elements_text(q.value->'service_ids') with ordinality e(x, o) order by o) as dsvc
      from jsonb_array_elements(p_rules) with ordinality q(value, idx)
     cross join lateral series_dates(q.value->>'frequency', (q.value->>'start_date')::date, (q.value->>'count')::int) d
     order by d.occurs_on, (q.value->>'time')::time, q.idx, d.seq
  loop
    v_ids := array(select s from unnest(r.dsvc) with ordinality u(s, o)
                    where coalesce((v_saldo->>(s::text))::int, 0) > 0 order by o);
    v_issue := null;
    v_names := null;
    v_dur := null;

    if coalesce(array_length(v_ids, 1), 0) = 0 then
      v_issue := 'SEM_SALDO';
    else
      select string_agg(s.name, ' + ' order by u.o), sum(s.duration_min)::int
        into v_names, v_dur
        from unnest(v_ids) with ordinality u(sid, o) join services s on s.id = u.sid;

      if p_expires is not null and r.dday > p_expires then
        v_issue := 'PACOTE_VENCIDO';
      else
        v_issue := booking_slot_issue_except(p_business, r.dprof, v_ids[1], r.dday, r.dtime, null, v_dur, false);
      end if;

      if v_issue is null then
        v_range := tsrange(r.dday + r.dtime, r.dday + r.dtime + make_interval(mins => v_dur), '[)');
        if exists (select 1 from unnest(v_taken) t(rg) where t.rg && v_range) then
          v_issue := 'OCUPADO_NA_VENDA';
        end if;
      end if;

      if v_issue is null then
        -- a cliente não pode estar em duas visitas da venda ao mesmo tempo
        v_taken := v_taken || v_range;
        foreach v_sid in array v_ids loop
          v_saldo := jsonb_set(v_saldo, array[v_sid::text], to_jsonb((v_saldo->>(v_sid::text))::int - 1));
        end loop;
      end if;
    end if;

    rule_idx := r.ridx; seq := r.dseq; occurs_on := r.dday; start_time := r.dtime;
    professional_id := r.dprof; service_ids := v_ids; service_names := v_names;
    duration_min := v_dur; issue := v_issue;
    return next;
  end loop;
end;
$$;

revoke all on function package_plan_dates(uuid, uuid, date, jsonb) from public, anon, authenticated;


-- =====================================================================
-- PARTE 4 — Venda: corpo único (versão da 37) com o modo e o "hoje" no
-- fuso do espaço. sell_package (PR A) continua com a mesma assinatura.
-- =====================================================================
create or replace function sell_package_core(p_customer uuid, p_template uuid, p_method text, p_mode text)
returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  t       package_templates;
  c       customers;
  v_cash  uuid;
  v_id    uuid;
  v_today date;
  v_n     int;
  v_total int;
  v_wsum  numeric;
  v_names text;
  v_i     int := 0;
  v_acc   numeric := 0;
  v_val   numeric;
  r       record;
begin
  if p_mode not in ('free', 'fixed') then raise exception 'DADOS_INVALIDOS'; end if;
  perform check_package_sale(p_customer, p_template);
  select * into t from package_templates where id = p_template;
  select * into c from customers where id = p_customer;
  select (now() at time zone timezone)::date into v_today from businesses where id = t.business_id;

  select count(*), coalesce(sum(i.sessions), 0), coalesce(sum(s.price * i.sessions), 0),
         string_agg(s.name, ' + ' order by i.position, s.name)
    into v_n, v_total, v_wsum, v_names
    from package_template_items i join services s on s.id = i.service_id
   where i.template_id = t.id;
  if v_n = 0 or v_total < 1 or v_total > 100 then raise exception 'MODELO_INVALIDO'; end if;

  if t.price > 0 then
    if p_method is null or p_method not in ('pix', 'dinheiro', 'credito', 'debito') then
      raise exception 'FORMA_INVALIDA';
    end if;
    insert into cash_entries (business_id, kind, category, method, description, amount, entry_date, created_by)
    values (t.business_id, 'income', 'pacote', p_method::payment_method,
            'Pacote ' || t.name || ' — ' || c.name, t.price, v_today, auth.uid())
    returning id into v_cash;
  end if;

  insert into customer_packages (business_id, customer_id, template_id, service_id, service_name, name,
                                 sessions_total, price, expires_at, cash_entry_id, created_by, schedule_mode)
  values (t.business_id, c.id, t.id, case when v_n = 1 then t.service_id end, v_names, t.name,
          v_total, t.price,
          case when t.validity_days is null then null else v_today + t.validity_days end,
          v_cash, auth.uid(), p_mode)
  returning id into v_id;

  for r in
    select s.id, s.name, s.price, i.sessions
      from package_template_items i join services s on s.id = i.service_id
     where i.template_id = t.id
     order by i.position, s.name
  loop
    v_i := v_i + 1;
    v_val := case
               when v_i = v_n    then t.price - v_acc
               when v_wsum > 0   then round(t.price * r.price * r.sessions / v_wsum, 2)
               else round(t.price * r.sessions / v_total, 2)
             end;
    v_val := greatest(v_val, 0);
    v_acc := v_acc + v_val;
    insert into customer_package_items (customer_package_id, business_id, service_id, service_name,
                                        sessions_total, value_total, position)
    values (v_id, t.business_id, r.id, r.name, r.sessions, v_val, (v_i - 1)::smallint);
  end loop;

  return v_id;
end;
$$;

revoke all on function sell_package_core(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function sell_package(p_customer uuid, p_template uuid, p_method text)
returns uuid
language sql volatile security definer set search_path = public
as $$
  select sell_package_core(p_customer, p_template, p_method, 'free');
$$;
-- (mantém as permissões da 19)


-- =====================================================================
-- PARTE 5 — Prévia (nada é gravado)
-- =====================================================================
create or replace function preview_package_sale(p_customer uuid, p_template uuid, p_rules jsonb)
returns table (rule_idx int, seq int, occurs_on date, start_time time, professional_id uuid,
               service_ids uuid[], service_names text, duration_min int, issue text, package_expires date)
language plpgsql volatile security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_bid   uuid;
  v_exp   date;
  v_days  int;
begin
  v_bid := check_package_sale(p_customer, p_template);
  select validity_days into v_days from package_templates where id = p_template;
  if v_days is not null then
    select (now() at time zone timezone)::date + v_days into v_exp from businesses where id = v_bid;
  end if;

  return query
  select d.rule_idx, d.seq, d.occurs_on, d.start_time, d.professional_id,
         d.service_ids, d.service_names, d.duration_min, d.issue, v_exp
    from package_plan_dates(v_bid, p_template, v_exp, p_rules) d;
end;
$$;

revoke all on function preview_package_sale(uuid, uuid, jsonb) from public, anon;
grant execute on function preview_package_sale(uuid, uuid, jsonb) to authenticated;


-- =====================================================================
-- PARTE 6 — Venda com datas fixas (pacote + visitas na mesma transação)
-- As datas são recalculadas aqui (a agenda pode ter mudado depois da
-- prévia). Data que não deu certo é pulada: a sessão fica livre.
-- Devolve {package_id, created, skipped, dates: [{rule, seq, date, time,
--          services, issue, booking_id}]}
-- =====================================================================
create or replace function sell_package_fixed(p_customer uuid, p_template uuid, p_method text, p_rules jsonb)
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
  v_i      int := 0;
  s0       services;
  p        professionals;
  sx       services;
  d        record;
begin
  v_bid := check_package_sale(p_customer, p_template);
  -- trava a cliente: duas vendas ao mesmo tempo esperam uma pela outra
  select * into c from customers where id = p_customer for update;

  -- regra inválida (package_plan_dates) desfaz tudo, inclusive o caixa
  v_pkg := sell_package_core(p_customer, p_template, p_method, 'fixed');
  select expires_at into v_exp from customer_packages where id = v_pkg;

  for v_rule in select value from jsonb_array_elements(p_rules) loop
    insert into booking_series (business_id, professional_id, service_id, customer_package_id,
                                frequency, start_date, start_time, occurrences, created_by, service_ids)
    values (v_bid, (v_rule->>'professional_id')::uuid, (v_rule->'service_ids'->>0)::uuid, v_pkg,
            v_rule->>'frequency', (v_rule->>'start_date')::date, (v_rule->>'time')::time,
            least(greatest((v_rule->>'count')::int, 1), 52), auth.uid(),
            array(select x::uuid from jsonb_array_elements_text(v_rule->'service_ids') x))
    returning id into v_sid;
    v_series := v_series || v_sid;
  end loop;

  for d in select * from package_plan_dates(v_bid, p_template, v_exp, p_rules) loop
    v_bk := null;
    v_issue := d.issue;

    if v_issue is null then
      begin
        select * into s0 from services where id = d.service_ids[1];
        select * into p from professionals where id = d.professional_id;
        v_endm := extract(hour from d.start_time)::int * 60 + extract(minute from d.start_time)::int + s0.duration_min;

        insert into bookings (business_id, service_id, professional_id, service_name, price, duration_min,
                              professional_name, customer_name, customer_phone,
                              booking_date, start_time, end_time, status, source,
                              customer_package_id, series_id)
        values (v_bid, s0.id, p.id, s0.name, s0.price, s0.duration_min,
                p.name, c.name, c.phone,
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
      'rule', d.rule_idx, 'seq', d.seq, 'date', d.occurs_on, 'time', to_char(d.start_time, 'HH24:MI'),
      'services', d.service_names, 'issue', v_issue, 'booking_id', v_bk);
  end loop;

  -- série sem nenhuma visita não fica guardada
  delete from booking_series bs
   where bs.id = any(v_series)
     and not exists (select 1 from bookings b where b.series_id = bs.id);

  return json_build_object('package_id', v_pkg, 'created', v_made, 'skipped', v_skip, 'dates', v_dates);
end;
$$;

revoke all on function sell_package_fixed(uuid, uuid, text, jsonb) from public, anon;
grant execute on function sell_package_fixed(uuid, uuid, text, jsonb) to authenticated;

commit;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; pacotes já vendidos com datas
-- fixas continuam válidos como pacotes comuns)
-- =====================================================================
-- begin;
-- drop function if exists sell_package_fixed(uuid, uuid, text, jsonb);
-- drop function if exists preview_package_sale(uuid, uuid, jsonb);
-- drop function if exists package_plan_dates(uuid, uuid, date, jsonb);
-- (recriar sell_package com o corpo da PARTE 6 da 37_plano_fechado antes do drop abaixo)
-- drop function if exists sell_package_core(uuid, uuid, text, text);
-- drop function if exists check_package_sale(uuid, uuid);
-- alter table booking_series drop column if exists service_ids;
-- commit;
