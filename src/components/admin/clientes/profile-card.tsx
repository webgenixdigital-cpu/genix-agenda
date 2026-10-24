"use client";

import { useState, useTransition } from "react";
import { ClipboardList, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateCustomerProfile } from "@/app/admin/(painel)/clientes/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ProfileField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  options: string[];
  help: string | null;
};

const EMPTY = "__vazio__";

export function ProfileCard({
  customerId,
  nicheName,
  fields,
  profile,
}: {
  customerId: string;
  nicheName: string;
  fields: ProfileField[];
  profile: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});

  const filled = fields.filter((f) => profile[f.key]);

  function openDialog() {
    setValues(Object.fromEntries(fields.map((f) => [f.key, profile[f.key] ?? ""])));
    setOpen(true);
  }

  function save() {
    start(async () => {
      const r = await updateCustomerProfile(customerId, values);
      if (!r) return; // demonstração
      if (r.ok) {
        toast.success("Ficha técnica salva");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  return (
    <section className="rounded-2xl border bg-card p-5" data-testid="ficha-tecnica">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl">
            <ClipboardList className="h-5 w-5 text-primary" /> Ficha técnica
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{nicheName}</p>
        </div>
        <Button variant="outline" className="h-10" onClick={openDialog} data-testid="btn-editar-ficha">
          <Pencil className="mr-1.5 h-4 w-4" /> {filled.length ? "Editar" : "Preencher"}
        </Button>
      </div>

      {filled.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nada preenchido ainda. Anote aqui o que ajuda no próximo atendimento.</p>
      ) : (
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {filled.map((f) => (
            <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 whitespace-pre-line">{profile[f.key]}</dd>
            </div>
          ))}
        </dl>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Ficha técnica</DialogTitle>
            <DialogDescription>Não registre informações de saúde (alergias, doenças, medicamentos, gestação).</DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`pf-${f.key}`}>{f.label}</Label>
                {f.type === "select" ? (
                  <Select
                    value={values[f.key] || EMPTY}
                    onValueChange={(v) => setValues({ ...values, [f.key]: v === EMPTY ? "" : v })}
                  >
                    <SelectTrigger id={`pf-${f.key}`} className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY}>Não informado</SelectItem>
                      {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : f.type === "textarea" ? (
                  <Textarea id={`pf-${f.key}`} rows={3} value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value.slice(0, 1000) })} />
                ) : (
                  <Input id={`pf-${f.key}`} className="h-11" value={values[f.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value.slice(0, 200) })} />
                )}
                {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
              </div>
            ))}

            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-ficha">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar ficha"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
