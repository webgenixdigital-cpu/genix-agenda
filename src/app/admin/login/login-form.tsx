"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Contas de demonstração (mesmas do seed). Remova antes de ir para produção real.
const DEMOS = [
  { label: "Salão Lumina", email: "dona@lumina.com", testId: "demo-login-salao" },
  { label: "Barbearia Imperial", email: "dono@imperial.com", testId: "demo-login-barbearia" },
  { label: "Clínica Harmonize", email: "gestor@harmonize.com", testId: "demo-login-clinica" },
];
const DEMO_PASSWORD = "demo123";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: string, p: string, key: string) {
    setLoading(key);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
    if (error) {
      setLoading(null);
      setError(
        error.message.includes("Invalid login")
          ? "E-mail ou senha incorretos."
          : "Não foi possível entrar agora. Tente de novo em instantes."
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <form
        className="mt-8 space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          signIn(email, password, "form");
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
            data-testid="input-login-email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 text-base"
            data-testid="input-login-senha"
          />
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

        <Button type="submit" className="h-12 w-full text-base" disabled={!!loading} data-testid="btn-entrar">
          {loading === "form" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
        </Button>
      </form>

      <div className="mt-10">
        <p className="text-sm text-muted-foreground">Ou explore com uma conta de demonstração:</p>
        <div className="mt-3 grid gap-2">
          {DEMOS.map((d) => (
            <Button
              key={d.email}
              variant="outline"
              className="h-11 justify-between"
              disabled={!!loading}
              onClick={() => signIn(d.email, DEMO_PASSWORD, d.email)}
              data-testid={d.testId}
            >
              {d.label}
              {loading === d.email ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="text-xs text-muted-foreground">{d.email}</span>
              )}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}