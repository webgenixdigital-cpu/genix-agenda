"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { KeyRound, Loader2, Lock, Mail, Plus, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { inviteMember, removeAccess, resendAccess } from "@/app/admin/(painel)/profissionais/access-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AccessInfo = {
  userId: string;
  email: string;
  name: string;
  role: "owner" | "staff" | "reception";
  status: "pending" | "active";
};

type ActionResult = { ok: boolean; error?: string; message?: string } | undefined;

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r) return; // demonstração
      if (r.ok) {
        if (r.message) toast.success(r.message);
        after?.();
      } else toast.error(r.error);
    });
  return { pending, run };
}

// ---------------------------------------------------------------------
// PARTE 1 — Selo + ações de acesso de um login existente
// ---------------------------------------------------------------------
function AccessStatus({ info }: { info: AccessInfo }) {
  const { pending, run } = useRun();
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {info.status === "active" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-600/30">
            <UserCheck className="h-3.5 w-3.5" /> Acesso ativo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/30">
            <Mail className="h-3.5 w-3.5" /> Convite enviado
          </span>
        )}
        <span className="truncate text-muted-foreground">{info.email}</span>
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-9"
          disabled={pending}
          onClick={() => run(() => resendAccess(info.userId))}
          data-testid={`btn-reenviar-acesso-${info.userId}`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}
          Reenviar link
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 text-destructive hover:bg-red-50 hover:text-destructive"
          disabled={pending}
          onClick={() => {
            if (confirm(`Remover o acesso de ${info.name}? O histórico de atendimentos continua no espaço.`)) {
              run(() => removeAccess(info.userId));
            }
          }}
          data-testid={`btn-remover-acesso-${info.userId}`}
        >
          <UserX className="mr-1.5 h-4 w-4" /> Remover acesso
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// PARTE 2 — Diálogo de convite (profissional ou recepção)
// ---------------------------------------------------------------------
function InviteDialog({
  open,
  onOpenChange,
  role,
  professionalId,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  role: "staff" | "reception";
  professionalId?: string;
  defaultName?: string;
}) {
  const { pending, run } = useRun();
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setName(defaultName ?? "");
          setEmail("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">
            {role === "staff" ? `Dar acesso a ${defaultName}` : "Adicionar recepção"}
          </DialogTitle>
          <DialogDescription>
            {role === "staff"
              ? "A pessoa vai ver e gerenciar só a própria agenda, os próprios bloqueios e os próprios clientes."
              : "A recepção marca e confirma horários de toda a equipe, sem acesso ao financeiro e às configurações."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteMember({ role, email, name, professionalId }), () => onOpenChange(false));
          }}
        >
          {role === "reception" && (
            <div className="space-y-1.5">
              <Label htmlFor="iv-name">Nome</Label>
              <Input id="iv-name" className="h-11" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} data-testid="input-convite-nome" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="iv-email">E-mail da pessoa</Label>
            <Input
              id="iv-email"
              type="email"
              className="h-11"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-convite-email"
            />
            <p className="text-xs text-muted-foreground">Ela recebe um e-mail para criar a própria senha.</p>
          </div>
          <Button
            type="submit"
            className="h-12 w-full text-base"
            disabled={pending || !/^\S+@\S+\.\S+$/.test(email) || name.trim().length < 2}
            data-testid="btn-enviar-convite"
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar convite"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// PARTE 3 — Bloco de acesso dentro do card do profissional
// ---------------------------------------------------------------------
export function ProAccess({
  professionalId,
  professionalName,
  info,
  isOwner,
  canInvite,
}: {
  professionalId: string;
  professionalName: string;
  info?: AccessInfo;
  isOwner: boolean;
  canInvite: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (isOwner) {
    return (
      <p className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
        <UserCheck className="h-4 w-4" /> Você (matriz)
      </p>
    );
  }
  if (info) return <AccessStatus info={info} />;

  if (!canInvite) {
    return (
      <Link href="/admin/assinatura" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Lock className="h-3.5 w-3.5" /> Acesso individual no plano Equipe
      </Link>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-9" onClick={() => setOpen(true)} data-testid={`btn-dar-acesso-${professionalId}`}>
        <KeyRound className="mr-1.5 h-4 w-4" /> Dar acesso
      </Button>
      <InviteDialog open={open} onOpenChange={setOpen} role="staff" professionalId={professionalId} defaultName={professionalName} />
    </>
  );
}

// ---------------------------------------------------------------------
// PARTE 4 — Seção Recepção
// ---------------------------------------------------------------------
export function ReceptionSection({ members, canInvite }: { members: AccessInfo[]; canInvite: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-3" data-testid="secao-recepcao">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl">Recepção</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Quem marca e confirma horários para toda a equipe. Não vê financeiro nem configurações.
          </p>
        </div>
        {canInvite ? (
          <Button variant="outline" className="h-11" onClick={() => setOpen(true)} data-testid="btn-adicionar-recepcao">
            <Plus className="mr-1.5 h-4 w-4" /> Adicionar recepção
          </Button>
        ) : (
          <Button asChild variant="outline" className="h-11">
            <Link href="/admin/assinatura">
              <Lock className="mr-1.5 h-4 w-4" /> Recepção no plano Equipe
            </Link>
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-white p-5 text-sm text-muted-foreground">Nenhuma pessoa na recepção.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <li key={m.userId} className="rounded-2xl border bg-card p-4">
              <p className="mb-2 font-semibold">{m.name}</p>
              <AccessStatus info={m} />
            </li>
          ))}
        </ul>
      )}

      <InviteDialog open={open} onOpenChange={setOpen} role="reception" />
    </section>
  );
}
