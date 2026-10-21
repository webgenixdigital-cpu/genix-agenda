"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/confirm`,
    });
    setLoading(false);

    // Limite de envio do Supabase (um pedido por minuto por e-mail)
    if (error && /rate|seconds|security purposes/i.test(error.message)) {
      setError("Aguarde 1 minuto antes de pedir outro link.");
      return;
    }
    // Por segurança, a resposta é a mesma exista ou não a conta
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center" data-testid="link-enviado">
        <MailCheck className="mx-auto h-12 w-12 text-primary" />
        <p className="mt-4 font-semibold">Confira seu e-mail</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Se existir uma conta com <strong>{email}</strong>, enviamos um link para criar uma senha nova.
          Ele vale por 1 hora. Confira também a caixa de spam.
        </p>
        <Button asChild variant="outline" className="mt-6 h-11 w-full">
          <Link href="/admin/login">Voltar ao login</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading) submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="fg-email">E-mail</Label>
        <Input
          id="fg-email"
          type="email"
          required
          autoComplete="email"
          className="h-12 text-base"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="input-esqueci-email"
        />
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}
      <Button type="submit" className="h-12 w-full text-base" disabled={loading || !/^\S+@\S+\.\S+$/.test(email)} data-testid="btn-enviar-link">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar link"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/admin/login" className="text-muted-foreground underline">Lembrei a senha</Link>
      </p>
    </form>
  );
}
