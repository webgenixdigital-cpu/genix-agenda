"use client";

// "Custo deste serviço (opcional)" (69): seção recolhível do diálogo de serviço e de combo.
// Serviço: material/produtos + outros custos diretos. Combo: soma dos itens (calculada)
// ou "Usar outro valor". Mostra o total e a margem sobre o preço. Só a matriz vê
// (a página de Serviços é só da matriz e da demo). Sem o plano: cadeado.
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Ajuda } from "@/components/ajuda";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planNote } from "@/content/planos";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "12345" → "123,45" (digita só números, vírgula automática); "" = não informado */
export function maskCost(raw: string) {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, 7);
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** "" → null; "1.234,56" → 1234.56 */
export const parseCost = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\./g, "").replace(",", ".")) || 0);
export const costInput = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function MoneyField({ id, label, value, onChange, testId }: { id: string; label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
        <Input
          id={id}
          className="h-11 pl-9"
          inputMode="numeric"
          placeholder="—"
          value={value}
          onChange={(e) => onChange(maskCost(e.target.value))}
          data-testid={testId}
        />
      </div>
    </div>
  );
}

export function CostSection({
  allowed,
  price,
  mode,
  material,
  other,
  onMaterial,
  onOther,
  itemsCost,
  useOverride,
  onUseOverride,
  override,
  onOverride,
}: {
  /** plano libera o custo (a partir do Básico) */
  allowed: boolean;
  /** preço de venda para a margem */
  price: number;
  mode: "servico" | "combo";
  material?: string;
  other?: string;
  onMaterial?: (v: string) => void;
  onOther?: (v: string) => void;
  /** combo: soma do custo dos serviços (null = algum sem custo) */
  itemsCost?: number | null;
  useOverride?: boolean;
  onUseOverride?: (v: boolean) => void;
  override?: string;
  onOverride?: (v: string) => void;
}) {
  const initialOpen =
    mode === "servico" ? !!(material || other) : !!useOverride;
  const [open, setOpen] = useState(initialOpen);

  const total =
    mode === "servico"
      ? material || other
        ? (parseCost(material ?? "") ?? 0) + (parseCost(other ?? "") ?? 0)
        : null
      : useOverride
        ? parseCost(override ?? "")
        : itemsCost ?? null;
  const margin = total !== null ? price - total : null;
  const marginPct = margin !== null && price > 0 ? Math.round((margin / price) * 1000) / 10 : null;

  return (
    <div className="rounded-xl border" data-testid="secao-custo-servico">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="btn-abrir-custo-servico"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          {!allowed && <Lock className="h-4 w-4 text-primary" aria-hidden />}
          <span>Custo deste serviço (opcional)</span>
          {total !== null && allowed && <span className="whitespace-nowrap font-normal text-muted-foreground">· {brl(total)}</span>}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="space-y-3 border-t p-3">
          {!allowed ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Cadastre quanto gasta de material em cada atendimento e veja no Financeiro quanto sobra de verdade.{" "}
                {planNote("custo")}
              </p>
              <Link href="/admin/assinatura" className="tap-target font-semibold text-primary underline" data-testid="link-custo-planos">
                Ver planos
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>Só a matriz vê o custo. Aluguel, luz e internet vão na Calculadora de preço.</span>
                <Ajuda id="custo-servico" />
                <Ajuda id="preco-de-venda" />
              </div>

              {mode === "servico" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MoneyField id="sv-cost-mat" label="Material e produtos" value={material ?? ""} onChange={onMaterial ?? (() => {})} testId="input-custo-material" />
                  <MoneyField id="sv-cost-other" label="Outros custos diretos" value={other ?? ""} onChange={onOther ?? (() => {})} testId="input-custo-outros" />
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">
                    Custo dos serviços do combo:{" "}
                    <strong data-testid="combo-custo-itens">{itemsCost == null ? "falta cadastrar em algum serviço" : brl(itemsCost)}</strong>
                  </p>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#99582A]"
                      checked={!!useOverride}
                      onChange={(e) => onUseOverride?.(e.target.checked)}
                      data-testid="check-combo-custo-proprio"
                    />
                    Usar outro valor para o combo
                  </label>
                  {useOverride && (
                    <MoneyField id="combo-cost" label="Custo do combo" value={override ?? ""} onChange={onOverride ?? (() => {})} testId="input-custo-combo" />
                  )}
                </div>
              )}

              <p className="flex flex-wrap justify-between gap-x-3 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="custo-resumo">
                <span>Custo: <strong>{total === null ? "—" : brl(total)}</strong></span>
                <span>
                  Sobra:{" "}
                  <strong className={cn(margin !== null && margin < 0 && "text-destructive")}>
                    {margin === null ? "—" : `${brl(margin)}${marginPct !== null ? ` (${marginPct.toLocaleString("pt-BR")}%)` : ""}`}
                  </strong>
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                “Sobra” é o preço menos o custo direto. Impostos, taxas, comissão e custos fixos entram na Calculadora de preço.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
