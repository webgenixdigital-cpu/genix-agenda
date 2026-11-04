-- =====================================================================
-- GENIX AGENDA — Lembrete automático com 3 textos (A, B e C)
-- Pode rodar inteira de uma vez, ANTES do merge (só acrescenta; o código
-- atual continua funcionando: o texto C já fica gravado no banco, a função
-- de salvar com 2 textos continua e o aceite repetido segue aceito).
-- Reversão comentada no final.
--
-- O que muda:
--   • whatsapp_settings.template_c (texto C), preenchido com o padrão.
--   • next_variant cicla 0 → 1 → 2 → 0 (A → B → C → A).
--   • whatsapp_reminder_sends.variant aceita 0, 1 e 2.
--   • claim_auto_reminder devolve o texto C quando variant = 2.
--   • whatsapp_panel_status devolve template_c.
--   • save_whatsapp_templates ganha a versão com 3 textos.
--   • set_whatsapp_auto: quem já aceitou o risco religa sem aceitar de
--     novo; o registro do aceite original (quem e quando) é mantido.
-- Regras que NÃO mudam: ritmo (10 min, 6/hora por número), janela
-- 08:00–20:00, só 'confirmed', liberação da Genix, plano pago, opt-out.
-- =====================================================================


-- =====================================================================
-- PARTE 1 — Texto C
-- O padrão é idêntico a DEFAULT_TEMPLATE_C (src/lib/whatsapp/templates.ts).
-- Fica gravado (coluna com default + linhas existentes) para o código
-- antigo, que não conhece o padrão C, ter sempre um texto para enviar.
-- =====================================================================
alter table whatsapp_settings add column if not exists template_c text
  default E'{primeiro_nome}, seu horário está chegando ✨\n\n• {data}, às {hora}\n• {servico} com {profissional}\n\nEstamos te esperando! Se precisar remarcar ou surgir algum imprevisto, é só responder esta mensagem.\n{espaco}';

alter table whatsapp_settings drop constraint if exists whatsapp_settings_template_c_check;
alter table whatsapp_settings add constraint whatsapp_settings_template_c_check
  check (template_c is null or char_length(template_c) <= 1000);

update whatsapp_settings
   set template_c = E'{primeiro_nome}, seu horário está chegando ✨\n\n• {data}, às {hora}\n• {servico} com {profissional}\n\nEstamos te esperando! Se precisar remarcar ou surgir algum imprevisto, é só responder esta mensagem.\n{espaco}'
 where template_c is null;


-- =====================================================================
-- PARTE 2 — Variantes 0, 1 e 2
-- As checks da 23 foram criadas sem nome; o bloco acha e remove a check
-- de cada coluna, qualquer que seja o nome gerado.
-- =====================================================================
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and ( (c.conrelid = 'whatsapp_settings'::regclass
              and pg_get_constraintdef(c.oid) ilike '%next_variant%')
          or (c.conrelid = 'whatsapp_reminder_sends'::regclass
              and pg_get_constraintdef(c.oid) ~* '\mvariant\M') )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table whatsapp_settings add constraint whatsapp_settings_next_variant_check
  check (next_variant between 0 and 2);
alter table whatsapp_reminder_sends add constraint whatsapp_reminder_sends_variant_check
  check (variant between 0 and 2);


-- =====================================================================
-- PARTE 3 — Reserva (mesmo corpo da 33; rodízio de 3 textos)
-- =====================================================================
create or replace function claim_auto_reminder(p_business uuid)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_booking uuid;
  v_attempt smallint;
  bk        bookings;
  b         businesses;
  st        whatsapp_settings;
  inst      whatsapp_instances;
  v_id      uuid;
begin
  -- dois relógios ao mesmo tempo não reservam juntos
  if not pg_try_advisory_xact_lock(hashtext('whatsapp_reminder:' || p_business::text)) then return null; end if;

  select * into inst from whatsapp_instances
   where business_id = p_business and genix_enabled and status = 'connected';
  if not found then return null; end if;

  -- dois espaços com o mesmo número também não reservam juntos (ritmo por número)
  if inst.phone_number is not null
     and not pg_try_advisory_xact_lock(hashtext('whatsapp_number:' || inst.phone_number)) then
    return null;
  end if;

  select n.booking_id, n.attempt into v_booking, v_attempt from next_auto_reminder(p_business) n;
  if v_booking is null then return null; end if;

  select * into bk from bookings where id = v_booking;
  select * into b  from businesses where id = p_business;
  select * into st from whatsapp_settings where business_id = p_business for update;

  begin
    insert into whatsapp_reminder_sends (business_id, booking_id, booking_date, start_time, attempt, variant)
    values (p_business, bk.id, bk.booking_date, bk.start_time, v_attempt, st.next_variant)
    returning id into v_id;
  exception when unique_violation then
    return null;
  end;

  -- A → B → C → A
  update whatsapp_settings set next_variant = (next_variant + 1) % 3 where business_id = p_business;

  return json_build_object(
    'send_id',           v_id,
    'booking_id',        bk.id,
    'attempt',           v_attempt,
    'variant',           st.next_variant,
    'template',          case st.next_variant when 0 then st.template_a when 1 then st.template_b else st.template_c end,
    'phone',             normalize_phone(bk.customer_phone),
    'customer_name',     bk.customer_name,
    'service_name',      bk.service_name,
    'professional_name', bk.professional_name,
    'booking_date',      bk.booking_date,
    'start_time',        to_char(bk.start_time, 'HH24:MI'),
    'business_name',     b.name
  );
end;
$$;


-- =====================================================================
-- PARTE 4 — Painel do dono (mesmo corpo da 33 + template_c)
-- =====================================================================
create or replace function whatsapp_panel_status(p_business uuid)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  i  whatsapp_instances;
  st whatsapp_settings;
begin
  if coalesce(member_role_of(p_business) in ('owner', 'viewer'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  select * into i  from whatsapp_instances where business_id = p_business;
  select * into st from whatsapp_settings  where business_id = p_business;
  return json_build_object(
    'genix_enabled',     coalesce(i.genix_enabled, false) and coalesce(whatsapp_has_credentials(i), false),
    'released',          coalesce(i.genix_enabled, false),
    'provider',          i.provider,
    'has_instance',      coalesce(whatsapp_has_credentials(i), false),
    'phone_number',      i.phone_number,
    'status',            coalesce(i.status, 'unknown'),
    'status_checked_at', i.status_checked_at,
    'auto_enabled',      coalesce(st.auto_enabled, false),
    'risk_accepted_at',  st.risk_accepted_at,
    'template_a',        st.template_a,
    'template_b',        st.template_b,
    'template_c',        st.template_c
  );
end;
$$;


-- =====================================================================
-- PARTE 5 — Salvar os 3 textos (vazio = texto padrão)
-- Versão nova com 4 parâmetros e SEM default (não fica ambígua com a de
-- 3, que continua para o código atual e não mexe no texto C).
-- Erros: SEM_PERMISSAO | DADOS_INVALIDOS
-- =====================================================================
create or replace function save_whatsapp_templates(p_business uuid, p_a text, p_b text, p_c text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_a text := nullif(trim(coalesce(p_a, '')), '');
  v_b text := nullif(trim(coalesce(p_b, '')), '');
  v_c text := nullif(trim(coalesce(p_c, '')), '');
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;
  if char_length(coalesce(v_a, '')) > 1000 or char_length(coalesce(v_b, '')) > 1000
     or char_length(coalesce(v_c, '')) > 1000 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  insert into whatsapp_settings (business_id, template_a, template_b, template_c) values (p_business, v_a, v_b, v_c)
  on conflict (business_id) do update set template_a = v_a, template_b = v_b, template_c = v_c;
end;
$$;


-- =====================================================================
-- PARTE 6 — Liga/desliga (mesmo corpo da 23; aceite só na primeira vez)
-- O aceite continua obrigatório antes do primeiro "ligar". Quem já aceitou
-- religa sem aceitar de novo, e o registro original (quem/quando) fica.
-- Um novo aceite explícito (p_accept_risk = true) atualiza o registro.
-- Erros: SEM_PERMISSAO | PLANO_GRATIS | NAO_HABILITADO | ACEITE_OBRIGATORIO
-- =====================================================================
create or replace function set_whatsapp_auto(p_business uuid, p_enabled boolean, p_accept_risk boolean default false)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_accept boolean := coalesce(p_accept_risk, false);
begin
  if coalesce(member_role_of(p_business) = 'owner', false) = false then raise exception 'SEM_PERMISSAO'; end if;

  if p_enabled then
    if access_tier(p_business) <> 'completo' then raise exception 'PLANO_GRATIS'; end if;
    if not exists (select 1 from whatsapp_instances where business_id = p_business and genix_enabled) then
      raise exception 'NAO_HABILITADO';
    end if;
    if not v_accept and not exists (select 1 from whatsapp_settings
                                     where business_id = p_business and risk_accepted_at is not null) then
      raise exception 'ACEITE_OBRIGATORIO';
    end if;

    if v_accept then
      insert into whatsapp_settings (business_id, auto_enabled, risk_accepted_by, risk_accepted_at)
      values (p_business, true, auth.uid(), now())
      on conflict (business_id) do update
        set auto_enabled = true, risk_accepted_by = auth.uid(), risk_accepted_at = now();
    else
      update whatsapp_settings set auto_enabled = true where business_id = p_business;
    end if;
  else
    insert into whatsapp_settings (business_id, auto_enabled) values (p_business, false)
    on conflict (business_id) do update set auto_enabled = false;
  end if;
end;
$$;


-- =====================================================================
-- PARTE 7 — Permissões
-- (create or replace mantém as permissões das funções que já existiam)
-- =====================================================================
revoke all on function save_whatsapp_templates(uuid, text, text, text) from public, anon;
grant execute on function save_whatsapp_templates(uuid, text, text, text) to authenticated;


-- =====================================================================
-- PARTE 8 — Conferência
-- 1) checks novas (between 0 and 2); 2) nenhuma linha sem texto C (0);
-- 3) funções do relógio só com postgres/service_role; 4) as duas
--    versões de save_whatsapp_templates.
-- =====================================================================
select conrelid::regclass, conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname in ('whatsapp_settings_next_variant_check', 'whatsapp_reminder_sends_variant_check',
                   'whatsapp_settings_template_c_check');
select count(*) as sem_texto_c from whatsapp_settings where template_c is null;
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_name in ('claim_auto_reminder', 'finish_auto_reminder', 'next_auto_reminder', 'whatsapp_tick_candidates')
 order by routine_name, grantee;
select oid::regprocedure from pg_proc where proname = 'save_whatsapp_templates';


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; ANTES, volte o código para a
-- versão com 2 textos e faça o deploy)
-- 1) Cole e rode, de 33_whatsapp_evolution.sql, as PARTES 5 e 7
--    (claim_auto_reminder e whatsapp_panel_status) e, de
--    23_whatsapp_automatico.sql, o create or replace de set_whatsapp_auto.
-- 2) Depois:
-- drop function if exists save_whatsapp_templates(uuid, text, text, text);
-- update whatsapp_settings set next_variant = 0 where next_variant > 1;
-- update whatsapp_reminder_sends set variant = 0 where variant = 2;  -- preserva o histórico e a contagem do ritmo
-- alter table whatsapp_settings drop constraint if exists whatsapp_settings_next_variant_check;
-- alter table whatsapp_settings add constraint whatsapp_settings_next_variant_check check (next_variant in (0, 1));
-- alter table whatsapp_reminder_sends drop constraint if exists whatsapp_reminder_sends_variant_check;
-- alter table whatsapp_reminder_sends add constraint whatsapp_reminder_sends_variant_check check (variant in (0, 1));
-- alter table whatsapp_settings drop constraint if exists whatsapp_settings_template_c_check;
-- alter table whatsapp_settings drop column if exists template_c;
-- =====================================================================
