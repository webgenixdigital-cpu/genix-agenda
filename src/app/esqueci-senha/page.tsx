import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Esqueci minha senha | Genix Agenda" };

const ERROS: Record<string, string> = {
  "link-expirado": "Esse link expirou ou já foi usado. Peça um novo abaixo.",
  "link-invalido": "Link inválido. Peça um novo abaixo.",
};

export default function EsqueciSenhaPage({ searchParams }: { searchParams: { erro?: string } }) {
  return (
    <AuthShell title="Esqueci minha senha" subtitle="Informe o e-mail da sua conta. Enviaremos um link para criar uma senha nova.">
      {searchParams.erro && ERROS[searchParams.erro] && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="aviso-link">
          {ERROS[searchParams.erro]}
        </p>
      )}
      <ForgotForm />
    </AuthShell>
  );
}
