-- =====================================================================
-- GENIX AGENDA — 37b: CONFERÊNCIA depois da migration 37_plano_fechado
-- Ordem: 37a (backup) → 37 (migration) → 37b (este).
-- O SQL Editor mostra só o último resultado: rode UMA consulta por vez
-- (selecione o trecho da consulta e clique em Run).
-- Só leitura: nenhuma consulta altera dados.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CONSULTA 1 — Modelos de pacote sem serviço (backfill dos modelos)
-- Esperado: modelos_sem_item = 0
-- ---------------------------------------------------------------------
select count(*) as modelos_sem_item
  from package_templates t
 where not exists (select 1 from package_template_items i where i.template_id = t.id);


-- ---------------------------------------------------------------------
-- CONSULTA 2 — Pacotes vendidos sem serviço (backfill dos pacotes)
-- Esperado: pacotes_sem_item = 0
-- ---------------------------------------------------------------------
select count(*) as pacotes_sem_item
  from customer_packages cp
 where not exists (select 1 from customer_package_items i where i.customer_package_id = cp.id);


-- ---------------------------------------------------------------------
-- CONSULTA 3 — Sessões de pacote sem vínculo com o serviço do pacote
-- Esperado: sessoes_sem_vinculo = 0
-- ---------------------------------------------------------------------
select count(*) as sessoes_sem_vinculo
  from bookings b
  join booking_items i on i.booking_id = b.id and i.position = 0
 where b.customer_package_id is not null and i.customer_package_item_id is null;


-- ---------------------------------------------------------------------
-- CONSULTA 4 — Saldo antigo (calculado nos backups do 37a) × saldo novo
-- Esperado: 0 linhas ("Success. No rows returned")
-- Cada linha que aparecer é um pacote cujo saldo mudou.
-- ---------------------------------------------------------------------
with antigo as (
  select cp.id, cp.sessions_total,
         (select count(*) from backup_37_bookings b
           where b.customer_package_id = cp.id
             and b.status in ('pending', 'confirmed', 'completed'))::int as used
    from backup_37_customer_packages cp
),
novo as (
  select cp.id,
         (select count(*) from booking_items i
            join customer_package_items x on x.id = i.customer_package_item_id
            join bookings b on b.id = i.booking_id
           where x.customer_package_id = cp.id
             and b.status in ('pending', 'confirmed', 'completed'))::int as used
    from customer_packages cp
)
select a.id, a.sessions_total, a.used as usado_antes, n.used as usado_agora
  from antigo a join novo n on n.id = a.id
 where a.used is distinct from n.used;


-- ---------------------------------------------------------------------
-- (opcional, só depois que as 4 consultas baterem) apagar os backups:
-- drop table backup_37_package_templates, backup_37_customer_packages,
--            backup_37_bookings, backup_37_booking_items;
-- ---------------------------------------------------------------------
