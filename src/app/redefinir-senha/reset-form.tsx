"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= 8 && confirm === password;

  async function submit() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(
        /different from the old/i.test(error.message)
          ? "A senha nova precisa ser diferente da anterior."
          : "Não foi possível salvar. Peça um novo link e tente de novo."
      );
      return;
    }
    toast.success("Senha atualizada");
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !loading) submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="rs-pass">Senha nova (mínimo 8 caracteres)</Label>
        <div className="relative">
          <Input
            id="rs-pass"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            className="h-12 pr-12 text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="input-senha-nova"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            aria-label={show ? "Esconder senha" : "Mostrar senha"}
          >
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {tooShort && <p className="text-sm text-destructive">Use pelo menos 8 caracteres.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rs-confirm">Repita a senha nova</Label>
        <Input
          id="rs-confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          className="h-12 text-base"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          data-testid="input-senha-confirmar"
        />
        {mismatch && <p className="text-sm text-destructive">As senhas não são iguais.</p>}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{error}</p>}

      <Button type="submit" className="h-12 w-full text-base" disabled={!valid || loading} data-testid="btn-salvar-senha">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar senha e entrar"}
      </Button>
    </form>
  );
}
