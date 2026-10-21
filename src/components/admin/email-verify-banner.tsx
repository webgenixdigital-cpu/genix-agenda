"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------
// Faixa "Confirme seu e-mail" (só para quem ainda não confirmou)
// ---------------------------------------------------------------------
export function EmailVerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send() {
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setState("idle");
      toast.error(/rate|seconds|security purposes/i.test(error.message)
        ? "Aguarde 1 minuto antes de pedir outro link."
        : "Não foi possível enviar agora. Tente de novo.");
      return;
    }
    setState("sent");
    setCooldown(60);
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 md:px-8"
      data-testid="faixa-confirmar-email"
    >
      <p className="flex items-center gap-2">
        <MailWarning className="h-4 w-4 shrink-0" />
        {state === "sent" ? (
          <span>Enviamos um link para <strong>{email}</strong>. Abra o e-mail e toque em “Confirmar e-mail”.</span>
        ) : (
          <span><strong>Confirme seu e-mail</strong> para não perder o acesso e conseguir recuperar a senha.</span>
        )}
      </p>
      <button
        onClick={send}
        disabled={state === "sending" || cooldown > 0}
        className="inline-flex items-center gap-1.5 font-semibold underline disabled:no-underline disabled:opacity-60"
        data-testid="btn-enviar-confirmacao"
      >
        {state === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
        {cooldown > 0 ? `Reenviar em ${cooldown}s` : state === "sent" ? "Reenviar" : "Enviar link de confirmação"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Aviso de sucesso quando volta do link (?email=confirmado)
// ---------------------------------------------------------------------
export function EmailConfirmedToast() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (params.get("email") === "confirmado") {
      toast.success("E-mail confirmado. Obrigado!");
      router.replace(pathname);
    }
  }, [params, pathname, router]);

  return null;
}
