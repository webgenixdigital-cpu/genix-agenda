-- =====================================================================
-- GENIX AGENDA — E2.2: DADOS DOS CONVITES DA EQUIPE
-- Rode o arquivo inteiro no SQL Editor.
-- =====================================================================

alter table business_members
  add column if not exists invited_email text,
  add column if not exists display_name  text,
  add column if not exists invited_at    timestamptz;

-- Conferência
select column_name from information_schema.columns
where table_name = 'business_members' and column_name in ('invited_email', 'display_name', 'invited_at')
order by column_name;
