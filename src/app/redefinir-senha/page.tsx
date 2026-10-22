import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar senha nova | Genix Agenda", robots: { index: false } };

export default async function RedefinirSenhaPage({ searchParams }: { searchParams: { novo?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Só chega aqui com sessão criada pelo link do e-mail
  if (!user) {
    return (
      <AuthShell title="Link expirado" subtitle="Para criar uma senha nova, peça um novo link.">
        <Button asChild className="h-12 w-full text-base">
          <Link href="/esqueci-senha">Pedir novo link</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={searchParams.novo === "1" ? "Crie sua senha de acesso" : "Criar senha nova"}
      subtitle={searchParams.novo === "1" ? `Bem-vindo(a)! Seu acesso: ${user.email}` : `Conta: ${user.email}`}
    >
      <ResetForm />
    </AuthShell>
  );
}
