import { Suspense } from "react";
import Link from "next/link";
import { PauseCircle, WifiOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { getAdminContext } from "@/lib/admin";
import { getFreeDailyLimit, getPlanContext, hasTeamFeatures } from "@/lib/plan";
import { FREE_LOCKED_HREFS } from "@/lib/plan-features";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { DemoBanner } from "@/components/admin/demo-banner";
import { PlanBanner } from "@/components/admin/plan-banner";
import { EmailConfirmedToast, EmailVerifyBanner } from "@/components/admin/email-verify-banner";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAdminContext();
  const plan = await getPlanContext(ctx.business.id);
  const isDemo = ctx.role === "viewer";
  const isOwner = ctx.role === "owner";
  const isTeam = ctx.role === "staff" || ctx.role === "reception";

  // faixa do plano (matriz): limite do Grátis e oferta do fim do teste pelo tamanho da equipe
  let freeLimit = 10;
  let activePros = 1;
  if (isOwner && !plan.internal && plan.status !== "active") {
    const [limit, { count }] = await Promise.all([
      getFreeDailyLimit(),
      createClient()
        .from("professionals")
        .select("id", { count: "exact", head: true })
        .eq("business_id", ctx.business.id)
        .eq("active", true),
    ]);
    freeLimit = limit;
    activePros = count ?? 1;
  }

  // WhatsApp automático ligado mas desconectado: aviso só para a matriz
  let waDisconnected = false;
  if (isOwner && plan.tier === "completo") {
    const { data: wa } = await createClient().rpc("whatsapp_panel_status", { p_business: ctx.business.id });
    const w = wa as { genix_enabled: boolean; auto_enabled: boolean; status: string } | null;
    waDisconnected = !!w?.genix_enabled && w.auto_enabled && w.status === "disconnected";
  }

  // Sem o plano Equipe (Grátis ou Profissional) só a matriz usa o painel: os acessos da
  // equipe ficam pausados (nunca apagados) e voltam quando o espaço assina o Equipe
  if (isTeam && !hasTeamFeatures(plan)) {
    return (
      <main className="grid min-h-svh place-items-center bg-secondary/50 p-4">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center" data-testid="acesso-pausado">
          <PauseCircle className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 text-3xl">Acesso da equipe pausado</h1>
          <p className="mt-2 text-muted-foreground">
            O plano de {ctx.business.name} não inclui acessos individuais no momento. Fale com o responsável pelo espaço.
          </p>
          <form action={signOut} className="mt-6">
            <Button type="submit" variant="outline" className="h-11">Sair</Button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <>
      {isDemo && (
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
      )}
      <div className="flex min-h-svh flex-col bg-stone-50 md:flex-row">
        <AdminSidebar
          businessName={ctx.business.name}
          slug={ctx.business.slug}
          email={isDemo ? "Conta de demonstração" : ctx.email}
          lockedHrefs={plan.tier === "gratis" ? FREE_LOCKED_HREFS : []}
          role={ctx.role}
        />
        <div className="min-w-0 flex-1">
          {!isDemo && !plan.internal && !ctx.emailVerified && <EmailVerifyBanner email={ctx.email} />}
          {isOwner && <PlanBanner plan={plan} freeLimit={freeLimit} activePros={activePros} />}
          {waDisconnected && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 md:px-8" data-testid="aviso-whatsapp-desconectado">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span className="font-medium">WhatsApp desconectado — lembretes automáticos pausados.</span>
              <Link href="/admin/configuracoes#whatsapp" className="inline-flex min-h-11 items-center font-semibold underline" data-testid="link-whatsapp-reconectar">
                Reconectar
              </Link>
            </div>
          )}
          <Suspense fallback={null}>
            <EmailConfirmedToast />
          </Suspense>
          {children}
        </div>
      </div>
    </>
  );
}
