-- =====================================================================
-- GENIX AGENDA — 37a: BACKUP antes da migration 37_plano_fechado
-- Ordem: 37a (este) → 37 (migration) → 37b (conferência, uma por vez).
-- Rode este arquivo inteiro, sozinho, ANTES da migration 37.
--
-- As cópias ficam fora da API: RLS ligada sem policy e sem acesso para
-- anon/authenticated. A conferência 37b (consulta 4) usa estas tabelas.
-- Depois de conferir, podem ser apagadas:
--   drop table backup_37_package_templates, backup_37_customer_packages,
--              backup_37_bookings, backup_37_booking_items;
-- =====================================================================
create table if not exists backup_37_package_templates as select * from package_templates;
create table if not exists backup_37_customer_packages as select * from customer_packages;
create table if not exists backup_37_bookings          as select * from bookings;
create table if not exists backup_37_booking_items     as select * from booking_items;

alter table backup_37_package_templates enable row level security;
alter table backup_37_customer_packages enable row level security;
alter table backup_37_bookings          enable row level security;
alter table backup_37_booking_items     enable row level security;
revoke all on backup_37_package_templates, backup_37_customer_packages,
              backup_37_bookings, backup_37_booking_items from anon, authenticated;

-- conferência rápida do backup: as duas colunas de cada linha devem ser iguais
select 'package_templates' as tabela, (select count(*) from package_templates) as original, (select count(*) from backup_37_package_templates) as backup
union all select 'customer_packages', (select count(*) from customer_packages), (select count(*) from backup_37_customer_packages)
union all select 'bookings',          (select count(*) from bookings),          (select count(*) from backup_37_bookings)
union all select 'booking_items',     (select count(*) from booking_items),     (select count(*) from backup_37_booking_items);
