"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveService } from "@/app/admin/(painel)/servicos/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { duration } from "@/lib/format";

export type EditableService = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  duration_min: number;
};

const DURATIONS = [10, 15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300];

/** "12345" → "123,45" (digita só números, vírgula automática) */
function maskMoney(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const cents = Number(digits || "0");
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const parseMoney = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  service: EditableService | null;   // null = novo
  categories: string[];
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("0,00");
  const [dur, setDur] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);

  // preenche o formulário ao abrir
  if (open && loadedId !== (service?.id ?? null)) {
    setLoadedId(service?.id ?? null);
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setCategory(service?.category ?? "");
    setPrice(maskMoney(String(Math.round((service?.price ?? 0) * 100))));
    setDur(String(service?.duration_min ?? 60));
    setError(null);
  }
  if (!open && loadedId !== undefined) setLoadedId(undefined);

  const durations = DURATIONS.includes(Number(dur)) ? DURATIONS : [...DURATIONS, Number(dur)].sort((a, b) => a - b);

  function submit() {
    setError(null);
    start(async () => {
      const r = await saveService({
        id: service?.id,
        name,
        description,
        category,
        price: parseMoney(price),
        duration_min: Number(dur),
      });
      if (r.ok) {
        toast.success(service ? "Serviço atualizado" : "Serviço criado");
        onOpenChange(false);
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>Aparece na sua vitrine com preço e duração.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sv-name">Nome</Label>
            <Input id="sv-name" className="h-11" value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} data-testid="input-servico-nome" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sv-cat">Categoria</Label>
            <Input
              id="sv-cat"
              className="h-11"
              list="service-categories"
              placeholder="Cabelo, Unhas, Facial..."
              value={category}
              onChange={(e) => setCategory(e.target.value.slice(0, 40))}
              data-testid="input-servico-categoria"
            />
            <datalist id="service-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sv-price">Preço</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                <Input
                  id="sv-price"
                  className="h-11 pl-9"
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(maskMoney(e.target.value))}
                  data-testid="input-servico-preco"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Duração</Label>
              <Select value={dur} onValueChange={setDur}>
                <SelectTrigger className="h-11" data-testid="select-servico-duracao"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {durations.map((d) => <SelectItem key={d} value={String(d)}>{duration(d)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sv-desc">Descrição (opcional)</Label>
            <Textarea id="sv-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} />
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-servico">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}