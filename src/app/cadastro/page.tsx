import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "./signup-form";
import { getActiveNiches } from "@/lib/niches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta grátis | Genix Agenda" };

const PERKS = [
  "15 dias com todos os recursos liberados",
  "Sem cartão de crédito",
  "Passo a passo guiado para deixar tudo pronto",
  "Depois, assine ou continue no plano Grátis",
];

export default async function CadastroPage({ searchParams }: { searchParams: { nicho?: string } }) {
  // Já logado? Se já tem espaço, vai para o painel; se não, termina o cadastro.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let mode: "full" | "business" = "full";

  if (user) {
    const { data: membership } = await supabase
      .from("business_members").select("business_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (membership) redirect("/admin");
    mode = "business";
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      {/* ---------- LATERAL ---------- */}
      <aside className="hidden flex-col justify-between bg-foreground p-12 text-background lg:flex">
        <Link href="/" className="flex w-fit items-center" data-testid="link-home-aside">
          <BrandLogo tone="escuro" />
        </Link>

        <div className="max-w-md">
          <h1 className="text-5xl leading-[1.08]">Em 2 minutos sua vitrine está no ar.</h1>
          <ul className="mt-10 space-y-4">
            {PERKS.map((p) => (
              <li key={p} className="flex gap-3 text-lg text-stone-200">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary">
                  <Check className="h-4 w-4 text-white" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-stone-500">Genix Sistemas Integrativos</p>
      </aside>

      {/* ---------- FORMULÁRIO ---------- */}
      <main className="flex justify-center p-6 md:p-12">
        <div className="w-full max-w-md py-4">
          <Link href="/" className="mb-8 flex min-h-11 w-fit items-center lg:hidden" data-testid="link-home">
            <BrandLogo priority />
          </Link>

          <h2 className="text-3xl">{mode === "full" ? "Criar conta grátis" : "Falta pouco"}</h2>
          <p className="mb-8 mt-2 text-muted-foreground">
            {mode === "full"
              ? "15 dias do plano Equipe, sem cartão."
              : "Sua conta foi criada. Agora conte sobre o seu espaço para concluir."}
          </p>

          <SignupForm
            mode={mode}
            defaultName={(user?.user_metadata?.full_name as string | undefined) ?? ""}
            niches={await getActiveNiches()}
            initialNiche={searchParams.nicho}
          />

          {mode === "full" && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Já tem conta?{" "}
              <Link href="/admin/login" className="font-semibold text-primary underline" data-testid="link-ja-tenho-conta">
                Entrar
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
