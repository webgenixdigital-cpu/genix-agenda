"use client";

import { Ajuda } from "@/components/ajuda";
import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteService, saveCombo, toggleService } from "@/app/admin/(painel)/servicos/actions";
import { CostSection, costInput, parseCost } from "@/components/admin/servicos/cost-section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { brl, duration } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ComboService = {
  id: string;
  name: string;
  price: number;
  duration_min: number;
  active: boolean;
  /** 69: custo direto do serviço (null = não informado) */
  cost?: number | null;
};
export type ComboRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  duration_min: number;
  active: boolean;
  bookable_online: boolean;
  show_in_catalog: boolean;
  /** serviços do combo, na ordem */
  serviceIds: string[];
  /** 69: custo próprio do combo (null = soma dos serviços) */
  cost_override?: number | null;
};

const MAX = 6;

/** Valor normal (soma dos serviços) e avisos do combo */
function comboState(c: Pick<ComboRow, "price" | "serviceIds">, services: ComboService[]) {
  const list = c.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) as ComboService[];
  const normal = list.reduce((s, x) => s + x.price, 0);
  const warnings: string[] = [];
  const off = list.filter((s) => !s.active);
  if (off.length) warnings.push(`${off.map((s) => s.name).join(", ")} ${off.length === 1 ? "está desativado" : "estão desativados"}`);
  if (list.length < 2) warnings.push("Combo com menos de 2 serviços: edite para escolher os serviços");
  if (list.length >= 2 && c.price > normal) warnings.push(`O preço do combo está acima do valor normal (${brl(normal)})`);
  return { list, normal, warnings };
}

export function CombosManager({
  combos,
  services,
  costAllowed = false,
}: {
  combos: ComboRow[];
  services: ComboService[];
  costAllowed?: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ComboRow | null>(null);

  function toggle(id: string, field: "active" | "bookable_online" | "show_in_catalog", value: boolean) {
    start(async () => {
      const r = await toggleService(id, field, value);
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) toast.error(r.error);
    });
  }

  function remove(c: ComboRow) {
    if (!confirm(`Excluir o combo "${c.name}"? Os agendamentos antigos continuam no histórico.`)) return;
    start(async () => {
      const r = await deleteService(c.id);
      if (!r) return;
      if (r.ok) toast.success("Combo excluído");
      else toast.error(r.error);
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="combos">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="combos" className="text-2xl">Combos <Ajuda id="combos" className="-ml-2" /></h2>
          <p className="text-sm text-muted-foreground">Serviços juntos com preço especial, agendados como um só.</p>
        </div>
        <Button
          className="h-11"
          disabled={services.filter((s) => s.active).length < 2}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          data-testid="btn-novo-combo"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Novo combo
        </Button>
      </div>

      {combos.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white p-6 text-center text-sm text-muted-foreground">
          Nenhum combo ainda. Exemplo: “Corte + Barba” por um preço menor que os dois separados.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {combos.map((c) => {
            const { list, normal, warnings } = comboState(c, services);
            const saving = normal - c.price;
            return (
              <li key={c.id} className={cn("p-4 md:p-5", !c.active && "bg-stone-50")} data-testid={`combo-${c.id}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-semibold", !c.active && "text-muted-foreground line-through")}>{c.name}</p>
                    <p className="text-sm">
                      {saving > 0 && <span className="text-muted-foreground line-through">{brl(normal)}</span>}{" "}
                      <strong>{brl(c.price)}</strong>
                      <span className="text-muted-foreground"> · {duration(c.duration_min)}</span>
                      {saving > 0 && <span className="text-green-700"> · economia de {brl(saving)}</span>}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{list.map((s) => s.name).join(" + ")}</p>
                    {warnings.map((w) => (
                      <p key={w} className="mt-2 flex gap-1.5 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={`Editar ${c.name}`}
                    onClick={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                    data-testid={`btn-editar-combo-${c.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-muted-foreground hover:bg-red-50 hover:text-destructive"
                    aria-label={`Excluir ${c.name}`}
                    disabled={pending}
                    onClick={() => remove(c)}
                    data-testid={`btn-excluir-combo-${c.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
                  <Toggle label="Ativo" checked={c.active} onChange={(v) => toggle(c.id, "active", v)} testId={`switch-ativo-combo-${c.id}`} />
                  <Toggle
                    label="Agendamento online"
                    checked={c.bookable_online}
                    disabled={!c.active}
                    onChange={(v) => toggle(c.id, "bookable_online", v)}
                    testId={`switch-online-combo-${c.id}`}
                  />
                  <Toggle
                    label="No catálogo"
                    checked={c.show_in_catalog}
                    disabled={!c.active}
                    onChange={(v) => toggle(c.id, "show_in_catalog", v)}
                    testId={`switch-catalogo-combo-${c.id}`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ComboDialog open={open} onOpenChange={setOpen} combo={editing} services={services} costAllowed={costAllowed} />
    </section>
  );
}

function ComboDialog({
  open,
  onOpenChange,
  combo,
  services,
  costAllowed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  combo: ComboRow | null;
  services: ComboService[];
  costAllowed: boolean;
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [useOverride, setUseOverride] = useState(false);
  const [override, setOverride] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);

  // abre sempre com os dados do combo (ou vazio, no novo)
  const key = open ? combo?.id ?? null : undefined;
  if (key !== loadedFor) {
    setLoadedFor(key);
    if (open) {
      setSelected(combo?.serviceIds ?? []);
      setName(combo?.name ?? "");
      setNameTouched(!!combo);
      setPrice(combo ? String(combo.price).replace(".", ",") : "");
      setDescription(combo?.description ?? "");
      setUseOverride(combo?.cost_override != null);
      setOverride(costInput(combo?.cost_override));
    }
  }

  // o que pode ser escolhido: ativos + os que já estão no combo
  const options = services.filter((s) => s.active || selected.includes(s.id));
  const chosen = selected.map((id) => services.find((s) => s.id === id)).filter(Boolean) as ComboService[];
  const normal = chosen.reduce((s, x) => s + x.price, 0);
  const total = chosen.reduce((s, x) => s + x.duration_min, 0);
  // "1.234,56" ou "80,5" (vírgula decimal) e também "80.5"
  const value = Number(price.includes(",") ? price.replace(/\./g, "").replace(",", ".") : price);
  const hasPrice = price.trim() !== "" && Number.isFinite(value);
  const tooHigh = hasPrice && value > normal;
  const equal = hasPrice && chosen.length >= 2 && Math.abs(value - normal) < 0.005;
  const suggested = chosen.map((s) => s.name).join(" + ");
  // 69: custo do combo = soma dos serviços (null se algum não tiver custo)
  const itemsCost = chosen.length && chosen.every((s) => s.cost != null) ? chosen.reduce((t, s) => t + (s.cost ?? 0), 0) : null;

  function pick(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < MAX ? [...selected, id] : selected;
    if (next === selected && !selected.includes(id)) toast.error(`No máximo ${MAX} serviços por combo.`);
    setSelected(next);
    if (!nameTouched) {
      setName(next.map((x) => services.find((s) => s.id === x)?.name).filter(Boolean).join(" + "));
    }
  }

  function save() {
    if (chosen.length < 2) return void toast.error("Escolha pelo menos 2 serviços.");
    if (!hasPrice) return void toast.error("Informe o preço especial.");
    if (tooHigh) return void toast.error("O preço do combo não pode ser maior que o valor normal.");
    start(async () => {
      const r = await saveCombo({
        id: combo?.id,
        name: name.trim() || suggested,
        description,
        category: combo?.category ?? "",
        price: value,
        serviceIds: selected,
        // 69: só manda o custo quando mudou
        costOverride:
          costAllowed && (useOverride ? parseCost(override) : null) !== (combo?.cost_override ?? null)
            ? useOverride
              ? parseCost(override)
              : null
            : undefined,
      });
      if (!r) return; // demonstração: o servidor redirecionou
      if (!r.ok) return void toast.error(r.error);
      toast.success(combo ? "Combo salvo" : "Combo criado");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{combo ? "Editar combo" : "Novo combo"}</DialogTitle>
          <DialogDescription>Escolha de 2 a {MAX} serviços e defina o preço especial.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Serviços do combo</legend>
            <ul className="divide-y rounded-xl border">
              {options.map((s) => {
                const on = selected.includes(s.id);
                return (
                  <li key={s.id}>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => pick(s.id)}
                        className="h-5 w-5 accent-[#99582A]"
                        data-testid={`combo-servico-${s.id}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-semibold", !s.active && "text-muted-foreground line-through")}>
                          {s.name}
                        </span>
                        <span className="text-xs text-muted-foreground">{duration(s.duration_min)}</span>
                      </span>
                      <span className="shrink-0 text-sm">{brl(s.price)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="combo-nome">Nome</Label>
            <Input
              id="combo-nome"
              value={name}
              maxLength={80}
              placeholder={suggested || "Ex.: Corte + Barba"}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              className="h-11"
              data-testid="input-nome-combo"
            />
          </div>

          <div className="rounded-xl bg-secondary/60 p-3 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Valor normal</span>
              <strong data-testid="combo-valor-normal">{brl(normal)}</strong>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Duração</span>
              <span>{total ? duration(total) : "—"}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="combo-preco">Preço especial (R$)</Label>
            <Input
              id="combo-preco"
              inputMode="decimal"
              placeholder="0,00"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d,.]/g, ""))}
              className={cn("h-11", tooHigh && "border-destructive")}
              data-testid="input-preco-combo"
            />
            {tooHigh && <p className="text-sm text-destructive">Não pode ser maior que o valor normal ({brl(normal)}).</p>}
            {equal && <p className="text-sm text-amber-800">O preço é igual ao valor normal: o cliente não vê economia.</p>}
            {hasPrice && !tooHigh && !equal && chosen.length >= 2 && (
              <p className="text-sm text-green-700">Economia de {brl(normal - value)} para o cliente.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="combo-descricao">Descrição (opcional)</Label>
            <Textarea
              id="combo-descricao"
              value={description}
              maxLength={300}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-descricao-combo"
            />
          </div>

          <CostSection
            allowed={costAllowed}
            price={hasPrice ? value : 0}
            mode="combo"
            itemsCost={itemsCost}
            useOverride={useOverride}
            onUseOverride={setUseOverride}
            override={override}
            onOverride={setOverride}
          />

          {total > 600 && (
            <p className="text-sm text-destructive">A soma das durações passa de 10 horas. Tire algum serviço.</p>
          )}

          <Button className="h-12 w-full" disabled={pending || total > 600} onClick={save} data-testid="btn-salvar-combo">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {combo ? "Salvar combo" : "Criar combo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Toggle(props: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-2", props.disabled && "cursor-not-allowed opacity-50")}>
      <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} data-testid={props.testId} />
      {props.label}
    </label>
  );
}
