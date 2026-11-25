"use client";

// Calculadora de preço de venda (69), aba Financeiro → Preço.
// Passo a passo: 1) enquadramento → 2) custos fixos → 3) horas → 4) taxa e comissão → 5) serviço.
// Modos: "Quanto cobrar?" (margem → preço) e "Quanto eu lucro?" (preço → custo real e lucro).
// Contas em lib/pricing.ts. Configurações por espaço (save_pricing_settings, só a matriz);
// "Usar este custo no serviço" grava o custo direto (save_service_cost).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { savePricingSettings } from "@/app/admin/(painel)/financeiro/actions";
import { saveServiceCost } from "@/app/admin/(painel)/servicos/actions";
import { Ajuda } from "@/components/ajuda";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AjudaId } from "@/content/ajuda";
import { brl, duration as fmtDuration } from "@/lib/format";
import {
  FIXED_COST_ITEMS,
  LIGHT_LABEL,
  PCT_WARNING,
  REGIME_TAX,
  feeFor,
  fixedMonthly,
  fixedPerService,
  pctSum,
  realProfit,
  suggestedPrice,
  trafficLight,
  type FeeChoice,
  type Light,
  type PaymentForm,
  type Regime,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

export type CalcSettings = {
  regime: Regime | null;
  tax_pct: number;
  fixed_costs: { key: string; label: string; amount: number }[];
  hours_month: number | null;
  fee_credito_pct: number;
  fee_debito_pct: number;
  fee_pix_pct: number;
  fee_dinheiro_pct: number;
  commission_pct: number;
  target_margin_pct: number;
};

export type CalcService = { id: string; name: string; combo: boolean; price: number; duration_min: number; cost: number | null };

const REGIMES: { value: Regime; label: string; hint: string }[] = [
  { value: "mei", label: "MEI", hint: "0%: o DAS entra nos custos fixos." },
  { value: "simples", label: "Simples Nacional", hint: "Sugestão de 6% (Anexo III, 1ª faixa). Confirme com o contador." },
  { value: "autonomo", label: "Autônomo", hint: "Informe o % de ISS + INSS/IR que o contador passar." },
  { value: "nao_sei", label: "Não sei", hint: "Pergunte ao contador. Enquanto isso, deixe 0% ou um valor aproximado." },
];

const FORMS: { value: FeeChoice; label: string }[] = [
  { value: "credito", label: "Crédito" },
  { value: "debito", label: "Débito" },
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "media", label: "Média" },
];

const LIGHT_CLASS: Record<Light, string> = {
  prejuizo: "border-red-200 bg-red-50 text-red-900",
  baixa: "border-amber-200 bg-amber-50 text-amber-900",
  saudavel: "border-green-200 bg-green-50 text-green-900",
};

/** "6,5" / "1.234,56" / "6.5" → número; vazio → 0 */
const parseNum = (v: string) => {
  const t = v.trim();
  if (!t) return 0;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : 0;
};
const toInput = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(Math.round(n * 100) / 100).replace(".", ","));
const clean = (v: string) => v.replace(/[^\d,.]/g, "").slice(0, 12);

function Field({
  id,
  label,
  help,
  value,
  onChange,
  suffix,
  prefix,
  testId,
  hint,
}: {
  id: string;
  label: string;
  help?: AjudaId;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  prefix?: string;
  testId: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        {help && <Ajuda id={help} />}
      </div>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
        <Input
          id={id}
          inputMode="decimal"
          className={cn("h-11", prefix && "pl-9", suffix && "pr-14")}
          placeholder="0"
          value={value}
          onChange={(e) => onChange(clean(e.target.value))}
          data-testid={testId}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Step({ n, title, help, children }: { n: number; title: string; help?: AjudaId; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 md:p-5" aria-labelledby={`passo-${n}`}>
      <h2 id={`passo-${n}`} className="flex items-center gap-2 font-sans text-base font-semibold">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm text-primary-foreground">{n}</span>
        {title}
        {help && <Ajuda id={help} />}
      </h2>
      {children}
    </section>
  );
}

export function PricingCalculator({
  settings,
  suggestions,
  services,
  team,
}: {
  settings: CalcSettings | null;
  suggestions: { expenses: Record<string, number>; hoursMonth: number | null; commissionAvg: number | null };
  services: CalcService[];
  /** plano Equipe: sugere a comissão média dos profissionais */
  team: boolean;
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [applying, startApply] = useTransition();

  // 1) enquadramento
  const [regime, setRegime] = useState<Regime | null>(settings?.regime ?? null);
  const [tax, setTax] = useState(toInput(settings?.tax_pct));
  // 2) custos fixos: salvos > média das saídas do caixa (3 meses) > vazio
  const [fixed, setFixed] = useState(() =>
    FIXED_COST_ITEMS.map((it) => {
      const saved = settings?.fixed_costs.find((c) => c.key === it.key);
      const fromCash = it.cashCategory ? suggestions.expenses[it.cashCategory] : undefined;
      return {
        ...it,
        amount: toInput(saved ? saved.amount : settings ? 0 : fromCash ?? 0),
        fromCash: !settings && !!fromCash,
      };
    })
  );
  // 3) horas
  const [hours, setHours] = useState(toInput(settings?.hours_month ?? suggestions.hoursMonth));
  // 4) taxas por forma e comissão
  const [fees, setFees] = useState<Record<PaymentForm, string>>({
    credito: toInput(settings?.fee_credito_pct),
    debito: toInput(settings?.fee_debito_pct),
    pix: toInput(settings?.fee_pix_pct),
    dinheiro: toInput(settings?.fee_dinheiro_pct),
  });
  const [feeChoice, setFeeChoice] = useState<FeeChoice>("credito");
  const [commission, setCommission] = useState(toInput(settings?.commission_pct ?? (team ? suggestions.commissionAvg : 0)));
  // 5) serviço
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? "manual");
  const picked = services.find((s) => s.id === serviceId) ?? null;
  const [dur, setDur] = useState(String(picked?.duration_min ?? 60));
  const [cd, setCd] = useState(toInput(picked?.cost));
  const [price, setPrice] = useState(toInput(picked?.price));
  // modo
  const [mode, setMode] = useState<"cobrar" | "lucro">("cobrar");
  const [margin, setMargin] = useState(toInput(settings?.target_margin_pct ?? 20));

  function pick(id: string) {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    if (s) {
      setDur(String(s.duration_min));
      setCd(toInput(s.cost));
      setPrice(toInput(s.price));
    }
  }

  const calc = useMemo(() => {
    const monthly = fixedMonthly(fixed.map((f) => ({ amount: parseNum(f.amount) })));
    const h = parseNum(hours);
    const d = parseNum(dur);
    const cf = fixedPerService(monthly, h, d);
    const feeNums = { credito: parseNum(fees.credito), debito: parseNum(fees.debito), pix: parseNum(fees.pix), dinheiro: parseNum(fees.dinheiro) };
    const tx = feeFor(feeNums, feeChoice);
    const imp = parseNum(tax);
    const com = parseNum(commission);
    const ml = parseNum(margin);
    const cdn = parseNum(cd);
    const pcts = pctSum(imp, tx, com, ml);
    const suggested = suggestedPrice({ cd: cdn, cf, imp, tx, com, ml });
    const profit = realProfit({ price: parseNum(price), cd: cdn, cf, imp, tx, com });
    return { monthly, cf, tx, imp, com, ml, cdn, pcts, suggested, profit, light: trafficLight(profit.profitPct), hoursOk: h > 0 };
  }, [fixed, hours, dur, fees, feeChoice, tax, commission, margin, cd, price]);

  function save() {
    startSave(async () => {
      const r = await savePricingSettings({
        regime,
        tax_pct: calc.imp,
        fixed_costs: fixed.map((f) => ({ key: f.key, label: f.label, amount: parseNum(f.amount) })),
        hours_month: parseNum(hours) > 0 ? parseNum(hours) : null,
        fee_credito_pct: parseNum(fees.credito),
        fee_debito_pct: parseNum(fees.debito),
        fee_pix_pct: parseNum(fees.pix),
        fee_dinheiro_pct: parseNum(fees.dinheiro),
        commission_pct: calc.com,
        target_margin_pct: calc.ml,
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Configurações salvas. O lucro estimado já aparece no Caixa.");
      router.refresh();
    });
  }

  const costChanged = !!picked && (picked.cost ?? null) !== (cd.trim() === "" ? null : calc.cdn);
  function applyCost() {
    if (!picked) return;
    startApply(async () => {
      const value = cd.trim() === "" ? null : calc.cdn;
      const r = await saveServiceCost(
        picked.combo
          ? { serviceId: picked.id, material: null, other: null, override: value }
          : { serviceId: picked.id, material: value, other: null }
      );
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Custo de “${picked.name}” atualizado: ${value == null ? "sem custo" : brl(value)}`);
      router.refresh();
    });
  }

  const regimeHint = REGIMES.find((r) => r.value === regime)?.hint;

  return (
    <div className="space-y-5" data-testid="calculadora-preco">
      <p className="text-center text-sm text-muted-foreground">
        Preencha uma vez e salve. Depois é só escolher o serviço. <Ajuda id="preco-de-venda" />
      </p>

      <Step n={1} title="Enquadramento" help="preco-enquadramento">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Enquadramento">
          {REGIMES.map((r) => (
            <Button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={regime === r.value}
              variant={regime === r.value ? "default" : "outline"}
              className="h-11 px-2"
              onClick={() => {
                setRegime(r.value);
                const t = REGIME_TAX[r.value];
                if (t !== null) setTax(toInput(t));
              }}
              data-testid={`preco-regime-${r.value}`}
            >
              {r.label}
            </Button>
          ))}
        </div>
        <Field id="pc-imp" label="Imposto (IMP)" help="preco-imp" value={tax} onChange={setTax} suffix="%" testId="preco-input-imposto" hint={regimeHint} />
      </Step>

      <Step n={2} title="Custos fixos do mês" help="preco-cf">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fixed.map((f, i) => (
            <Field
              key={f.key}
              id={`pc-fixo-${f.key}`}
              label={f.label}
              value={f.amount}
              onChange={(v) => setFixed((cur) => cur.map((x, j) => (j === i ? { ...x, amount: v, fromCash: false } : x)))}
              prefix="R$"
              testId={`preco-fixo-${f.key}`}
              hint={f.fromCash ? "Média das saídas do caixa nos últimos 3 meses" : undefined}
            />
          ))}
        </div>
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          Total do mês: <strong data-testid="preco-fixos-total">{brl(calc.monthly)}</strong>
        </p>
      </Step>

      <Step n={3} title="Horas trabalhadas no mês" help="preco-horas">
        <Field
          id="pc-horas"
          label="Horas por mês"
          value={hours}
          onChange={setHours}
          suffix="h"
          testId="preco-input-horas"
          hint={suggestions.hoursMonth ? `Sugestão pelo horário de funcionamento: ${toInput(suggestions.hoursMonth)} h` : undefined}
        />
        {calc.hoursOk && (
          <p className="text-sm text-muted-foreground">
            Custo fixo por hora: <strong className="text-foreground">{brl(calc.monthly / parseNum(hours))}</strong>
          </p>
        )}
      </Step>

      <Step n={4} title="Taxas e comissão">
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label>Taxa da maquininha por forma (TX)</Label>
            <Ajuda id="preco-tx" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["credito", "debito", "pix", "dinheiro"] as PaymentForm[]).map((k) => (
              <Field
                key={k}
                id={`pc-tx-${k}`}
                label={FORMS.find((x) => x.value === k)?.label ?? k}
                value={fees[k]}
                onChange={(v) => setFees((cur) => ({ ...cur, [k]: v }))}
                suffix="%"
                testId={`preco-taxa-${k}`}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Usar no cálculo</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Forma usada no cálculo">
              {FORMS.map((f) => (
                <Button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={feeChoice === f.value}
                  variant={feeChoice === f.value ? "default" : "outline"}
                  className="h-11 px-3"
                  onClick={() => setFeeChoice(f.value)}
                  data-testid={`preco-forma-${f.value}`}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Taxa usada: {calc.tx.toLocaleString("pt-BR")}%</p>
          </div>
        </div>
        <Field
          id="pc-com"
          label="Comissão (COM)"
          help="preco-com"
          value={commission}
          onChange={setCommission}
          suffix="%"
          testId="preco-input-comissao"
          hint={team && suggestions.commissionAvg != null ? `Média das comissões da equipe: ${toInput(suggestions.commissionAvg) || "0"}%` : undefined}
        />
      </Step>

      <Step n={5} title="Serviço">
        <div className="space-y-1.5">
          <Label>Escolha o serviço</Label>
          <Select value={serviceId} onValueChange={pick}>
            <SelectTrigger className="h-11" data-testid="preco-servico">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.combo ? "Combo: " : ""}
                  {s.name} · {brl(s.price)}
                </SelectItem>
              ))}
              <SelectItem value="manual">Digitar os valores</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pc-dur" label="Duração" value={dur} onChange={setDur} suffix="min" testId="preco-input-duracao" hint={parseNum(dur) > 0 ? fmtDuration(parseNum(dur)) : undefined} />
          <Field
            id="pc-cd"
            label="Custo direto (CD)"
            help="preco-cd"
            value={cd}
            onChange={setCd}
            prefix="R$"
            testId="preco-input-cd"
            hint={picked && picked.cost == null ? "Este serviço ainda não tem custo cadastrado." : undefined}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Custo fixo deste serviço (CF): <strong className="text-foreground" data-testid="preco-cf">{brl(calc.cf)}</strong>
          {!calc.hoursOk && " · informe as horas do mês"}
        </p>
      </Step>

      {/* resultado */}
      <section className="space-y-4 rounded-2xl border-2 border-primary/30 bg-card p-4 md:p-5" aria-label="Resultado" data-testid="preco-resultado">
        <div className="grid grid-cols-2 gap-1 rounded-xl border p-1" role="tablist" aria-label="Modo da calculadora">
          {(
            [
              ["cobrar", "Quanto cobrar?"],
              ["lucro", "Quanto eu lucro?"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              className={cn("h-11 rounded-lg text-sm font-semibold", mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
              onClick={() => setMode(k)}
              data-testid={`preco-modo-${k}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "cobrar" ? (
          <div className="space-y-3">
            <Field id="pc-ml" label="Margem de lucro desejada (ML)" help="preco-ml" value={margin} onChange={setMargin} suffix="%" testId="preco-input-margem" />
            <p className="text-xs text-muted-foreground">
              IMP {calc.imp.toLocaleString("pt-BR")}% + TX {calc.tx.toLocaleString("pt-BR")}% + COM {calc.com.toLocaleString("pt-BR")}% + ML{" "}
              {calc.ml.toLocaleString("pt-BR")}% = <strong>{calc.pcts.toLocaleString("pt-BR")}%</strong>
            </p>
            {calc.pcts >= PCT_WARNING && (
              <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="preco-aviso-inviavel">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                A soma das porcentagens passou de {PCT_WARNING}%: o preço fica alto demais. Reveja a margem, a comissão ou os custos.
              </p>
            )}
            <div className="rounded-xl bg-secondary p-4 text-center">
              <p className="text-sm text-muted-foreground">Preço sugerido</p>
              <p className="font-heading text-4xl" data-testid="preco-sugerido">
                {calc.suggested === null ? "—" : brl(calc.suggested)}
              </p>
              {picked && calc.suggested !== null && (
                <p className="mt-1 text-sm text-muted-foreground">Hoje você cobra {brl(picked.price)}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                (CD {brl(calc.cdn)} + CF {brl(calc.cf)}) ÷ (1 − {calc.pcts.toLocaleString("pt-BR")}%)
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field id="pc-preco" label="Preço de venda" value={price} onChange={setPrice} prefix="R$" testId="preco-input-preco" />
            <dl className="space-y-1 text-sm">
              {(
                [
                  ["Custo direto (CD)", calc.profit.cd],
                  ["Custo fixo (CF)", calc.profit.cf],
                  [`Impostos (${calc.imp.toLocaleString("pt-BR")}%)`, calc.profit.imp],
                  [`Taxa (${calc.tx.toLocaleString("pt-BR")}%)`, calc.profit.tx],
                  [`Comissão (${calc.com.toLocaleString("pt-BR")}%)`, calc.profit.com],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{brl(v)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t pt-1 font-semibold">
                <dt>Custo real</dt>
                <dd data-testid="preco-custo-real">{brl(calc.profit.cost)}</dd>
              </div>
            </dl>
            <div className={cn("rounded-xl border p-4 text-center", LIGHT_CLASS[calc.light])} data-testid={`preco-semaforo-${calc.light}`}>
              <p className="text-sm font-semibold">{LIGHT_LABEL[calc.light]}</p>
              <p className="font-heading text-3xl" data-testid="preco-lucro">{brl(calc.profit.profit)}</p>
              <p className="text-sm">
                {calc.profit.profitPct === null ? "Informe o preço" : `${calc.profit.profitPct.toLocaleString("pt-BR")}% do preço`}
              </p>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">Este cálculo é uma estimativa. Para impostos, confirme com seu contador.</p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="h-12 flex-1" disabled={saving} onClick={save} data-testid="btn-salvar-calculadora">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Salvar configurações
          </Button>
          {picked && (
            <Button
              variant="outline"
              className="h-12 flex-1"
              disabled={applying || !costChanged}
              onClick={applyCost}
              data-testid="btn-usar-custo-servico"
            >
              {applying && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Usar este custo no serviço
            </Button>
          )}
        </div>
        {picked && !costChanged && <p className="text-center text-xs text-muted-foreground">O custo direto é igual ao do cadastro.</p>}
      </section>
    </div>
  );
}
