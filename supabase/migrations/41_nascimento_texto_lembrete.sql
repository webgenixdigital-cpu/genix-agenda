-- =====================================================================
-- GENIX AGENDA — 41: data de nascimento do cliente + texto da fila
-- manual de Lembretes.
--
--   customers.birth_date             data opcional (sem idade na tela)
--   manual_reminder_texts            textos "Amanhã" e "Hoje" da fila manual
--   save_manual_reminder_texts(...)  grava os dois textos (matriz e recepção)
--
-- birth_date: a RLS atual de customers ("altera clientes": matriz,
-- recepção e profissional para os clientes que ele vê) já cobre a coluna.
-- O "não pode ser no futuro" fica na server action.
--
-- manual_reminder_texts: todos os papéis do espaço leem (o profissional
-- também usa o botão da fila); ninguém escreve direto, só pela função.
-- Texto null = padrão do sistema. Variáveis: {primeiro_nome} {servico}
-- {profissional} {data} {hora} {espaco} {total}.
--
-- ORDEM: rodar ANTES do merge (só acrescenta; o código atual continua
-- funcionando). Tudo dentro de begin/commit. Reversão no final.
-- =====================================================================

begin;


-- =====================================================================
-- PARTE 1 — Data de nascimento do cliente
-- =====================================================================
alter table customers add column if not exists birth_date date;

alter table customers drop constraint if exists customers_birth_date_check;
alter table customers add constraint customers_birth_date_check
  check (birth_date is null or birth_date >= date '1900-01-01');


-- =====================================================================
-- PARTE 2 — Textos da fila manual (1 linha por espaço)
-- =====================================================================
create table if not exists manual_reminder_texts (
  business_id   uuid primary key references businesses(id) on delete cascade,
  text_tomorrow text check (text_tomorrow is null or char_length(text_tomorrow) <= 1000),
  text_today    text check (text_today is null or char_length(text_today) <= 1000),
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_manual_reminder_texts_updated on manual_reminder_texts;
create trigger trg_manual_reminder_texts_updated before update on manual_reminder_texts
  for each row execute function set_updated_at();

alter table manual_reminder_texts enable row level security;
revoke all on manual_reminder_texts from public, anon, authenticated;
grant select on manual_reminder_texts to authenticated;
grant all on manual_reminder_texts to service_role;

drop policy if exists "equipe ve textos do lembrete" on manual_reminder_texts;
create policy "equipe ve textos do lembrete" on manual_reminder_texts
  for select to authenticated using (member_role_of(business_id) is not null);


-- =====================================================================
-- PARTE 3 — Salvar os dois textos (vazio = texto padrão)
-- Erros: SEM_PERMISSAO | DADOS_INVALIDOS
-- =====================================================================
create or replace function save_manual_reminder_texts(p_business uuid, p_tomorrow text, p_today text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_tomorrow text := nullif(trim(coalesce(p_tomorrow, '')), '');
  v_today    text := nullif(trim(coalesce(p_today, '')), '');
begin
  if coalesce(member_role_of(p_business) in ('owner', 'reception'), false) = false then
    raise exception 'SEM_PERMISSAO';
  end if;
  if char_length(coalesce(v_tomorrow, '')) > 1000 or char_length(coalesce(v_today, '')) > 1000 then
    raise exception 'DADOS_INVALIDOS';
  end if;

  insert into manual_reminder_texts (business_id, text_tomorrow, text_today, updated_by)
  values (p_business, v_tomorrow, v_today, auth.uid())
  on conflict (business_id) do update
    set text_tomorrow = v_tomorrow, text_today = v_today, updated_by = auth.uid();
end;
$$;

revoke all on function save_manual_reminder_texts(uuid, text, text) from public, anon;
grant execute on function save_manual_reminder_texts(uuid, text, text) to authenticated;

commit;


-- =====================================================================
-- Conferência
-- =====================================================================
-- 1) coluna nova em customers (deve voltar 1 linha: birth_date | date | YES)
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'customers' and column_name = 'birth_date';

-- 2) tabela com RLS ligada (rowsecurity = true) e 1 política de leitura
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'manual_reminder_texts';
select policyname, cmd from pg_policies where tablename = 'manual_reminder_texts';

-- 3) authenticated só com SELECT na tabela
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_name = 'manual_reminder_texts' and grantee in ('anon', 'authenticated')
 order by 1, 2;

-- 4) função security definer (prosecdef = true)
select proname, prosecdef from pg_proc where proname = 'save_manual_reminder_texts';


-- =====================================================================
-- REVERSÃO (rodar só se precisar desfazer; apaga os textos salvos e as
-- datas de nascimento cadastradas)
-- =====================================================================
-- drop function if exists save_manual_reminder_texts(uuid, text, text);
-- drop table if exists manual_reminder_texts;
-- alter table customers drop constraint if exists customers_birth_date_check;
-- alter table customers drop column if exists birth_date;
