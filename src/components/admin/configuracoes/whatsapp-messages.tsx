"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveWhatsappMessages, saveWhatsappTemplates } from "@/app/admin/(painel)/configuracoes/whatsapp-actions";
import { TemplateTextField } from "@/components/admin/template-text-field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  BEFORE_OPTIONS,
  BIRTHDAY_VARS,
  DEFAULT_TEMPLATES,
  KIND_LABEL,
  MESSAGE_KINDS,
  TEMPLATE_VARS,
  defaultTemplateFor,
  type MessageKind,
  type TemplateData,
} from "@/lib/whatsapp/templates";
import { addDaysISO, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Preferências por tipo (whatsapp_panel_status, 42). Antes da migration vêm undefined. */
export type MessagesSettings = {
  eve_enabled?: boolean;
  confirm_enabled?: boolean;
  before_enabled?: boolean;
  before_minutes?: number;
  birthday_enabled?: boolean;
  template_confirm?: string | null;
  template_before?: string | null;
  template_birthday?: string | null;
  template_a: string | null;
  template_b: string | null;
  template_c?: string | null;
};

/** whatsapp_auto_stats: últimos 7 dias por tipo */
export type KindStats = { sent: number; failed: number; expired: number; skipped: number; queued: number };
export type WhatsappStats = Partial<Record<MessageKind, KindStats>>;

const DESCRIPTION: Record<MessageKind, string> = {
  confirmation: "5 minutos depois que o agendamento fica confirmado (ou é remarcado). Vale por até 2 horas.",
  before: "No dia, pouco antes do horário. Só para agendamentos confirmados.",
  eve: "A partir das 8h da véspera, alternando 3 textos.",
  birthday: "No dia do aniversário do cliente, em um horário entre 8h e 19h. Uma vez por ano.",
};

const TEXT_LABEL: Record<MessageKind, string> = {
  confirmation: "Texto da confirmação",
  before: "Texto do lembrete antes do horário",
  eve: "Textos da véspera",
  birthday: "Texto de aniversário",
};

const LETTERS = ["a", "b", "c"] as const;
type Minutes = 60 | 90 | 120;

export function WhatsappMessages({
  initial,
  businessName,
  canEdit,
  queueV2,
  stats,
}: {
  initial: MessagesSettings;
  businessName: string;
  /** só a matriz liga/desliga; a demonstração vê a tela */
  canEdit: boolean;
  /** WHATSAPP_QUEUE_V2: sem ela, só a véspera é enviada */
  queueV2: boolean;
  stats: WhatsappStats | null;
}) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState<Record<MessageKind, boolean>>({
    confirmation: initial.confirm_enabled ?? false,
    before: initial.before_enabled ?? false,
    eve: initial.eve_enabled ?? true,
    birthday: initial.birthday_enabled ?? false,
  });
  const [minutes, setMinutes] = useState<Minutes>(
    ([60, 90, 120] as const).find((m) => m === initial.before_minutes) ?? 120
  );
  const [texts, setTexts] = useState({
    confirmation: initial.template_confirm || defaultTemplateFor("confirmation"),
    before: initial.template_before || defaultTemplateFor("before"),
    birthday: initial.template_birthday || defaultTemplateFor("birthday"),
  });
  const [eveTexts, setEveTexts] = useState<string[]>(() =>
    DEFAULT_TEMPLATES.map((d, i) => [initial.template_a, initial.template_b, initial.template_c ?? null][i] || d)
  );

  const sample = (date: string): TemplateData => ({
    customerName: "Ana Souza",
    serviceName: "Corte e escova",
    professionalName: "Carla",
    date,
    time: "14:30",
    businessName,
  });

  // texto igual ao padrão é gravado vazio (acompanha melhorias futuras do padrão)
  const orEmpty = (t: string, def: string) => (t.trim() === def.trim() ? "" : t);

  function save() {
    start(async () => {
      const r = await saveWhatsappMessages({
        eve_enabled: on.eve,
        confirm_enabled: on.confirmation,
        before_enabled: on.before,
        before_minutes: minutes,
        birthday_enabled: on.birthday,
        template_confirm: orEmpty(texts.confirmation, defaultTemplateFor("confirmation")),
        template_before: orEmpty(texts.before, defaultTemplateFor("before")),
        template_birthday: orEmpty(texts.birthday, defaultTemplateFor("birthday")),
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      const [a, b, c] = eveTexts.map((t, i) => orEmpty(t, DEFAULT_TEMPLATES[i]));
      const r2 = await saveWhatsappTemplates(a, b, c);
      if (!r2) return;
      if (r2.ok) toast.success("Mensagens salvas");
      else toast.error(r2.error);
    });
  }

  return (
    <div className="space-y-4" data-testid="whatsapp-mensagens">
      <div>
        <p className="font-semibold">Mensagens automáticas</p>
        <p className="text-sm text-muted-foreground">
          Escolha quais mensagens saem sozinhas. Todas dividem o mesmo ritmo seguro do número; quando disputam a vez, a
          ordem é: confirmação, antes do horário, véspera e aniversário.
        </p>
      </div>

      {!queueV2 && (
        <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="whatsapp-tipos-inativos">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Confirmação, antes do horário e aniversário ainda estão sendo liberados: por enquanto só o lembrete de véspera é
          enviado. Você já pode deixar tudo configurado.
        </p>
      )}

      {MESSAGE_KINDS.map((kind) => (
        <div key={kind} className="rounded-xl border bg-white" data-testid={`whatsapp-tipo-${kind}`}>
          <label className="flex cursor-pointer items-center justify-between gap-4 p-4">
            <span className="min-w-0">
              <span className="block font-semibold">{KIND_LABEL[kind]}</span>
              <span className="text-sm text-muted-foreground">{DESCRIPTION[kind]}</span>
            </span>
            <Switch
              checked={on[kind]}
              onCheckedChange={(v) => setOn((o) => ({ ...o, [kind]: v }))}
              disabled={pending || !canEdit}
              data-testid={`switch-whatsapp-tipo-${kind}`}
            />
          </label>

          {kind === "before" && (
            <div className="flex flex-wrap gap-2 px-4 pb-4" role="radiogroup" aria-label="Quanto tempo antes">
              {BEFORE_OPTIONS.map((o) => (
                <button
                  key={o.minutes}
                  type="button"
                  role="radio"
                  aria-checked={minutes === o.minutes}
                  disabled={pending || !canEdit}
                  onClick={() => setMinutes(o.minutes)}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-60",
                    minutes === o.minutes ? "border-primary bg-primary text-primary-foreground" : "bg-white hover:bg-secondary"
                  )}
                  data-testid={`btn-whatsapp-antes-${o.minutes}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          <details className="group border-t">
            <summary
              className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden"
              data-testid={`btn-whatsapp-editar-texto-${kind}`}
            >
              {kind === "eve" ? "Editar os 3 textos" : "Editar texto"}
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-5 px-4 pb-4">
              {kind === "eve" ? (
                eveTexts.map((t, i) => {
                  const letter = LETTERS[i];
                  return (
                    <TemplateTextField
                      key={letter}
                      id={`wa-texto-${letter}`}
                      label={`Texto ${letter.toUpperCase()}`}
                      value={t}
                      onChange={(v) => setEveTexts((cur) => cur.map((x, j) => (j === i ? v : x)))}
                      defaultText={DEFAULT_TEMPLATES[i]}
                      vars={TEMPLATE_VARS}
                      sample={sample(addDaysISO(todayISO(), 1))}
                      testIds={{
                        restore: `btn-whatsapp-texto-padrao-${letter}`,
                        textarea: `textarea-whatsapp-texto-${letter}`,
                        varButton: (key) => `btn-whatsapp-var-${letter}-${key}`,
                      }}
                    />
                  );
                })
              ) : (
                <TemplateTextField
                  id={`wa-texto-${kind}`}
                  label={TEXT_LABEL[kind]}
                  value={texts[kind]}
                  onChange={(v) => setTexts((cur) => ({ ...cur, [kind]: v }))}
                  defaultText={defaultTemplateFor(kind)}
                  vars={kind === "birthday" ? BIRTHDAY_VARS : TEMPLATE_VARS}
                  sample={sample(kind === "before" ? todayISO() : addDaysISO(todayISO(), 1))}
                  testIds={{
                    restore: `btn-whatsapp-texto-padrao-${kind}`,
                    textarea: `textarea-whatsapp-texto-${kind}`,
                    varButton: (key) => `btn-whatsapp-var-${kind}-${key}`,
                  }}
                />
              )}
            </div>
          </details>
        </div>
      ))}

      <Button className="h-12 w-full text-base sm:w-auto sm:px-8" disabled={pending} onClick={save} data-testid="btn-salvar-whatsapp-mensagens">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar mensagens"}
      </Button>

      {stats && <StatsCard stats={stats} />}
    </div>
  );
}

/** Últimos 7 dias por tipo: enviadas, não enviadas por limite/validade e falhas */
function StatsCard({ stats }: { stats: WhatsappStats }) {
  return (
    <div className="rounded-xl border bg-white p-4" data-testid="whatsapp-estatisticas">
      <p className="font-semibold">Últimos 7 dias</p>
      <p className="text-sm text-muted-foreground">
        “Não enviadas” são as que perderam a validade porque o limite de envios do número estava ocupado.
      </p>
      <ul className="mt-3 divide-y text-sm">
        {MESSAGE_KINDS.map((kind) => {
          const s = stats[kind] ?? { sent: 0, failed: 0, expired: 0, skipped: 0, queued: 0 };
          return (
            <li key={kind} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2" data-testid={`whatsapp-estatistica-${kind}`}>
              <span className="font-medium">{KIND_LABEL[kind]}</span>
              <span className="text-muted-foreground">
                {s.sent} {s.sent === 1 ? "enviada" : "enviadas"} · {s.expired} não {s.expired === 1 ? "enviada" : "enviadas"}
                {s.failed > 0 && ` · ${s.failed} ${s.failed === 1 ? "falha" : "falhas"}`}
                {s.queued > 0 && ` · ${s.queued} na fila`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
