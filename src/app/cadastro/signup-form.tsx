"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { maskPhone } from "@/lib/format";
import { SEGMENTS } from "@/lib/segments";

// ---------------------------------------------------------------------
// PARTE 1 — Utilitários
// ---------------------------------------------------------------------
/** "Studio Ána & Cia" → "studio-ana-cia" */
const toSlug = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34);

const ERRORS: Record<string, string> = {
  JA_POSSUI_ESPACO: "Esta conta já tem um espaço cadastrado.",
  DADOS_INVALIDOS: "Confira os dados: nome, nome do espaço e WhatsApp com DDD.",
  NAO_AUTENTICADO: "Sua sessão expirou. Entre novamente para concluir.",
};

// ---------------------------------------------------------------------
// PARTE 2 — Componente
// mode "full": cria login + espaço | mode "business": login já existe
// ---------------------------------------------------------------------
export function SignupForm({ mode, defaultName }: { mode: "full" | "business"; defaultName?: string }) {
  const router = useRouter();

  const [ownerName, setOwnerName] = useState(defaultName ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [segment, setSegment] = useState("beleza");
  const [whatsapp, setWhatsapp] = useState("");
  const [terms, setTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  const slug = toSlug(businessName);
  const phoneDigits = whatsapp.replace(/\D/g, "");

  const valid =
    ownerName.trim().length >= 2 &&
    businessName.trim().length >= 2 &&
    phoneDigits.length >= 10 &&
    terms &&
    (mode === "business" || (/^\S+@\S+\.\S+$/.test(email) && password.length >= 8));

  async function submit() {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    // 1) cria o login (só no modo completo)
    if (mode === "full") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: ownerName.trim() } },
      });

      if (error) {
        setLoading(false);
        if (/already registered|already been registered/i.test(error.message)) {
          setError(
            <>
              Este e-mail já tem conta.{" "}
              <Link href="/admin/login" className="font-semibold underline">Entrar</Link>
            </>
          );
        } else if (/password/i.test(error.message)) {
          setError("A senha precisa ter pelo menos 8 caracteres.");
        } else {
          setError("Não foi possível criar sua conta agora. Tente novamente.");
        }
        return;
      }

      if (!data.session) {
        // "Confirm email" ainda está ligado no Supabase
        setLoading(false);
        setError("Enviamos um e-mail de confirmação. Confirme e depois entre para concluir o cadastro.");
        return;
      }
    }

    // 2) cria o espaço com 15 dias do Completo
    const { error: rpcError } = await supabase.rpc("create_business_for_user", {
      p_owner_name: ownerName.trim(),
      p_business_name: businessName.trim(),
      p_segment: segment,
      p_whatsapp: phoneDigits,
      p_slug_base: slug,
    });

    if (rpcError) {
      const code = Object.keys(ERRORS).find((k) => rpcError.message.includes(k));
      if (code === "JA_POSSUI_ESPACO") {
        router.replace("/admin");
        return;
      }
      setLoading(false);
      setError(code ? ERRORS[code] : "Sua conta foi criada, mas o espaço não. Toque em continuar para tentar de novo.");
      return;
    }

    router.replace("/admin?bem-vindo=1");
    router.refresh();
  }

  // -------------------------------------------------------------------
  // PARTE 3 — Interface
  // -------------------------------------------------------------------
  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !loading) submit();
      }}
    >
      {/* ---------- VOCÊ ---------- */}
      {mode === "full" && (
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-primary">1. Você</legend>

          <div className="space-y-1.5">
            <Label htmlFor="su-name">Seu nome</Label>
            <Input id="su-name" className="h-12 text-base" autoComplete="name" value={ownerName}
              onChange={(e) => setOwnerName(e.target.value.slice(0, 60))} data-testid="input-cadastro-nome" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="su-email">E-mail</Label>
            <Input id="su-email" type="email" className="h-12 text-base" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} data-testid="input-cadastro-email" />
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Use um <strong>e-mail válido e oficial</strong>. Você entra agora, mas vai precisar confirmá-lo depois
                para manter o acesso e recuperar a senha.
              </span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="su-pass">Senha (mínimo 8 caracteres)</Label>
            <div className="relative">
              <Input id="su-pass" type={showPass ? "text" : "password"} className="h-12 pr-12 text-base"
                autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="input-cadastro-senha" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                aria-label={showPass ? "Esconder senha" : "Mostrar senha"}>
                {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </fieldset>
      )}

      {/* ---------- SEU ESPAÇO ---------- */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-primary">{mode === "full" ? "2. Seu espaço" : "Seu espaço"}</legend>

        {mode === "business" && (
          <div className="space-y-1.5">
            <Label htmlFor="su-name2">Seu nome</Label>
            <Input id="su-name2" className="h-12 text-base" value={ownerName}
              onChange={(e) => setOwnerName(e.target.value.slice(0, 60))} />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="su-biz">Nome do espaço</Label>
          <Input id="su-biz" className="h-12 text-base" placeholder="Ex.: Studio Ana Beleza" value={businessName}
            onChange={(e) => setBusinessName(e.target.value.slice(0, 80))} data-testid="input-cadastro-espaco" />
          {slug.length >= 3 && (
            <p className="text-sm text-muted-foreground">
              Sua vitrine: <span className="font-mono text-foreground">/v/{slug}</span> (dá para trocar depois)
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Segmento</Label>
            <Select value={segment} onValueChange={setSegment}>
              <SelectTrigger className="h-12 text-base" data-testid="select-cadastro-segmento"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEGMENTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-wa">WhatsApp do espaço</Label>
            <Input id="su-wa" className="h-12 text-base" inputMode="tel" placeholder="(35) 99999-9999" value={whatsapp}
              onChange={(e) => setWhatsapp(maskPhone(e.target.value))} data-testid="input-cadastro-whatsapp" />
          </div>
        </div>
      </fieldset>

      {/* ---------- TERMOS ---------- */}
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#99582A]" data-testid="check-termos" />
        <span className="text-muted-foreground">
          Li e aceito os{" "}
          <Link href="/termos" target="_blank" className="font-semibold text-foreground underline">Termos de Uso</Link> e a{" "}
          <Link href="/privacidade" target="_blank" className="font-semibold text-foreground underline">Política de Privacidade</Link>.
        </span>
      </label>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive" data-testid="erro-cadastro">{error}</p>}

      <Button type="submit" className="h-12 w-full text-base active:scale-95" disabled={!valid || loading} data-testid="btn-criar-conta">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : mode === "full" ? "Criar conta e começar 15 dias grátis" : "Concluir cadastro"}
      </Button>
    </form>
  );
}