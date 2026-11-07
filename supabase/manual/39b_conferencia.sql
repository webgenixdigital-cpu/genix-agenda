-- =====================================================================
-- GENIX AGENDA — 39b: CONFERÊNCIA depois da migration 39_pacote_datas_fixas
-- Ordem: 39a (backup) → 39 (migration) → 39b (este).
-- O SQL Editor mostra só o último resultado: rode UMA consulta por vez
-- (selecione o trecho da consulta e clique em Run).
-- Só leitura: nenhuma consulta altera dados.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CONSULTA 1 — Funções e coluna novas presentes
-- Esperado: 6 linhas de função + coluna_service_ids = 1
-- ---------------------------------------------------------------------
select proname,
       (select count(*) from information_schema.columns
         where table_name = 'booking_series' and column_name = 'service_ids') as coluna_service_ids
  from pg_proc
 where proname in ('check_package_sale', 'package_plan_dates', 'sell_package_core',
                   'sell_package', 'preview_package_sale', 'sell_package_fixed')
 order by 1;


-- ---------------------------------------------------------------------
-- CONSULTA 2 — Permissões: só prévia, venda e venda com datas para o painel
-- Esperado: authenticated = true só em preview_package_sale,
--           sell_package e sell_package_fixed; anon = false em todas
-- ---------------------------------------------------------------------
select p.oid::regprocedure as funcao,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p
 where p.proname in ('check_package_sale', 'package_plan_dates', 'sell_package_core',
                     'sell_package', 'preview_package_sale', 'sell_package_fixed')
 order by 1;


-- ---------------------------------------------------------------------
-- CONSULTA 3 — Nada mudou nos dados existentes (compara com o 39a)
-- Esperado: diferenca = 0 em todas as linhas (antes de qualquer venda nova)
-- ---------------------------------------------------------------------
select 'customer_packages' as tabela, (select count(*) from customer_packages) - (select count(*) from backup_39_customer_packages) as diferenca
union all select 'customer_package_items', (select count(*) from customer_package_items) - (select count(*) from backup_39_customer_package_items)
union all select 'booking_series',         (select count(*) from booking_series)         - (select count(*) from backup_39_booking_series)
union all select 'bookings',               (select count(*) from bookings)               - (select count(*) from backup_39_bookings)
union all select 'booking_items',          (select count(*) from booking_items)          - (select count(*) from backup_39_booking_items);


-- ---------------------------------------------------------------------
-- CONSULTA 4 — Depois de vender um pacote com datas fixas (teste):
-- visitas, serviços por visita e se todos os itens estão ligados ao pacote.
-- Esperado: itens_sem_vinculo = 0 em todas as linhas
-- ---------------------------------------------------------------------
select cp.name as pacote, b.booking_date, b.start_time, b.service_name, b.duration_min, b.status,
       count(i.*) as itens,
       count(i.*) filter (where i.customer_package_item_id is null or not i.paid_by_package) as itens_sem_vinculo
  from customer_packages cp
  join bookings b on b.customer_package_id = cp.id
  join booking_items i on i.booking_id = b.id
 where cp.schedule_mode = 'fixed'
 group by cp.id, cp.name, b.id
 order by cp.sold_at desc, b.booking_date, b.start_time
 limit 60;


-- ---------------------------------------------------------------------
-- CONSULTA 5 — Saldo dos pacotes com datas fixas (sem data = restante)
-- Esperado: usado nunca maior que sessions_total
-- ---------------------------------------------------------------------
select cp.name as pacote, pi.service_name, pi.sessions_total,
       package_item_used(pi.id) as usado,
       pi.sessions_total - package_item_used(pi.id) as sem_data
  from customer_packages cp
  join customer_package_items pi on pi.customer_package_id = cp.id
 where cp.schedule_mode = 'fixed'
 order by cp.sold_at desc, pi.position
 limit 60;
