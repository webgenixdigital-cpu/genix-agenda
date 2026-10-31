"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveProfessional } from "@/app/admin/(painel)/profissionais/actions";
import { PhotoUpload, removeUploaded } from "@/components/admin/photo/photo-upload";
import { confirmTeamBilling } from "@/components/admin/profissionais/billing-confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type EditablePro = {
  id: string;
  name: string;
  role: string | null;
  bio: string | null;
  photo_url: string | null;
  specialties: string[];
  commission_pct: number;
  is_partner: boolean;    // salão-parceiro
  serviceIds: string[];   // vazio = faz todos
};

type ServiceOption = { id: string; name: string; category: string | null };

export function ProfessionalDialog({
  open,
  pro,
  services,
  partnerSalon = false,
  businessId,
  readOnly = false,
  teamFeatures = true,
  onOpenChange: setOpen,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pro: EditablePro | null;
  services: ServiceOption[];
  partnerSalon?: boolean;
  businessId: string;
  /** demonstração: envio de foto abre o convite */
  readOnly?: boolean;
  /** plano Equipe: comissão e salão-parceiro */
  teamFeatures?: boolean;
}) {
  // foto enviada neste diálogo e ainda não salva: apagada se for trocada ou se fechar sem salvar
  const unsaved = useRef<string[]>([]);
  const discardUnsaved = () => {
    const paths = unsaved.current;
    unsaved.current = [];
    void removeUploaded(paths);
  };
  const onOpenChange = (o: boolean) => {
    if (!o) discardUnsaved();
    setOpen(o);
  };
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [commission, setCommission] = useState("0");
  const [isPartner, setIsPartner] = useState(false);
  const [allServices, setAllServices] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined);

  // preenche o formulário ao abrir
  if (open && loadedId !== (pro?.id ?? null)) {
    setLoadedId(pro?.id ?? null);
    setName(pro?.name ?? "");
    setRole(pro?.role ?? "");
    setBio(pro?.bio ?? "");
    setPhoto(pro?.photo_url ?? "");
    setSpecialties((pro?.specialties ?? []).join(", "));
    setCommission(String(pro?.commission_pct ?? 0));
    setIsPartner(pro?.is_partner ?? false);
    setAllServices(!pro || pro.serviceIds.length === 0);
    setSelected(pro?.serviceIds ?? []);
    setError(null);
  }
  if (!open && loadedId !== undefined) setLoadedId(undefined);

  function submit() {
    setError(null);
    start(async () => {
      // cadastro novo nasce ativo: aviso do profissional extra
      let ack: number | null = null;
      if (!pro) {
        const billing = await confirmTeamBilling(1);
        if (!billing?.proceed) return;
        ack = billing.ack;
      }
      const r = await saveProfessional({
        id: pro?.id,
        name,
        role,
        bio,
        photo_url: photo,
        specialties: specialties.split(","),
        commission_pct: Number(commission.replace(",", ".")) || 0,
        is_partner: isPartner,
        allServices,
        serviceIds: selected,
      }, ack);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) {
        toast.success(pro ? "Profissional atualizado" : "Profissional cadastrado");
        unsaved.current = []; // a foto nova agora está salva
        onOpenChange(false);
      } else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">{pro ? "Editar profissional" : "Novo profissional"}</DialogTitle>
          <DialogDescription>Aparece na vitrine e pode receber agendamentos.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">Nome</Label>
              <Input id="pf-name" className="h-11" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} data-testid="input-profissional-nome" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-role">Cargo</Label>
              <Input id="pf-role" className="h-11" placeholder="Cabeleireira, Barbeiro..." value={role} onChange={(e) => setRole(e.target.value.slice(0, 40))} data-testid="input-profissional-cargo" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-bio">Bio curta (aparece na vitrine)</Label>
            <Textarea id="pf-bio" rows={2} value={bio} onChange={(e) => setBio(e.target.value.slice(0, 200))} />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Foto (opcional)</p>
            <PhotoUpload
              kind="profissional"
              businessId={businessId}
              value={photo}
              readOnly={readOnly}
              help="Uma foto de rosto, de frente e com boa luz. Nós ajustamos o tamanho automaticamente."
              onUploaded={(url, paths) => {
                discardUnsaved();
                unsaved.current = paths;
                setPhoto(url);
              }}
              onRemove={() => {
                discardUnsaved();
                setPhoto("");
              }}
              onLinkChange={setPhoto}
              testid="foto-profissional"
            />
          </div>

          <div className={cn("grid gap-3", teamFeatures && "sm:grid-cols-[1fr_120px]")}>
            <div className="space-y-1.5">
              <Label htmlFor="pf-spec">Especialidades (separe por vírgula)</Label>
              <Input id="pf-spec" className="h-11" placeholder="Cortes, Coloração" value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
            </div>
            {/* comissão: recurso do plano Equipe (fora dele, o valor salvo fica como está) */}
            {teamFeatures && <div className="space-y-1.5">
              <Label htmlFor="pf-com">Comissão (%)</Label>
              <Input
                id="pf-com"
                className="h-11"
                inputMode="decimal"
                value={commission}
                onChange={(e) => setCommission(e.target.value.replace(/[^\d,.]/g, "").slice(0, 5))}
                data-testid="input-profissional-comissao"
              />
            </div>}
          </div>

          {partnerSalon && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4">
              <span>
                <span className="block font-semibold">Profissional parceiro (salão-parceiro)</span>
                <span className="text-sm text-muted-foreground">
                  A comissão acima vira o repasse ao parceiro no Faturamento. Vale para parceria com contrato formalizado.
                </span>
              </span>
              <Switch checked={isPartner} onCheckedChange={setIsPartner} data-testid="switch-profissional-parceiro" />
            </label>
          )}

          {/* Serviços que faz */}
          <div className="space-y-3 rounded-xl border p-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block font-semibold">Faz todos os serviços</span>
                <span className="text-sm text-muted-foreground">Desligue para escolher um por um</span>
              </span>
              <Switch checked={allServices} onCheckedChange={setAllServices} data-testid="switch-todos-servicos" />
            </label>

            {!allServices && (
              <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">
                {services.map((s) => {
                  const on = selected.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSelected(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        on ? "border-primary bg-primary/10 font-semibold" : "hover:border-primary/50"
                      )}
                      data-testid={`check-servico-${s.id}`}
                    >
                      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on && "border-primary bg-primary")}>
                        {on && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                      </span>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full text-base" disabled={pending} data-testid="btn-salvar-profissional">
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
