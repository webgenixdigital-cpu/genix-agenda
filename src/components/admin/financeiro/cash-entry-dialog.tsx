"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addCashEntry, type CashInput } from "@/app/admin/(painel)/financeiro/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORY_LABEL, METHOD_LABEL } from "@/lib/cash";

function maskMoney(raw: string) {
  const cents = Number(raw.replace(/\D/g, "").slice(0, 9) || "0");
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const parseMoney = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;

export function CashEntryDialog({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [pending, start] = useTransition();

  const [kind, setKind] = useState<CashInput["kind"]>("income");
  const [category, setCategory] = useState<CashInput["category"]>("atendimento");
  const [method, setMethod] = useState<CashInput["method"]>("pix");
  const [amount, setAmount] = useState("0,00");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setKind("income");
    setCategory("atendimento");
    setMethod("pix");
    setAmount("0,00");
    setDescription("");
    setDate(defaultDate);
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await addCashEntry({ kind, category, method, amount: parseMoney(amount), description, date });
      if (r.ok) {
        toast.success(kind === "income" ? "Entrada lançada" : "Saída lançada");
        setOpen(false);
      } else setError(r.error);
    });
  }

  return (
    <>
      <Button className="h-11" onClick={openDialog} data-testid="btn-novo-lancamento">
        <Plus className="mr-1.5 h-4 w-4" /> Novo lançamento
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Novo lançamento</DialogTitle>
            <DialogDescription>Entradas e saídas que não vieram da agenda.</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Tabs
              value={kind}
              onValueChange={(v) => {
                setKind(v as CashInput["kind"]);
                setCategory(v === "income" ? "atendimento" : "produtos");
              }}
            >
              <TabsList className="grid h-11 w-full grid-cols-2">
                <TabsTrigger value="income" className="h-9" data-testid="tab-entrada">Entrada</TabsTrigger>
                <TabsTrigger value="expense" className="h-9" data-testid="tab-saida">Saída</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-1.5">
              <Label htmlFor="cx-amount">Valor</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                <Input
                  id="cx-amount"
                  className="h-12 pl-10 text-lg font-semibold"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(maskMoney(e.target.value))}
                  data-testid="input-valor-lancamento"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as CashInput["category"])}>
                  <SelectTrigger className="h-11" data-testid="select-categoria-lancamento"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CATEGORY_LABEL) as CashInput["category"][]).map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Forma de pagamento</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as CashInput["method"])}>
                  <SelectTrigger className="h-11" data-testid="select-metodo-lancamento"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(METHOD_LABEL) as CashInput["method"][]).map((m) => (
                      <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Data</Label>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="h-11 w-full justify-start gap-2 font-normal">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {format(parseISO(date), "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={ptBR}
                    selected={parseISO(date)}
                    onSelect={(d) => {
                      if (!d) return;
                      setDate(format(d, "yyyy-MM-dd"));
                      setCalOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cx-desc">Descrição (opcional)</Label>
              <Input
                id="cx-desc"
                className="h-11"
                placeholder={kind === "income" ? "Venda de produto, atendimento avulso..." : "Conta de luz, reposição..."}
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 120))}
              />
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-lancamento">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar lançamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}