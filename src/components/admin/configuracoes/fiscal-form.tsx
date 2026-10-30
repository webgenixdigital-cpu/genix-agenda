"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateFiscal } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isValidCpfCnpj, maskCpfCnpj, onlyDigits } from "@/lib/cpf-cnpj";
import { NOTES, REGIMES, REGIME_LABEL, type FiscalProfile } from "@/lib/faturamento";

export function FiscalForm({ initial }: { initial: FiscalProfile }) {
  const [pending, start] = useTransition();
  const [regime, setRegime] = useState<string>(initial.regime ?? "");
  const [activityStart, setActivityStart] = useState(initial.activity_start ?? "");
  const [cnpj, setCnpj] = useState(initial.cnpj ? maskCpfCnpj(initial.cnpj) : "");
  const [partnerSalon, setPartnerSalon] = useState(initial.partner_salon);

  const digits = onlyDigits(cnpj);
  const cnpjBad = digits.length > 0 && (digits.length !== 14 || !isValidCpfCnpj(digits));

  function save() {
    start(async () => {
      const r = await updateFiscal({ regime, activityStart, cnpj, partnerSalon });
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Enquadramento salvo");
      else toast.error(r.error);
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Enquadramento</Label>
          <Select value={regime} onValueChange={setRegime}>
            <SelectTrigger className="h-11" data-testid="select-enquadramento">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {REGIMES.map((r) => (
                <SelectItem key={r} value={r}>{REGIME_LABEL[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fs-inicio">Início das atividades (opcional)</Label>
          <Input
            id="fs-inicio"
            type="date"
            className="h-11"
            value={activityStart}
            onChange={(e) => setActivityStart(e.target.value)}
            data-testid="input-inicio-atividades"
          />
        </div>
      </div>

      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor="fs-cnpj">CNPJ (opcional)</Label>
        <Input
          id="fs-cnpj"
          className="h-11"
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          value={cnpj}
          onChange={(e) => setCnpj(maskCpfCnpj(e.target.value))}
          data-testid="input-cnpj"
        />
        {cnpjBad && digits.length >= 14 && <p className="text-sm text-destructive">Confira os números do CNPJ.</p>}
      </div>

      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border p-4">
        <span>
          <span className="block font-semibold">Trabalho com profissionais parceiros (Lei 13.352 — salão-parceiro)</span>
          <span className="text-sm text-muted-foreground">
            Marque quem é parceiro em Equipe. O repasse sai da receita usada nos limites. {NOTES.partner}
          </span>
        </span>
        <Switch checked={partnerSalon} onCheckedChange={setPartnerSalon} data-testid="switch-salao-parceiro" />
      </label>

      <p className="text-xs text-muted-foreground">
        Usado no Financeiro (Faturamento e Relatório para o contador). {NOTES.disclaimer}
      </p>

      <Button
        type="submit"
        className="h-12 w-full text-base sm:w-auto sm:px-8"
        disabled={pending || !regime || cnpjBad}
        data-testid="btn-salvar-enquadramento"
      >
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar enquadramento"}
      </Button>
    </form>
  );
}
