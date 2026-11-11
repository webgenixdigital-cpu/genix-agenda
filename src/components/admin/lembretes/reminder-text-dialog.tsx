"use client";

import { useState, useTransition } from "react";
import { Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { saveManualReminderTexts } from "@/app/admin/(painel)/lembretes/actions";
import { TemplateTextField } from "@/components/admin/template-text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_MANUAL_TODAY, DEFAULT_MANUAL_TOMORROW } from "@/lib/messages";
import { MANUAL_TEMPLATE_VARS } from "@/lib/whatsapp/templates";
import { todayISO } from "@/lib/dates";

type Props = { businessName: string; tomorrow: string | null; today: string | null };

const FIELDS = [
  { key: "amanha", label: "Amanhã", def: DEFAULT_MANUAL_TOMORROW, offset: 1 },
  { key: "hoje", label: "Hoje", def: DEFAULT_MANUAL_TODAY, offset: 0 },
] as const;

/** Textos da fila manual (matriz e recepção) */
export function ReminderTextDialog({ businessName, tomorrow, today }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [texts, setTexts] = useState<[string, string]>([DEFAULT_MANUAL_TOMORROW, DEFAULT_MANUAL_TODAY]);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setTexts([tomorrow || DEFAULT_MANUAL_TOMORROW, today || DEFAULT_MANUAL_TODAY]);
    setError(null);
    setOpen(true);
  }

  function save() {
    setError(null);
    start(async () => {
      // texto igual ao padrão é gravado vazio (segue o padrão, inclusive a linha de total automática)
      const [t, h] = texts.map((v, i) => (v.trim() === FIELDS[i].def.trim() ? "" : v));
      const r = await saveManualReminderTexts(t, h);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      toast.success("Mensagem salva");
    });
  }

  return (
    <>
      <Button variant="outline" className="h-11" onClick={openDialog} data-testid="btn-editar-mensagem-lembrete">
        <PencilLine className="mr-1.5 h-4 w-4" /> Editar mensagem
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Mensagem do lembrete</DialogTitle>
            <DialogDescription>
              Texto que abre no WhatsApp ao tocar em “Enviar lembrete”. As variáveis são trocadas pelos dados de cada agendamento.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {FIELDS.map((f, i) => (
              <TemplateTextField
                key={f.key}
                id={`lembrete-texto-${f.key}`}
                label={f.label}
                value={texts[i]}
                onChange={(v) => setTexts((cur) => (i === 0 ? [v, cur[1]] : [cur[0], v]))}
                defaultText={f.def}
                vars={MANUAL_TEMPLATE_VARS}
                sample={{
                  customerName: "Ana Souza",
                  serviceName: "Corte e escova",
                  professionalName: "Carla",
                  date: todayISO(f.offset),
                  time: "14:30",
                  businessName,
                  total: 120,
                }}
                testIds={{
                  restore: `btn-lembrete-texto-padrao-${f.key}`,
                  textarea: `textarea-lembrete-texto-${f.key}`,
                  varButton: (key) => `btn-lembrete-var-${f.key}-${key}`,
                }}
              />
            ))}

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button className="h-12 w-full text-base" disabled={pending} onClick={save} data-testid="btn-salvar-mensagem-lembrete">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar mensagem"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
