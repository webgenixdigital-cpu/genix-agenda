"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateLink } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** "Salão Lumina Belle" → "salao-lumina-belle" */
const toSlug = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);

export function LinkForm({
  initial,
}: {
  initial: { slug: string; custom_domain: string | null; is_published: boolean };
}) {
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState(initial.slug);
  const [domain, setDomain] = useState(initial.custom_domain ?? "");
  const [published, setPublished] = useState(initial.is_published);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.host), []);

  function save() {
    start(async () => {
      const r = await updateLink({ slug: slug.replace(/-+$/, ""), customDomain: domain, isPublished: published });
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Link da vitrine salvo");
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
      <div className="space-y-1.5">
        <Label htmlFor="lk-slug">Endereço da vitrine</Label>
        <div className="flex h-11 items-center overflow-hidden rounded-md border bg-white focus-within:ring-2 focus-within:ring-ring">
          <span className="hidden h-full items-center border-r bg-secondary px-3 text-sm text-muted-foreground sm:flex">
            {origin || "seusite"}/v/
          </span>
          <input
            id="lk-slug"
            className="h-full flex-1 bg-transparent px-3 text-sm outline-none"
            value={slug}
            onChange={(e) => setSlug(toSlug(e.target.value))}
            data-testid="input-config-slug"
          />
        </div>
        <p className="text-xs text-muted-foreground">Curto e fácil de digitar. Só letras, números e hífen.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="lk-domain">Domínio próprio (opcional)</Label>
        <Input
          id="lk-domain"
          className="h-11"
          placeholder="agenda.seusalao.com.br"
          value={domain}
          onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
          data-testid="input-config-dominio"
        />
        {domain && (
          <div className="rounded-lg bg-secondary p-3 text-sm">
            <p className="font-semibold">Como ativar</p>
            <p className="mt-1 text-muted-foreground">
              No painel onde o domínio foi comprado (Registro.br, Hostinger etc.), crie um registro{" "}
              <strong className="text-foreground">CNAME</strong> com o nome <strong className="text-foreground">{domain.split(".")[0]}</strong>{" "}
              apontando para <strong className="text-foreground">cname.vercel-dns.com</strong>. A ativação final é feita pela
              equipe Genix.
            </p>
          </div>
        )}
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4">
        <span>
          <span className="block font-semibold">Vitrine publicada</span>
          <span className="text-sm text-muted-foreground">
            {published ? "Visível para clientes e recebendo agendamentos." : "Oculta: ninguém consegue ver nem agendar."}
          </span>
        </span>
        <Switch checked={published} onCheckedChange={setPublished} data-testid="switch-publicada" />
      </label>

      <Button type="submit" className="h-12 w-full text-base sm:w-auto sm:px-8" disabled={pending} data-testid="btn-salvar-link">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar link"}
      </Button>
    </form>
  );
}
