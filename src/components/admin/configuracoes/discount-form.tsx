"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateStaffDiscountLimit } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DiscountForm({ initial, readOnly }: { initial: number; readOnly: boolean }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(String(initial).replace(".", ","));

  function save() {
    const pct = Number(value.replace(",", ".") || "0");
    start(async () => {
      const r = await updateStaffDiscountLimit(pct);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Limite de desconto salvo");
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
      <div className="space-y-1.5">
        <Label htmlFor="limite-desconto">Desconto máximo que o profissional pode dar</Label>
        <div className="flex max-w-[180px] items-center gap-2">
          <Input
            id="limite-desconto"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d,]/g, ""))}
            className="h-11"
            disabled={readOnly}
            data-testid="input-limite-desconto"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          0% = só a matriz e a recepção dão desconto (sem limite). O limite vale sobre o valor dos serviços do agendamento.
        </p>
      </div>
      {!readOnly && (
        <Button type="submit" className="h-11" disabled={pending} data-testid="btn-salvar-limite-desconto">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
        </Button>
      )}
    </form>
  );
}
