-- =====================================================================
-- GENIX AGENDA — REGISTRO DE AVISOS (WEBHOOKS) DO ASAAS
-- Garante que o mesmo aviso nunca seja processado duas vezes.
-- Rode o arquivo inteiro no SQL Editor.
-- =====================================================================

create table if not exists asaas_webhook_events (
  id            text primary key,              -- id do evento enviado pelo Asaas
  event         text not null,
  payment_id    text,
  subscription_id text,
  business_id   uuid references businesses(id) on delete set null,
  result        text,                          -- o que foi feito (ou motivo de ignorar)
  payload       jsonb not null,
  received_at   timestamptz not null default now()
);

create index if not exists idx_asaas_events_subscription on asaas_webhook_events (subscription_id, received_at desc);

-- Só o servidor (chave de serviço) acessa esta tabela
alter table asaas_webhook_events enable row level security;

-- Conferência
select count(*) as eventos_registrados from asaas_webhook_events;
