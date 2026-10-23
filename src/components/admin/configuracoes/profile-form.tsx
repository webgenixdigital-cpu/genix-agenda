"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { updateProfile } from "@/app/admin/(painel)/configuracoes/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { maskPhone, whatsappLink } from "@/lib/format";
import { SEGMENTS } from "@/lib/segments";

type Initial = {
  name: string;
  segment: string;
  subcategory: string | null;
  tagline: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  instagram: string | null;
  hero_image: string | null;
  whatsapp: string | null;
  whatsapp_message: string | null;
};

export type NicheOption = { id: string; segment: string; name: string };

export function ProfileForm({ initial, niches }: { initial: Initial; niches: NicheOption[] }) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: initial.name,
    segment: initial.segment,
    subcategory: initial.subcategory ?? "",
    tagline: initial.tagline ?? "",
    description: initial.description ?? "",
    address: initial.address ?? "",
    city: initial.city ?? "",
    state: initial.state ?? "",
    instagram: initial.instagram ?? "",
    hero_image: initial.hero_image ?? "",
    whatsapp: maskPhone((initial.whatsapp ?? "").replace(/^55/, "")),
    whatsapp_message: initial.whatsapp_message ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const testLink = whatsappLink(f.whatsapp.replace(/\D/g, ""), f.whatsapp_message || undefined);

  function save() {
    start(async () => {
      const r = await updateProfile(f);
      if (!r) return; // demonstração: o servidor redirecionou
      if (r.ok) toast.success("Perfil salvo");
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do espaço" id="cf-name">
          <Input id="cf-name" className="h-11" value={f.name} onChange={(e) => set("name")(e.target.value.slice(0, 80))} data-testid="input-config-nome" />
        </Field>
        <Field label="Segmento" id="cf-seg">
          <Select
            value={f.segment}
            onValueChange={(v) =>
              setF((s) => ({
                ...s,
                segment: v,
                // troca de segmento: limpa o tipo de espaço se ele não pertencer ao novo segmento
                subcategory: niches.some((n) => n.id === s.subcategory && n.segment === v) ? s.subcategory : "",
              }))
            }
          >
            <SelectTrigger id="cf-seg" className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEGMENTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Tipo de espaço" id="cf-sub">
        <Select value={f.subcategory || "none"} onValueChange={(v) => set("subcategory")(v === "none" ? "" : v)}>
          <SelectTrigger id="cf-sub" className="h-11"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="none">Não informar</SelectItem>
            {niches.filter((n) => n.segment === f.segment).map((n) => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Frase de destaque (aparece no topo da vitrine)" id="cf-tag">
        <Input id="cf-tag" className="h-11" value={f.tagline} onChange={(e) => set("tagline")(e.target.value.slice(0, 90))} />
      </Field>

      <Field label="Sobre o espaço" id="cf-desc">
        <Textarea id="cf-desc" rows={3} value={f.description} onChange={(e) => set("description")(e.target.value.slice(0, 500))} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_180px_80px]">
        <Field label="Endereço" id="cf-addr">
          <Input id="cf-addr" className="h-11" value={f.address} onChange={(e) => set("address")(e.target.value.slice(0, 120))} />
        </Field>
        <Field label="Cidade" id="cf-city">
          <Input id="cf-city" className="h-11" value={f.city} onChange={(e) => set("city")(e.target.value.slice(0, 60))} />
        </Field>
        <Field label="UF" id="cf-uf">
          <Input id="cf-uf" className="h-11 uppercase" value={f.state} onChange={(e) => set("state")(e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2))} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Instagram" id="cf-ig">
          <Input id="cf-ig" className="h-11" placeholder="@seuperfil" value={f.instagram} onChange={(e) => set("instagram")(e.target.value.slice(0, 60))} />
        </Field>
        <Field label="Foto de capa (link https)" id="cf-hero">
          <Input id="cf-hero" className="h-11" placeholder="https://..." value={f.hero_image} onChange={(e) => set("hero_image")(e.target.value)} />
        </Field>
      </div>

      {/* WhatsApp */}
      <div className="space-y-4 rounded-xl border bg-secondary/40 p-4">
        <p className="flex items-center gap-2 font-semibold">
          <MessageCircle className="h-5 w-5 text-whatsapp" /> WhatsApp do espaço
        </p>
        <Field label="Número com DDD" id="cf-wa">
          <Input
            id="cf-wa"
            className="h-11 bg-white"
            inputMode="tel"
            placeholder="(35) 99999-9999"
            value={f.whatsapp}
            onChange={(e) => set("whatsapp")(maskPhone(e.target.value))}
            data-testid="input-config-whatsapp"
          />
        </Field>
        <Field label="Mensagem que o cliente envia ao tocar no botão" id="cf-wamsg">
          <Textarea
            id="cf-wamsg"
            rows={2}
            className="bg-white"
            value={f.whatsapp_message}
            onChange={(e) => set("whatsapp_message")(e.target.value.slice(0, 300))}
            data-testid="input-config-mensagem"
          />
        </Field>
        {testLink && (
          <a href={testLink} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-primary underline">
            Testar o link do WhatsApp
          </a>
        )}
      </div>

      <Button type="submit" className="h-12 w-full text-base sm:w-auto sm:px-8" disabled={pending} data-testid="btn-salvar-perfil">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar perfil"}
      </Button>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
