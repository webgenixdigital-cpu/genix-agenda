"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateConfirmMode } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { CONFIRM_MODES, type ConfirmMode } from "@/lib/confirm-mode";
import { cn } from "@/lib/utils";

export function ConfirmModeForm({ initial }: { initial: ConfirmMode }) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<ConfirmMode>(initial);

  function save() {
    start(async () => {
      const r = await updateConfirmMode(mode);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Confirmação automática salva");
      else toast.error(r.error);
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div role="radiogroup" aria-label="Confirmação dos agendamentos online" className="space-y-2">
        {CONFIRM_MODES.map((m) => {
          const on = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(m.value)}
              className={cn(
                "flex min-h-11 w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                on ? "border-primary bg-primary/10" : "hover:border-primary/50"
              )}
              data-testid={`opcao-confirmacao-${m.value}`}
            >
              <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2", on ? "border-primary" : "border-stone-300")}>
                {on && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <span>
                <span className="block font-semibold">{m.label}</span>
                <span className="text-sm text-muted-foreground">{m.help}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Vale só para agendamentos feitos na vitrine. Agendamentos que você marca no painel não mudam.
      </p>

      <Button type="submit" className="h-12 w-full text-base sm:w-auto sm:px-8" disabled={pending} data-testid="btn-salvar-confirmacao">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar confirmação"}
      </Button>
    </form>
  );
}
