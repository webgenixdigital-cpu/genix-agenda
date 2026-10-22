-- =====================================================================
-- GENIX AGENDA — TRAVA: 1 lançamento de caixa por atendimento
-- Rode o arquivo inteiro no SQL Editor.
-- =====================================================================

-- PARTE 1 — Conferir se já existem duplicados (antes de limpar)
select booking_id, count(*) as lancamentos
from cash_entries
where booking_id is not null
group by booking_id
having count(*) > 1;

-- PARTE 2 — Remover duplicados, mantendo o lançamento mais antigo de cada atendimento
delete from cash_entries c
using cash_entries d
where c.booking_id is not null
  and c.booking_id = d.booking_id
  and (c.created_at, c.id) > (d.created_at, d.id);

-- PARTE 3 — Trava definitiva no banco
create unique index if not exists cash_entries_one_per_booking
  on cash_entries (booking_id)
  where booking_id is not null;

-- PARTE 4 — Conferência (deve voltar 1 linha com o nome do índice)
select indexname from pg_indexes where indexname = 'cash_entries_one_per_booking';
