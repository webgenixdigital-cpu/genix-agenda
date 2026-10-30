-- =====================================================================
-- GENIX AGENDA — Relógio dos lembretes automáticos no WhatsApp
--
-- ORDEM: rodar SÓ DEPOIS de
--   1) migration 23_whatsapp_automatico.sql aplicada;
--   2) deploy do código novo na Vercel;
--   3) CRON_SECRET e WHATSAPP_SEND_ENABLED=1 cadastradas na Vercel + redeploy.
--
-- O Supabase chama https://genixagenda.com.br/api/whatsapp/tick a cada
-- 5 minutos (sem www: redirecionamento perde o cabeçalho).
-- =====================================================================

-- PARTE 1 — Extensões (Database → Extensions também funciona)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- PARTE 2 — Segredo guardado no Vault (o MESMO valor de CRON_SECRET da Vercel)
-- >>> TROQUE O TEXTO ABAIXO ANTES DE RODAR <<<
select vault.create_secret('COLE_AQUI_O_CRON_SECRET', 'whatsapp_tick_secret');

-- PARTE 3 — Agendamento a cada 5 minutos
select cron.schedule(
  'whatsapp-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://genixagenda.com.br/api/whatsapp/tick',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'whatsapp_tick_secret' limit 1)),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- PARTE 4 — Conferência
select jobid, jobname, schedule, active from cron.job where jobname = 'whatsapp-tick';
-- Últimas execuções (depois de alguns minutos):
-- select status, return_message, start_time from cron.job_run_details
--  where jobid = (select jobid from cron.job where jobname = 'whatsapp-tick')
--  order by start_time desc limit 10;
-- Respostas HTTP: select status_code, content from net._http_response order by created desc limit 10;


-- =====================================================================
-- PAUSAR / DESFAZER
-- Pausar tudo:       select cron.unschedule('whatsapp-tick');
-- Trocar o segredo:  select vault.update_secret(
--                      (select id from vault.secrets where name = 'whatsapp_tick_secret'), 'NOVO_VALOR');
-- Apagar o segredo:  delete from vault.secrets where name = 'whatsapp_tick_secret';
-- (Também dá para parar sem SQL: WHATSAPP_SEND_ENABLED=0 na Vercel + redeploy.)
-- =====================================================================
