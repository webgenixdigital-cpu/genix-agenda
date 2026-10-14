"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setLoading(false);
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
          signIn();
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

        <Button type="submit" className="h-12 w-full text-base" disabled={loading} data-testid="btn-entrar">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
        </Button>
      </form>

      <div className="mt-10 rounded-2xl bg-secondary p-5">
        <p className="font-semibold">Quer conhecer antes?</p>
        <p className="mt-1 text-sm text-muted-foreground">Veja um painel de verdade, com agenda e financeiro, sem criar conta.</p>
        <Button asChild variant="outline" className="mt-4 h-11 w-full bg-white" data-testid="btn-login-ver-demo">
          <Link href="/demo">
            <PlayCircle className="mr-2 h-4 w-4" /> Ver demonstração
          </Link>
        </Button>
      </div>
    </>
  );
}