"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setCustomerAutoReminders } from "@/app/admin/(painel)/clientes/actions";
import { Switch } from "@/components/ui/switch";

/** "Não enviar lembretes automáticos" na ficha do cliente */
export function AutoReminderToggle({ customerId, initial }: { customerId: string; initial: boolean }) {
  const [optOut, setOptOut] = useState(initial);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    start(async () => {
      const r = await setCustomerAutoReminders(customerId, next);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        setOptOut(next);
        toast.success(next ? "Este cliente não receberá lembretes automáticos" : "Lembretes automáticos liberados");
      } else toast.error(r.error);
    });
  }

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border bg-card p-4">
      <span>
        <span className="block font-semibold">Não enviar lembretes automáticos</span>
        <span className="text-sm text-muted-foreground">
          O cliente continua na fila manual de Lembretes, mas o WhatsApp automático não envia para ele.
        </span>
      </span>
      <Switch checked={optOut} onCheckedChange={change} disabled={pending} data-testid="switch-cliente-sem-lembrete-automatico" />
    </label>
  );
}
