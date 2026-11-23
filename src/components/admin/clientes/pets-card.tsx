"use client";

import { Ajuda } from "@/components/ajuda";
import { useState, useTransition } from "react";
import { ReadOnlyLink, usePlanFlags } from "@/components/admin/plan-flags";
import { Archive, Loader2, PawPrint, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { archivePet, deletePet, savePet } from "@/app/admin/(painel)/clientes/pet-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PET_BEHAVIORS,
  PET_COAT_CONDITIONS,
  PET_COAT_TYPES,
  PET_SEXES,
  PET_SIZES,
  PET_SPECIES,
  labelOf,
  type Pet,
  type PetInput,
} from "@/lib/pets";

const EMPTY = "__vazio__";

const blank: PetInput = {
  name: "", species: "cao", breed: "", sex: "", birthDate: "", size: "", weightKg: "",
  coatType: "", coatCondition: "", neutered: "", behavior: [], fixedNotes: "",
};

function toInput(p: Pet): PetInput {
  return {
    name: p.name,
    species: p.species,
    breed: p.breed ?? "",
    sex: p.sex ?? "",
    birthDate: p.birth_date ?? "",
    size: p.size ?? "",
    weightKg: p.weight_kg != null ? String(p.weight_kg).replace(".", ",") : "",
    coatType: p.coat_type ?? "",
    coatCondition: p.coat_condition ?? "",
    neutered: p.neutered == null ? "" : p.neutered ? "sim" : "nao",
    behavior: p.behavior ?? [],
    fixedNotes: p.fixed_notes ?? "",
  };
}

/** Select com opção "Não informado" (valor vazio) */
function OptSelect({ id, value, onChange, options }: {
  id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || EMPTY} onValueChange={(v) => onChange(v === EMPTY ? "" : v)}>
      <SelectTrigger id={id} className="h-11" data-testid={id}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY}>Não informado</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const asOptions = (list: string[]) => list.map((v) => ({ value: v, label: v }));

export function PetsCard({ customerId, pets, canDelete }: { customerId: string; pets: Pet[]; canDelete: boolean }) {
  const { readOnly } = usePlanFlags();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pet | null>(null);
  const [values, setValues] = useState<PetInput>(blank);
  const [pending, start] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);

  const active = pets.filter((p) => p.active);
  const set = (patch: Partial<PetInput>) => setValues((v) => ({ ...v, ...patch }));

  function openNew() {
    setEditing(null);
    setValues(blank);
    setConfirmDel(false);
    setOpen(true);
  }
  function openEdit(p: Pet) {
    setEditing(p);
    setValues(toInput(p));
    setConfirmDel(false);
    setOpen(true);
  }

  function save() {
    start(async () => {
      const r = await savePet(customerId, editing?.id ?? null, values);
      if (!r) return; // demonstração
      if (r.ok) {
        toast.success(editing ? "Pet atualizado" : "Pet cadastrado");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  function archive() {
    if (!editing) return;
    start(async () => {
      const r = await archivePet(customerId, editing.id);
      if (!r) return;
      if (r.ok) {
        toast.success("Pet arquivado");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  function remove() {
    if (!editing) return;
    if (!confirmDel) {
      setConfirmDel(true); // 1º toque só pede confirmação
      return;
    }
    start(async () => {
      const r = await deletePet(customerId, editing.id);
      if (!r) return;
      if (r.ok) {
        toast.success("Pet excluído");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  return (
    <section className="rounded-2xl border bg-card p-5" data-testid="card-pets">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-2xl">
          <PawPrint className="h-5 w-5 text-primary" /> Pets
          <Ajuda id="pets" className="-ml-2" />
        </h2>
        {readOnly ? (
          <ReadOnlyLink label="Adicionar pet" testid="btn-adicionar-pet-travado" />
        ) : (
          <Button variant="outline" className="h-10" onClick={openNew} data-testid="btn-adicionar-pet">
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar pet
          </Button>
        )}
      </div>

      {active.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhum pet cadastrado. Adicione os pets deste tutor.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {active.map((p) => {
            const info = [
              labelOf(PET_SPECIES, p.species),
              p.breed,
              labelOf(PET_SIZES, p.size).split(" (")[0],
              p.weight_kg != null ? `${String(p.weight_kg).replace(".", ",")} kg` : null,
            ].filter(Boolean).join(" · ");
            const coat = [p.coat_type, p.coat_condition && p.coat_condition !== "Normal" ? p.coat_condition : null]
              .filter(Boolean).join(" · ");
            return (
              <li key={p.id} className="rounded-xl bg-secondary p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    {info && <p className="text-sm text-muted-foreground">{info}</p>}
                    {coat && <p className="text-sm text-muted-foreground">Pelagem: {coat}</p>}
                  </div>
                  {!readOnly && (
                    <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => openEdit(p)}
                      aria-label={`Editar ${p.name}`} data-testid="btn-editar-pet">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {p.behavior.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.behavior.map((b) => (
                      <span key={b} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium">{b}</span>
                    ))}
                  </div>
                )}
                {p.fixed_notes && <p className="mt-2 whitespace-pre-line text-sm">{p.fixed_notes}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">{editing ? `Editar ${editing.name}` : "Novo pet"}</DialogTitle>
            <DialogDescription>Não registre informações de saúde (doenças, remédios, alergias).</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            {/* PARTE 1 — Identificação */}
            <div className="space-y-1.5">
              <Label htmlFor="pet-nome">Nome</Label>
              <Input id="pet-nome" className="h-11" value={values.name} maxLength={60}
                onChange={(e) => set({ name: e.target.value })} data-testid="pet-nome" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pet-especie">Espécie</Label>
                <Select value={values.species} onValueChange={(v) => set({ species: v })}>
                  <SelectTrigger id="pet-especie" className="h-11" data-testid="pet-especie"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PET_SPECIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-raca">Raça</Label>
                <Input id="pet-raca" className="h-11" value={values.breed} maxLength={60}
                  onChange={(e) => set({ breed: e.target.value })} data-testid="pet-raca" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-sexo">Sexo</Label>
                <OptSelect id="pet-sexo" value={values.sex} onChange={(v) => set({ sex: v })} options={[...PET_SEXES]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-castrado">Castrado</Label>
                <OptSelect id="pet-castrado" value={values.neutered} onChange={(v) => set({ neutered: v })}
                  options={[{ value: "sim", label: "Sim" }, { value: "nao", label: "Não" }]} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pet-nascimento">Nascimento</Label>
                <Input id="pet-nascimento" type="date" className="h-11" value={values.birthDate}
                  onChange={(e) => set({ birthDate: e.target.value })} data-testid="pet-nascimento" />
              </div>
            </div>

            {/* PARTE 2 — Porte e pelagem (definem tempo e preço do serviço) */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pet-porte">Porte</Label>
                <OptSelect id="pet-porte" value={values.size} onChange={(v) => set({ size: v })} options={[...PET_SIZES]} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-peso">Peso (kg)</Label>
                <Input id="pet-peso" inputMode="decimal" className="h-11" placeholder="ex.: 8,5" value={values.weightKg}
                  onChange={(e) => set({ weightKg: e.target.value.replace(/[^\d,.]/g, "").slice(0, 6) })} data-testid="pet-peso" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-pelagem">Tipo de pelagem</Label>
                <OptSelect id="pet-pelagem" value={values.coatType} onChange={(v) => set({ coatType: v })} options={asOptions(PET_COAT_TYPES)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pet-estado-pelagem">Estado da pelagem</Label>
                <OptSelect id="pet-estado-pelagem" value={values.coatCondition} onChange={(v) => set({ coatCondition: v })}
                  options={asOptions(PET_COAT_CONDITIONS)} />
              </div>
            </div>

            {/* PARTE 3 — Comportamento e observações */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Comportamento</legend>
              <div className="flex flex-wrap gap-2">
                {PET_BEHAVIORS.map((b) => {
                  const on = values.behavior.includes(b);
                  return (
                    <button key={b} type="button" aria-pressed={on}
                      onClick={() => set({ behavior: on ? values.behavior.filter((x) => x !== b) : [...values.behavior, b] })}
                      className={`min-h-11 rounded-full border px-4 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-white"}`}
                      data-testid="pet-comportamento">
                      {b}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="pet-obs">Observações fixas</Label>
              <Textarea id="pet-obs" rows={3} value={values.fixedNotes} placeholder="ex.: não cortar o bigode, laço azul"
                onChange={(e) => set({ fixedNotes: e.target.value.slice(0, 500) })} data-testid="pet-obs" />
            </div>

            <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-pet">
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : editing ? "Salvar alterações" : "Cadastrar pet"}
            </Button>

            {editing && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-11 flex-1" disabled={pending} onClick={archive}
                  data-testid="btn-arquivar-pet">
                  <Archive className="mr-1.5 h-4 w-4" /> Arquivar
                </Button>
                {canDelete && (
                  <Button type="button" variant="outline" className="h-11 flex-1 text-destructive" disabled={pending} onClick={remove}
                    data-testid="btn-excluir-pet">
                    <Trash2 className="mr-1.5 h-4 w-4" /> {confirmDel ? "Toque de novo para excluir" : "Excluir"}
                  </Button>
                )}
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
