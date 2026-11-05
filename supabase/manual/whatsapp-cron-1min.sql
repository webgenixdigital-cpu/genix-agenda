-- =====================================================================
-- GENIX AGENDA — Relógio do WhatsApp a cada minuto + limpeza do histórico
--
-- ORDEM: rodar SÓ DEPOIS de
--   1) migration 35_whatsapp_intervalo_variavel.sql aplicada;
--   2) merge + deploy do código novo na Vercel.
--
-- Por quê: a 35 sorteia 7–13 min (+ 0–59 s) entre envios. Com o relógio
-- a cada 5 min, o sorteio cairia sempre em 10 ou 15 min. A cada minuto, o
-- envio sai no primeiro minuto depois do horário sorteado.
-- Tick sem nada para fazer é rápido (2 consultas ao banco e devolve), e a
-- rota para de reservar aos 38 s (maxDuration 60 s), então um tick não
-- atropela o próximo. Se atropelar, as travas da claim_auto_reminder (por
-- espaço e por número) e o piso de 7 min da 35 impedem envio duplo.
-- =====================================================================

-- PARTE 1 — whatsapp-tick passa de */5 para a cada minuto
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'whatsapp-tick'),
  schedule := '* * * * *'
);

-- PARTE 2 — Limpeza semanal do histórico do pg_cron
-- (a cada minuto são 1.440 linhas/dia em cron.job_run_details)
-- Domingo, 03:17 UTC: apaga execuções com mais de 7 dias.
select cron.schedule('limpa-cron-historico', '17 3 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);

-- PARTE 3 — Conferência: os 2 jobs
-- whatsapp-tick        | * * * * *  | true
-- limpa-cron-historico | 17 3 * * 0 | true
select jobid, jobname, schedule, active from cron.job
 where jobname in ('whatsapp-tick', 'limpa-cron-historico')
 order by jobname;
-- Últimas execuções (depois de alguns minutos; uma por minuto, status 'succeeded'):
-- select status, return_message, start_time, end_time from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'whatsapp-tick')
--  order by start_time desc limit 10;
-- Respostas HTTP (200 e "ms" baixo quando não há lembrete pronto):
-- select status_code, content, created from net._http_response order by created desc limit 10;


-- =====================================================================
-- VOLTAR
-- Relógio de volta para a cada 5 min:
--   select cron.alter_job(
--     job_id   := (select jobid from cron.job where jobname = 'whatsapp-tick'),
--     schedule := '*/5 * * * *');
-- Remover a limpeza:
--   select cron.unschedule('limpa-cron-historico');
-- =====================================================================
