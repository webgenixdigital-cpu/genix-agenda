-- =====================================================================
-- GENIX AGENDA — Lembrete automático com intervalo VARIÁVEL entre envios
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta; nenhuma
-- função muda de assinatura e o código atual continua funcionando).
-- Reversão comentada no final.
--
-- O que muda:
--   • whatsapp_instances.next_send_at (null = pode enviar).
--   • finish_auto_reminder: quando o envio sai (ENVIADO) ou falha
--     (FALHOU), sorteia o próximo horário livre do número:
--     now() + 7 a 13 min + 0 a 59 s. Grava na instância do espaço e em
--     todas as instâncias com o mesmo phone_number.
--     DESCONECTADO não sorteia (a reserva é desfeita, como hoje).
--   • next_auto_reminder: no lugar dos "10 min desde o último envio",
--     espera now() >= o maior next_send_at entre as instâncias do número.
--     Fica um piso de segurança de 7 min (o mínimo do sorteio) desde o
--     último registro do número: cobre reserva cujo resultado nunca foi
--     gravado, instâncias ainda sem next_send_at e dois espaços com o
--     mesmo número enquanto um envio está em andamento.
--   • genix_whatsapp_overview devolve next_send_at (painel /genix).
-- Regras que NÃO mudam: no máx. 6/hora por número (falhas contam), janela
-- 08:00–20:00 no fuso do espaço, só 'confirmed', liberação da Genix,
-- plano pago, opt-out, rodízio A → B → C.
--
-- Para o sorteio valer minuto a minuto, o relógio passa a rodar a cada
-- minuto: supabase/manual/whatsapp-cron-1min.sql (DEPOIS do deploy).
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Coluna nova
-- (a tabela só tem grant para service_role; nada muda nas permissões)
-- =====================================================================
alter table whatsapp_instances add column if not exists next_send_at timestamptz;


-- =====================================================================
-- PARTE 2 — Resultado do envio (mesmo corpo da 33 + sorteio do intervalo)
-- =====================================================================
create or replace function finish_auto_reminder(
  p_send uuid, p_ok boolean, p_reason text default null, p_retryable boolean default false, p_message_id text default null
)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  s       whatsapp_reminder_sends;
  v_phone text;
  v_next  timestamptz;
begin
  select * into s from whatsapp_reminder_sends where id = p_send for update;
  if not found or s.status <> 'sending' then return 'IGNORADO'; end if;

  if not p_ok and p_reason = 'DESCONECTADO' then
    delete from whatsapp_reminder_sends where id = s.id;
    return 'DESCONECTADO';
  end if;

  -- ENVIADO ou FALHOU: sorteia o próximo horário livre do número
  -- (7 a 13 min + 0 a 59 s), neste espaço e nos outros com o mesmo número
  v_next := now() + make_interval(mins => 7 + floor(random() * 7)::int,
                                  secs => floor(random() * 60)::int);
  select i.phone_number into v_phone from whatsapp_instances i where i.business_id = s.business_id;
  update whatsapp_instances
     set next_send_at = v_next
   where business_id = s.business_id
      or (v_phone is not null and phone_number = v_phone);

  if not p_ok then
    update whatsapp_reminder_sends
       set status = 'failed', reason = left(coalesce(p_reason, 'ERRO'), 200),
           retryable = coalesce(p_retryable, false) and s.attempt = 1, finished_at = now()
     where id = s.id;
    return 'FALHOU';
  end if;

  update whatsapp_reminder_sends
     set status = 'sent', sent_at = now(), finished_at = now(), provider_message_id = left(p_message_id, 200)
   where id = s.id;

  perform set_config('genix.actor_role', 'automatico', true);
  update bookings
     set reminder_sent_at = now()
   where id = s.booking_id and status = 'confirmed'
     and booking_date = s.booking_date and start_time = s.start_time
     and reminder_sent_at is null;
  if not found then
    update whatsapp_reminder_sends set reason = 'AGENDAMENTO_MUDOU' where id = s.id;
  end if;
  perform set_config('genix.actor_role', '', true);

  return 'ENVIADO';
end;
$$;


-- =====================================================================
-- PARTE 3 — Próximo lembrete (mesmo corpo da 33; ritmo sorteado)
-- =====================================================================
create or replace function next_auto_reminder(p_business uuid)
returns table (booking_id uuid, attempt smallint)
language plpgsql stable security definer set search_path = public
as $$
declare
  b     businesses;
  st    whatsapp_settings;
  inst  whatsapp_instances;
  v_now timestamp;
  v_today date;
begin
  select * into b from businesses where id = p_business;
  if not found then return; end if;
  select * into st from whatsapp_settings where business_id = b.id;
  if not found or not st.auto_enabled then return; end if;
  select * into inst from whatsapp_instances where business_id = b.id;
  if not found or not inst.genix_enabled then return; end if;
  if access_tier(b.id) <> 'completo' then return; end if;

  -- janela 08:00–20:00 no fuso do espaço
  v_now   := now() at time zone b.timezone;
  v_today := v_now::date;
  if v_now::time < time '08:00' or v_now::time >= time '20:00' then return; end if;

  -- ritmo POR NÚMERO (1): intervalo sorteado no último resultado.
  -- Vale o maior next_send_at entre este espaço e os outros com o mesmo número.
  if now() < (select coalesce(max(i2.next_send_at), '-infinity'::timestamptz)
                from whatsapp_instances i2
               where i2.business_id = b.id
                  or (inst.phone_number is not null and i2.phone_number = inst.phone_number)) then
    return;
  end if;

  -- ritmo POR NÚMERO (2): piso de 7 min desde a última reserva (o mínimo do
  -- sorteio) e no máx. 6 por hora (falhas contam)
  if exists (select 1 from whatsapp_reminder_sends s
              where s.created_at > now() - interval '7 minutes'
                and (s.business_id = b.id
                     or (inst.phone_number is not null and s.business_id in
                           (select i2.business_id from whatsapp_instances i2 where i2.phone_number = inst.phone_number)))) then
    return;
  end if;
  if (select count(*) from whatsapp_reminder_sends s
       where s.created_at > now() - interval '1 hour'
         and (s.business_id = b.id
              or (inst.phone_number is not null and s.business_id in
                    (select i2.business_id from whatsapp_instances i2 where i2.phone_number = inst.phone_number)))) >= 6 then
    return;
  end if;

  return query
  select bk.id, (case when a.n = 0 then 1 else 2 end)::smallint
    from bookings bk
    left join customers c on c.id = bk.customer_id
    cross join lateral (
      select count(*) as n,
             coalesce(bool_or(s.status in ('sending', 'sent')), false) as blocked,
             coalesce(bool_or(s.status = 'failed' and s.retryable
                              and s.created_at <= now() - interval '30 minutes'), false) as can_retry
        from whatsapp_reminder_sends s
       where s.booking_id = bk.id and s.booking_date = bk.booking_date and s.start_time = bk.start_time
    ) a
   where bk.business_id = b.id
     and bk.status = 'confirmed'
     and bk.reminder_sent_at is null
     and not coalesce(c.no_auto_reminders, false)
     and normalize_phone(bk.customer_phone) ~ '^\d{10,11}$'
     and ( bk.booking_date = v_today + 1
           or (bk.booking_date = v_today and bk.booking_date + bk.start_time >= v_now + interval '2 hours') )
     and ( a.n = 0 or (a.n = 1 and not a.blocked and a.can_retry) )
   order by bk.booking_date, bk.start_time
   limit 1;
end;
$$;


-- =====================================================================
-- PARTE 4 — Visão da Genix (/genix): ganha next_send_at
-- O tipo de retorno muda, então a função é recriada (corpo da 33 PARTE 8).
-- O código atual ignora a coluna a mais.
-- =====================================================================
drop function if exists genix_whatsapp_overview();
create function genix_whatsapp_overview()
returns table (
  business_id uuid, name text, slug text, tier text,
  has_credentials boolean, instance_hint text, genix_enabled boolean,
  status text, status_checked_at timestamptz, auto_enabled boolean,
  sent_7d bigint, failed_7d bigint, last_reason text,
  provider text, instance_name text, phone_number text,
  next_send_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_platform_admin() then raise exception 'SEM_PERMISSAO'; end if;
  return query
  select b.id, b.name, b.slug::text, access_tier(b.id),
         coalesce(whatsapp_has_credentials(i), false),
         case when i.instance_id is null then null else right(i.instance_id, 4) end,
         coalesce(i.genix_enabled, false),
         coalesce(i.status, 'unknown'),
         i.status_checked_at,
         coalesce(st.auto_enabled, false),
         (select count(*) from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'sent' and s.created_at > now() - interval '7 days'),
         (select count(*) from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'failed' and s.created_at > now() - interval '7 days'),
         (select s.reason from whatsapp_reminder_sends s
           where s.business_id = b.id and s.status = 'failed' order by s.created_at desc limit 1),
         i.provider,
         i.instance_name,
         i.phone_number,
         -- o maior entre as instâncias do mesmo número (é o que o relógio respeita)
         (select max(i2.next_send_at) from whatsapp_instances i2
           where i2.business_id = b.id
              or (i.phone_number is not null and i2.phone_number = i.phone_number))
    from businesses b
    left join whatsapp_instances i on i.business_id = b.id
    left join whatsapp_settings st on st.business_id = b.id
   where not coalesce(b.is_demo, false)
   order by (i.business_id is null), b.name;
end;
$$;


-- =====================================================================
-- PARTE 5 — Permissões
-- (create or replace mantém as permissões de finish/next_auto_reminder)
-- =====================================================================
revoke all on function genix_whatsapp_overview() from public, anon;
grant execute on function genix_whatsapp_overview() to authenticated;


-- =====================================================================
-- PARTE 6 — Conferência
-- 1) coluna nova; 2) as duas funções do relógio já usam next_send_at (true, true);
-- 3) funções do relógio só com postgres/service_role e a do /genix com
--    authenticated; 4) faixa do sorteio: mínimo ~00:07:00 e máximo ~00:13:59.
-- =====================================================================
select column_name, data_type from information_schema.columns
 where table_name = 'whatsapp_instances' and column_name = 'next_send_at';
select proname, pg_get_functiondef(oid) like '%next_send_at%' as usa_next_send_at
  from pg_proc where proname in ('finish_auto_reminder', 'next_auto_reminder', 'genix_whatsapp_overview');
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_name in ('claim_auto_reminder', 'finish_auto_reminder', 'next_auto_reminder',
                        'whatsapp_tick_candidates', 'genix_whatsapp_overview')
 order by routine_name, grantee;
select min(x) as menor, max(x) as maior
  from (select make_interval(mins => 7 + floor(random() * 7)::int, secs => floor(random() * 60)::int) as x
          from generate_series(1, 10000)) t;


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; ANTES, volte o relógio para
-- */5 — supabase/manual/whatsapp-cron-1min.sql, bloco VOLTAR — e o código
-- para a versão sem o "próximo envio" no /genix, com deploy)
-- 1) Cole e rode, de 33_whatsapp_evolution.sql, os blocos create or replace
--    das PARTES 3 (next_auto_reminder) e 6 (finish_auto_reminder).
-- 2) Depois, de 33_whatsapp_evolution.sql, a PARTE 8 inteira
--    (drop + create de genix_whatsapp_overview) e as duas linhas de
--    genix_whatsapp_overview da PARTE 9 (revoke/grant).
-- 3) Por fim:
-- alter table whatsapp_instances drop column if exists next_send_at;
-- =====================================================================
