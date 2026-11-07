-- =====================================================================
-- GENIX AGENDA — 39a: BACKUP antes da migration 39_pacote_datas_fixas
-- Ordem: 39a (este) → 39 (migration) → 39b (conferência, uma por vez).
-- Rode este arquivo inteiro, sozinho, ANTES da migration 39.
--
-- A 39 só acrescenta (coluna booking_series.service_ids e funções novas;
-- sell_package passa a chamar o mesmo corpo). Mesmo assim, cópia das
-- tabelas que a venda com datas fixas grava. Ficam fora da API: RLS
-- ligada sem policy e sem acesso para anon/authenticated.
-- Depois de conferir, podem ser apagadas:
--   drop table backup_39_customer_packages, backup_39_customer_package_items,
--              backup_39_booking_series, backup_39_bookings, backup_39_booking_items;
-- =====================================================================
create table if not exists backup_39_customer_packages      as select * from customer_packages;
create table if not exists backup_39_customer_package_items as select * from customer_package_items;
create table if not exists backup_39_booking_series         as select * from booking_series;
create table if not exists backup_39_bookings               as select * from bookings;
create table if not exists backup_39_booking_items          as select * from booking_items;

alter table backup_39_customer_packages      enable row level security;
alter table backup_39_customer_package_items enable row level security;
alter table backup_39_booking_series         enable row level security;
alter table backup_39_bookings               enable row level security;
alter table backup_39_booking_items          enable row level security;
revoke all on backup_39_customer_packages, backup_39_customer_package_items,
              backup_39_booking_series, backup_39_bookings, backup_39_booking_items from anon, authenticated;

-- conferência rápida do backup: as duas colunas de cada linha devem ser iguais
select 'customer_packages' as tabela, (select count(*) from customer_packages) as original, (select count(*) from backup_39_customer_packages) as backup
union all select 'customer_package_items', (select count(*) from customer_package_items), (select count(*) from backup_39_customer_package_items)
union all select 'booking_series',         (select count(*) from booking_series),         (select count(*) from backup_39_booking_series)
union all select 'bookings',               (select count(*) from bookings),               (select count(*) from backup_39_bookings)
union all select 'booking_items',          (select count(*) from booking_items),          (select count(*) from backup_39_booking_items);
